import { FieldValue, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import cron from "node-cron";
import { db } from "../config/firebase";
import { env } from "../config/env";
import { adminUsersCol, candidatesCol, interviewsCol, sessionDoc } from "../lib/collections";
import { logger } from "../lib/logger";
import type { InterviewDoc, ReportStatus } from "../types/domain";
import { parseInterviewState } from "../types/interviewState";
import { completeInTransaction } from "./completion";
import { noShowEscalationEmail, reminderEmail, sendEmail } from "./email";
import { evaluateInterview } from "./evaluation";

const MAX_REMINDERS = 3;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const REPORT_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------- No-show reminder ladder (daily 09:00) ----------

export async function runNoShowSweep() {
  const result = { checked: 0, reminded: 0, escalated: 0, errors: [] as string[] };
  const now = Date.now();
  // A candidate logging in moves the interview off PENDING, so it drops out of this query.
  const snap = await interviewsCol().where("status", "==", "PENDING").get();

  for (const d of snap.docs) {
    const interview = d.data();
    if (!interview.schedule) continue;
    result.checked++;
    try {
      const { scheduledAt, lastReminderAt, reminderCount } = interview.schedule;
      const since = (lastReminderAt ?? scheduledAt).toMillis();
      if (now - since < env.noShowReminderIntervalMs) continue;

      const candidate = (await candidatesCol().doc(interview.candidateId).get()).data();
      const name = candidate?.name ?? interview.candidateId;

      if (reminderCount < MAX_REMINDERS) {
        await sendEmail(reminderEmail({ to: interview.candidateId, name, scheduledAt: scheduledAt.toDate(), reminderNumber: reminderCount + 1 }));
        await d.ref.update({ "schedule.reminderCount": reminderCount + 1, "schedule.lastReminderAt": Timestamp.now() });
        result.reminded++;
      } else {
        await d.ref.update({ status: "NO_SHOW", "schedule.noShow": true, "schedule.escalatedAt": Timestamp.now() });
        const masters = await adminUsersCol().where("role", "==", "MASTER_ADMIN").where("isActive", "==", true).get();
        await Promise.all(masters.docs.map((m) => sendEmail(noShowEscalationEmail({
          to: m.data().email, candidateName: name, candidateEmail: interview.candidateId, refId: candidate?.refId ?? null, scheduledAt: scheduledAt.toDate(),
        }))));
        result.escalated++;
      }
    } catch (err) {
      result.errors.push(`${d.id}: ${errorText(err)}`);
    }
  }
  return result;
}

// ---------- Idle interview sweep (every 15 min) ----------

/**
 * Force-completes ACTIVE interviews whose heartbeat went stale. Deliberately separate from
 * the per-section reactive timer: an abandoned interview would otherwise idle through each
 * remaining section's full budget one tick at a time.
 */
export async function runIdleSweep() {
  const result = { checked: 0, finalized: 0, errors: [] as string[] };
  const snap = await interviewsCol().where("status", "==", "ACTIVE").get();

  for (const d of snap.docs) {
    result.checked++;
    const interview = d.data();
    const lastSignal = (interview.lastHeartbeatAt ?? interview.startedAt ?? null)?.toMillis() ?? null;
    if (lastSignal === null || Date.now() - lastSignal < IDLE_THRESHOLD_MS) continue;
    try {
      // Inside a transaction so a concurrent answer/expiry that already finished it no-ops.
      const finalized = await db.runTransaction(async (tx) => {
        const [current, session] = await Promise.all([tx.get(d.ref), tx.get(sessionDoc(d.id))]);
        if (current.data()?.status !== "ACTIVE") return false;
        if (session.exists) {
          const state = parseInterviewState(session.data()!.data);
          if (!state.done) {
            tx.update(sessionDoc(d.id), { data: { ...state, done: true }, version: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
          }
        }
        completeInTransaction(tx, d.ref, interview.candidateId);
        return true;
      });
      if (finalized) {
        result.finalized++;
        await evaluateInterview(d.id);
      }
    } catch (err) {
      result.errors.push(`${d.id}: ${errorText(err)}`);
    }
  }
  return result;
}

// ---------- Report retry sweep (every 15 min) ----------

export async function runReportRetrySweep() {
  const result = { checked: 0, retried: 0, errors: [] as string[] };
  // Three equality-only queries merged in code, so no composite index is needed.
  const statuses: ReportStatus[] = ["PENDING", "PROCESSING", "FAILED"];
  const snaps = await Promise.all(statuses.map((s) => interviewsCol().where("status", "==", "COMPLETED").where("report.status", "==", s).get()));
  const docs = new Map<string, QueryDocumentSnapshot<InterviewDoc>>();
  snaps.forEach((s) => s.docs.forEach((d) => docs.set(d.id, d)));

  const now = Date.now();
  for (const d of docs.values()) {
    result.checked++;
    const interview = d.data();
    const completedAt = interview.completedAt?.toMillis() ?? 0;
    if (now - completedAt < REPORT_RETRY_MIN_AGE_MS) continue; // plausibly still in flight
    if ((interview.report?.attempts ?? 0) >= MAX_ATTEMPTS) continue; // needs a human, not another retry
    try {
      await evaluateInterview(d.id);
      result.retried++;
    } catch (err) {
      result.errors.push(`${d.id}: ${errorText(err)}`);
    }
  }
  return result;
}

// ---------- Scheduling (in-process: assumes exactly one long-running instance) ----------

export function startSweeps() {
  const guard = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      logger.info({ sweep: name, result: await fn() }, "Sweep finished");
    } catch (err) {
      logger.error({ err, sweep: name }, "Sweep failed");
    }
  };
  cron.schedule("0 9 * * *", guard("no-show", runNoShowSweep));
  cron.schedule("*/15 * * * *", guard("idle", runIdleSweep));
  cron.schedule("*/15 * * * *", guard("report-retry", runReportRetrySweep));
  logger.info("Background sweeps scheduled");
}
