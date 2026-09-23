import { Router } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { candidatesCol, interviewsCol, jdMasterCol } from "../../lib/collections";
import { firstZodIssue } from "../../lib/errors";
import { NO_SLASH, toMillis } from "../../lib/validation";
import type { InterviewDoc, InterviewStatus, JdMasterDoc, RequiredSkill } from "../../types/domain";

const router = Router();

const rowSchema = z.object({
  rowIndex: z.number(),
  empId: z.string().trim().min(1).refine(NO_SLASH, 'Emp ID must not contain a "/" character.'),
  empName: z.string().trim().min(1),
  empEmail: z.string().trim(), // format checked per row so one bad address skips that row, not the batch
  skillCluster: z.string().trim().min(1),
  tier: z.string().trim().default("4"),
  jdReference: z.string().trim().default(""),
});
const importSchema = z.object({ rows: z.array(rowSchema), batchId: z.string().trim().min(1) });
const reassessSchema = z.object({ jdReference: z.string().trim().min(1) });
const isEmail = (v: string) => z.string().email().safeParse(v).success;

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
    // Stored uppercase: candidate login uppercases the Emp ID it is given.
    const empId = row.empId.toUpperCase();
    const skip = (error: string) => ({ rowIndex: row.rowIndex, empId, status: "skipped" as const, error });

    if (seen.has(empId)) return skip("Duplicate Emp ID within this batch.");
    seen.add(empId);
    if (!isEmail(row.empEmail)) return skip("Invalid email.");

    const match = row.jdReference ? jdsByTitle.get(row.jdReference.toLowerCase()) : undefined;
    const batch = db.batch();
    // .create() is an atomic dedup against a resubmitted chunk; the whole batch fails if it exists.
    batch.create(candidatesCol().doc(empId), {
      empName: row.empName,
      empEmail: row.empEmail,
      skills: match ? topSkills(match.jd.requiredSkills) : [],
      tier: row.tier || "4",
      skillCluster: row.skillCluster,
      jdRef: match?.jdRef ?? null,
      category: null,
      batchId,
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    });
    batch.set(interviewsCol().doc(), newInterviewDoc(empId, match?.jdRef ?? null));
    try {
      await batch.commit();
    } catch (err) {
      if ((err as { code?: number }).code === 6 /* ALREADY_EXISTS */) return skip("Emp ID already imported.");
      throw err;
    }
    return { rowIndex: row.rowIndex, empId, status: "imported" as const };
  }));

  const imported = results.filter((r) => r.status === "imported").length;
  if (imported > 0) {
    await recordAudit(req.admin!, {
      action: "CANDIDATE_IMPORTED",
      targetType: "batch",
      targetId: batchId,
      summary: `Imported ${imported} candidate(s)${results.length > imported ? `, skipped ${results.length - imported}` : ""}`,
      detail: { batchId, imported, skipped: results.length - imported, empIds: results.filter((r) => r.status === "imported").map((r) => r.empId) },
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
      empId: d.id,
      ...d.data(),
      createdAt: toMillis(d.data().createdAt),
      interviewStatus: highestInterviewStatus(statuses),
      interviewCount: statuses.length,
    };
  }));
});

router.post("/:empId/reassess", async (req, res) => {
  const parsed = reassessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "jdReference is required." });
  const { jdReference } = parsed.data;
  const empId = req.params.empId;

  if (!NO_SLASH(empId)) return res.status(404).json({ error: "Candidate not found." });
  const candidateRef = candidatesCol().doc(empId);
  if (!(await candidateRef.get()).exists) return res.status(404).json({ error: "Candidate not found." });

  const match = (await loadJdsByTitle()).get(jdReference.toLowerCase());
  if (!match) return res.status(404).json({ error: `No JD Master entry matches "${jdReference}".` });

  // Transactional guard: a second PENDING/ACTIVE attempt can never be created concurrently.
  const interviewRef = interviewsCol().doc();
  const conflict = await db.runTransaction(async (tx) => {
    const existing = await tx.get(interviewsCol().where("candidateId", "==", empId));
    const statuses = existing.docs.map((d) => d.data().status);
    if (statuses.includes("ACTIVE")) return "This candidate is currently taking an interview.";
    if (statuses.includes("PENDING")) {
      return "This candidate already has an interview awaiting scheduling — schedule or cancel that one first.";
    }
    tx.set(interviewRef, newInterviewDoc(empId, match.jdRef));
    // Candidate.jdRef is mutable and overwritten by every reassess; past interviews keep their own jdRef.
    tx.update(candidateRef, { jdRef: match.jdRef, skills: topSkills(match.jd.requiredSkills) });
    return null;
  });
  if (conflict) return res.status(409).json({ error: conflict });

  await recordAudit(req.admin!, {
    action: "INTERVIEW_ATTEMPT_ADDED",
    targetType: "candidate",
    targetId: empId,
    summary: `Added a re-assessment for ${empId} against JD "${match.jd.title}"`,
    detail: { interviewId: interviewRef.id, jdRef: match.jdRef },
  });
  res.status(201).json({ interviewId: interviewRef.id, jdRef: match.jdRef, jdTitle: match.jd.title });
});

router.delete("/:empId", async (req, res) => {
  const empId = req.params.empId;
  const cascade = req.query.cascade === "true";
  if (!NO_SLASH(empId)) return res.status(404).json({ error: "Candidate not found." });

  const candidateRef = candidatesCol().doc(empId);
  const candidate = (await candidateRef.get()).data();
  if (!candidate) return res.status(404).json({ error: "Candidate not found." });

  const interviews = await interviewsCol().where("candidateId", "==", empId).get();
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
    targetId: empId,
    summary: cascade
      ? `Deleted candidate ${candidate.empName} (${empId}) and ${interviews.size} interview record(s)`
      : `Deleted candidate ${candidate.empName} (${empId}); interview records kept`,
    detail: { cascade, interviewCount: interviews.size, empEmail: candidate.empEmail },
  });
  res.json({ ok: true, interviewCount: interviews.size, deletedInterviewCount: cascade ? interviews.size : 0 });
});

export default router;
