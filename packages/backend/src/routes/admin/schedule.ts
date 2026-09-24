import { Router } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { generateAccessKey } from "../../lib/accessKey";
import { candidatesCol, interviewsCol } from "../../lib/collections";
import { HttpError } from "../../lib/errors";
import { hashSecret } from "../../lib/hash";
import { toMillis } from "../../lib/validation";
import { accessKeyEmail, sendEmail } from "../../services/email";
import type { CandidateDoc, InterviewDoc } from "../../types/domain";

const router = Router();

export interface IssuedKey {
  email: string;
  name: string;
  key: string; // RAW — returned exactly once, never stored
  scheduledAt: number;
  emailSent: boolean;
  emailPreviewUrl: string | null;
}

// Scheduling and rescheduling put the interview back to PENDING, so they must never touch an
// interview that has started or finished — that would reopen a one-attempt assessment.
const SCHEDULABLE = new Set(["PENDING", "NO_SHOW"]);
const NOT_SCHEDULABLE = "This interview has already started or finished, so it can't be scheduled again.";

const isoDate = z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)));
const scheduleOneSchema = z.object({ interviewId: z.string().min(1), scheduledAt: isoDate });
const scheduleBulkSchema = z.object({ interviewIds: z.array(z.string().min(1)).min(1), scheduledAt: isoDate });
const rescheduleSchema = z.object({ scheduledAt: isoDate });

async function loadCandidates(ids: string[]): Promise<Map<string, CandidateDoc>> {
  const unique = [...new Set(ids)].filter((id) => id && !id.includes("/"));
  if (unique.length === 0) return new Map();
  const snaps = await candidatesCol().firestore.getAll(...unique.map((id) => candidatesCol().doc(id)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as CandidateDoc]));
}

/**
 * Mints a new key, stores only its bcrypt hash, and emails the raw key.
 * With `scheduledAt`, (re)writes the schedule; without it, keeps the existing one (resend).
 */
async function issueKey(interviewId: string, interview: InterviewDoc, candidate: CandidateDoc | undefined, scheduledAt?: Date): Promise<IssuedKey> {
  const key = generateAccessKey();
  const when = scheduledAt ?? interview.schedule!.scheduledAt.toDate();
  const update: Partial<InterviewDoc> = { accessKeyHash: await hashSecret(key) };
  if (scheduledAt) {
    update.status = "PENDING";
    update.schedule = {
      scheduledAt: Timestamp.fromDate(scheduledAt),
      reminderCount: 0,
      lastReminderAt: null,
      noShow: false,
      escalatedAt: null,
    };
  }
  const ref = interviewsCol().doc(interviewId);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (!current) throw new HttpError(404, "Interview not found.");
    // Re-checked inside the transaction so a candidate logging in concurrently can't be reopened.
    if (scheduledAt && !SCHEDULABLE.has(current.status)) throw new HttpError(409, NOT_SCHEDULABLE);
    tx.update(ref, update);
  });

  const name = candidate?.name ?? interview.candidateId;
  const email = interview.candidateId; // the candidate record ID is their email
  // Delivery failure never fails the request — the admin still has the key.
  const delivery = await sendEmail(accessKeyEmail({ to: email, name, key, scheduledAt: when }));

  return { email, name, key, scheduledAt: when.getTime(), emailSent: delivery.sent, emailPreviewUrl: delivery.previewUrl };
}

router.get("/unscheduled", async (_req, res) => {
  const pending = (await interviewsCol().where("status", "==", "PENDING").get()).docs.filter((d) => d.data().schedule == null);
  const candidates = await loadCandidates(pending.map((d) => d.data().candidateId));
  res.json(pending.map((d) => {
    const interview = d.data();
    const candidate = candidates.get(interview.candidateId);
    return {
      interviewId: d.id,
      email: interview.candidateId,
      name: candidate?.name ?? interview.candidateId,
      refId: candidate?.refId ?? null,
      cluster: candidate?.skillCluster ?? "unknown",
      jdRef: interview.jdRef ?? null,
    };
  }));
});

router.get("/", async (_req, res) => {
  const scheduled = (await interviewsCol().get()).docs.filter((d) => d.data().schedule != null);
  const candidates = await loadCandidates(scheduled.map((d) => d.data().candidateId));
  const rows = scheduled.map((d) => {
    const interview = d.data();
    const candidate = candidates.get(interview.candidateId);
    return {
      interviewId: d.id,
      email: interview.candidateId,
      name: candidate?.name ?? interview.candidateId,
      refId: candidate?.refId ?? null,
      cluster: candidate?.skillCluster ?? "unknown",
      jdRef: interview.jdRef ?? null,
      status: interview.status,
      scheduledAt: toMillis(interview.schedule!.scheduledAt) ?? 0,
      reminderCount: interview.schedule!.reminderCount,
    };
  });
  rows.sort((a, b) => b.scheduledAt - a.scheduledAt);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const parsed = scheduleOneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "interviewId and scheduledAt are required." });
  const { interviewId, scheduledAt } = parsed.data;

  if (interviewId.includes("/")) return res.status(404).json({ error: "Interview not found." });
  const interview = (await interviewsCol().doc(interviewId).get()).data();
  if (!interview) return res.status(404).json({ error: "Interview not found." });
  if (!SCHEDULABLE.has(interview.status)) return res.status(409).json({ error: NOT_SCHEDULABLE });

  const candidate = (await loadCandidates([interview.candidateId])).get(interview.candidateId);
  const issued = await issueKey(interviewId, interview, candidate, new Date(scheduledAt));

  await recordAudit(req.admin!, {
    action: "INTERVIEW_SCHEDULED",
    targetType: "interview",
    targetId: interviewId,
    summary: `Scheduled ${issued.name} (${issued.email}) for ${new Date(scheduledAt).toISOString()}`,
    detail: { email: issued.email, scheduledAt, emailSent: issued.emailSent },
  });
  res.json({ issued: [issued] });
});

router.post("/bulk", async (req, res) => {
  const parsed = scheduleBulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "interviewIds and scheduledAt are required." });
  const scheduledAt = new Date(parsed.data.scheduledAt);
  const interviewIds = [...new Set(parsed.data.interviewIds)];

  const snaps = await Promise.all(interviewIds.map((id) => (id.includes("/") ? null : interviewsCol().doc(id).get())));
  const candidates = await loadCandidates(snaps.map((s) => s?.data()?.candidateId ?? ""));

  const issued: IssuedKey[] = [];
  const failed: { interviewId: string; error: string }[] = [];
  await Promise.all(interviewIds.map(async (interviewId, i) => {
    const interview = snaps[i]?.data();
    if (!interview) return failed.push({ interviewId, error: "Interview not found." });
    if (!SCHEDULABLE.has(interview.status)) return failed.push({ interviewId, error: NOT_SCHEDULABLE });
    const candidate = candidates.get(interview.candidateId);
    if (!candidate) return failed.push({ interviewId, error: "Candidate not found." });
    try {
      issued.push(await issueKey(interviewId, interview, candidate, scheduledAt));
    } catch (err) {
      if (err instanceof HttpError) return failed.push({ interviewId, error: err.message });
      throw err;
    }
  }));

  if (issued.length > 0) {
    await recordAudit(req.admin!, {
      action: "INTERVIEW_SCHEDULED",
      targetType: "interview",
      targetId: interviewIds.join(","),
      summary: `Scheduled ${issued.length} interview(s) for ${scheduledAt.toISOString()}${failed.length ? ` (${failed.length} failed)` : ""}`,
      detail: { emails: issued.map((k) => k.email), failed, scheduledAt: parsed.data.scheduledAt },
    });
  }
  res.json({ issued, failed });
});

router.post("/:interviewId/resend", async (req, res) => {
  const { interviewId } = req.params;
  const interview = interviewId.includes("/") ? undefined : (await interviewsCol().doc(interviewId).get()).data();
  if (!interview || interview.schedule == null) return res.status(404).json({ error: "Scheduled interview not found." });

  // A new key invalidates the old one — only the newest hash is stored.
  const candidate = (await loadCandidates([interview.candidateId])).get(interview.candidateId);
  const issued = await issueKey(interviewId, interview, candidate);

  await recordAudit(req.admin!, {
    action: "ACCESS_KEY_REISSUED",
    targetType: "interview",
    targetId: interviewId,
    summary: `Reissued the access key for ${issued.name} (${issued.email})`,
    detail: { email: issued.email, emailSent: issued.emailSent },
  });
  res.json({ issued: [issued] });
});

router.post("/:interviewId/reschedule", async (req, res) => {
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "scheduledAt is required." });
  const { interviewId } = req.params;
  const ref = interviewsCol().doc(interviewId.includes("/") ? "_" : interviewId);
  const interview = interviewId.includes("/") ? undefined : (await ref.get()).data();
  if (!interview || interview.schedule == null) return res.status(404).json({ error: "Scheduled interview not found." });
  // Changes the datetime, restarts the reminder ladder, back to PENDING. The access key is untouched.
  const scheduledAt = new Date(parsed.data.scheduledAt);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (!current || current.schedule == null) throw new HttpError(404, "Scheduled interview not found.");
    if (!SCHEDULABLE.has(current.status)) throw new HttpError(409, NOT_SCHEDULABLE);
    tx.update(ref, {
      "schedule.scheduledAt": Timestamp.fromDate(scheduledAt),
      "schedule.reminderCount": 0,
      "schedule.lastReminderAt": null,
      status: "PENDING",
    });
  });

  await recordAudit(req.admin!, {
    action: "INTERVIEW_SCHEDULED",
    targetType: "interview",
    targetId: interviewId,
    summary: `Rescheduled ${interview.candidateId} to ${scheduledAt.toISOString()}`,
    detail: { email: interview.candidateId, scheduledAt: parsed.data.scheduledAt, rescheduled: true },
  });
  res.json({ ok: true });
});

export default router;
