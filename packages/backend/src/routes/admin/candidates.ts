import { Router } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { candidatesCol, interviewsCol, jdMasterCol } from "../../lib/collections";
import { firstZodIssue } from "../../lib/errors";
import { isCandidateEmail, normalizeEmail, toMillis } from "../../lib/validation";
import type { InterviewDoc, InterviewStatus, JdMasterDoc, RequiredSkill } from "../../types/domain";

const router = Router();

const rowSchema = z.object({
  rowIndex: z.number(),
  // The email is the candidate record ID. Its format is checked per row, so one bad
  // address skips that row instead of failing the whole batch.
  email: z.string().trim().min(1, "Email is required."),
  name: z.string().trim().min(1, "Name is required."),
  refId: z.string().trim().default(""),
  skillCluster: z.string().trim().min(1),
  tier: z.string().trim().default("4"),
  jdReference: z.string().trim().default(""),
});
const importSchema = z.object({ rows: z.array(rowSchema), batchId: z.string().trim().min(1) });
const reassessSchema = z.object({ jdReference: z.string().trim().min(1) });

const STATUS_RANK: Record<InterviewStatus, number> = { ACTIVE: 4, PENDING: 3, COMPLETED: 2, NO_SHOW: 1, EXPIRED: 0 };

/** Highest-ranked status across a candidate's interviews, or null when there are none. */
export function highestInterviewStatus(statuses: InterviewStatus[]): InterviewStatus | null {
  return statuses.reduce<InterviewStatus | null>((best, s) => (best === null || STATUS_RANK[s] > STATUS_RANK[best] ? s : best), null);
}

/** A matched candidate's skills: the JD's top 5 by weight, descending. */
export function topSkills(requiredSkills: RequiredSkill[]): string[] {
  return [...requiredSkills].sort((a, b) => (b.weight ?? 5) - (a.weight ?? 5)).slice(0, 5).map((s) => s.skill);
}

/** A fresh PENDING interview awaiting scheduling. */
export function newInterviewDoc(candidateId: string, jdRef: string | null): InterviewDoc {
  return {
    candidateId,
    jdRef,
    accessKeyHash: "",
    status: "PENDING",
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    jdSnapshot: null,
    schedule: null,
    report: null,
    refreshTokenHash: null,
    createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
  };
}

/** Exact, case-insensitive title lookup — not fuzzy, not scored. */
async function loadJdsByTitle(): Promise<Map<string, { jdRef: string; jd: JdMasterDoc }>> {
  const snap = await jdMasterCol().get();
  return new Map(snap.docs.map((d) => [d.data().title.trim().toLowerCase(), { jdRef: d.id, jd: d.data() }]));
}

router.post("/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid import payload.") });
  const { rows, batchId } = parsed.data;

  const jdsByTitle = await loadJdsByTitle();
  const seen = new Set<string>();

  const results = await Promise.all(rows.map(async (row) => {
    const email = normalizeEmail(row.email);
    const skip = (error: string) => ({ rowIndex: row.rowIndex, email, status: "skipped" as const, error });

    if (!isCandidateEmail(email)) return skip("Invalid email.");
    if (seen.has(email)) return skip("Duplicate email within this batch.");
    seen.add(email);

    const match = row.jdReference ? jdsByTitle.get(row.jdReference.toLowerCase()) : undefined;
    const batch = db.batch();
    // .create() is an atomic dedup against a resubmitted chunk; the whole batch fails if it exists.
    batch.create(candidatesCol().doc(email), {
      name: row.name,
      email,
      refId: row.refId || null,
      skills: match ? topSkills(match.jd.requiredSkills) : [],
      tier: row.tier || "4",
      skillCluster: row.skillCluster,
      jdRef: match?.jdRef ?? null,
      category: null,
      batchId,
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    });
    batch.set(interviewsCol().doc(), newInterviewDoc(email, match?.jdRef ?? null));
    try {
      await batch.commit();
    } catch (err) {
      if ((err as { code?: number }).code === 6 /* ALREADY_EXISTS */) return skip("Email already imported.");
      throw err;
    }
    return { rowIndex: row.rowIndex, email, status: "imported" as const };
  }));

  const imported = results.filter((r) => r.status === "imported").length;
  if (imported > 0) {
    await recordAudit(req.admin!, {
      action: "CANDIDATE_IMPORTED",
      targetType: "batch",
      targetId: batchId,
      summary: `Imported ${imported} candidate(s)${results.length > imported ? `, skipped ${results.length - imported}` : ""}`,
      detail: { batchId, imported, skipped: results.length - imported, emails: results.filter((r) => r.status === "imported").map((r) => r.email) },
    });
  }
  res.json({ imported, results });
});

router.get("/", async (_req, res) => {
  const [candidates, interviews] = await Promise.all([
    candidatesCol().orderBy("createdAt", "desc").get(),
    interviewsCol().select("candidateId", "status").get(),
  ]);
  const statusesByCandidate = new Map<string, InterviewStatus[]>();
  for (const d of interviews.docs) {
    const { candidateId, status } = d.data();
    statusesByCandidate.set(candidateId, [...(statusesByCandidate.get(candidateId) ?? []), status]);
  }
  res.json(candidates.docs.map((d) => {
    const statuses = statusesByCandidate.get(d.id) ?? [];
    return {
      ...d.data(),
      email: d.id,
      createdAt: toMillis(d.data().createdAt),
      interviewStatus: highestInterviewStatus(statuses),
      interviewCount: statuses.length,
    };
  }));
});

router.post("/:email/reassess", async (req, res) => {
  const parsed = reassessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "jdReference is required." });
  const { jdReference } = parsed.data;
  const email = normalizeEmail(req.params.email);

  if (!isCandidateEmail(email)) return res.status(404).json({ error: "Candidate not found." });
  const candidateRef = candidatesCol().doc(email);
  if (!(await candidateRef.get()).exists) return res.status(404).json({ error: "Candidate not found." });

  const match = (await loadJdsByTitle()).get(jdReference.toLowerCase());
  if (!match) return res.status(404).json({ error: `No JD Master entry matches "${jdReference}".` });

  // Transactional guard: a second PENDING/ACTIVE attempt can never be created concurrently.
  const interviewRef = interviewsCol().doc();
  const conflict = await db.runTransaction(async (tx) => {
    const existing = await tx.get(interviewsCol().where("candidateId", "==", email));
    const statuses = existing.docs.map((d) => d.data().status);
    if (statuses.includes("ACTIVE")) return "This candidate is currently taking an interview.";
    if (statuses.includes("PENDING")) {
      return "This candidate already has an interview awaiting scheduling — schedule or cancel that one first.";
    }
    tx.set(interviewRef, newInterviewDoc(email, match.jdRef));
    // Candidate.jdRef is mutable and overwritten by every reassess; past interviews keep their own jdRef.
    tx.update(candidateRef, { jdRef: match.jdRef, skills: topSkills(match.jd.requiredSkills) });
    return null;
  });
  if (conflict) return res.status(409).json({ error: conflict });

  await recordAudit(req.admin!, {
    action: "INTERVIEW_ATTEMPT_ADDED",
    targetType: "candidate",
    targetId: email,
    summary: `Added a re-assessment for ${email} against JD "${match.jd.title}"`,
    detail: { interviewId: interviewRef.id, jdRef: match.jdRef },
  });
  res.status(201).json({ interviewId: interviewRef.id, jdRef: match.jdRef, jdTitle: match.jd.title });
});

router.delete("/:email", async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const cascade = req.query.cascade === "true";
  if (!isCandidateEmail(email)) return res.status(404).json({ error: "Candidate not found." });

  const candidateRef = candidatesCol().doc(email);
  const candidate = (await candidateRef.get()).data();
  if (!candidate) return res.status(404).json({ error: "Candidate not found." });

  const interviews = await interviewsCol().where("candidateId", "==", email).get();
  if (interviews.docs.some((d) => d.data().status === "ACTIVE")) {
    return res.status(409).json({ error: "This candidate is currently taking their interview and can't be deleted right now." });
  }

  await candidateRef.delete();
  if (cascade) {
    // recursiveDelete also removes each interview's session and violations subcollections.
    for (const d of interviews.docs) await db.recursiveDelete(d.ref);
  }

  await recordAudit(req.admin!, {
    action: "CANDIDATE_DELETED",
    targetType: "candidate",
    targetId: email,
    summary: cascade
      ? `Deleted candidate ${candidate.name} (${email}) and ${interviews.size} interview record(s)`
      : `Deleted candidate ${candidate.name} (${email}); interview records kept`,
    detail: { cascade, interviewCount: interviews.size, refId: candidate.refId },
  });
  res.json({ ok: true, interviewCount: interviews.size, deletedInterviewCount: cascade ? interviews.size : 0 });
});

export default router;
