import { FieldValue, type DocumentReference, type Timestamp, type Transaction } from "firebase-admin/firestore";
import { completedInterviewsCol, jdMasterCol } from "../lib/collections";
import { logger } from "../lib/logger";
import type { CandidateDoc, InterviewDoc } from "../types/domain";
import type { CandidateProfile } from "../types/interviewState";
import { evaluateInterview } from "./evaluation";

/** Completion writes, done inside the caller's transaction (from any completion path). */
export function completeInTransaction(tx: Transaction, interviewRef: DocumentReference<InterviewDoc>, empId: string) {
  const now = FieldValue.serverTimestamp() as unknown as Timestamp;
  tx.update(interviewRef, {
    status: "COMPLETED",
    completedAt: now,
    report: { status: "PENDING", attempts: 0, lastError: null, pdfPath: null, jsonSummary: null, generatedAt: null },
  });
  tx.set(completedInterviewsCol().doc(empId), { completedAt: now });
}

/** Fire-and-forget, after the completion transaction has committed. The candidate never waits on it. */
export function fireEvaluation(interviewId: string) {
  evaluateInterview(interviewId).catch((err) => logger.error({ err, interviewId }, "evaluateInterview threw unexpectedly"));
}

export async function buildCandidateProfile(empId: string, candidate: CandidateDoc, interview: InterviewDoc): Promise<CandidateProfile> {
  // The interview's own jdRef is immutable; Candidate.jdRef may since have been overwritten by a reassess.
  const jdRef = interview.jdRef ?? null;
  const jd = jdRef ? (await jdMasterCol().doc(jdRef).get()).data() : undefined;
  return { empId, empName: candidate.empName, cluster: candidate.skillCluster, jdRef, hasCoding: jd?.requiresCoding ?? false };
}
