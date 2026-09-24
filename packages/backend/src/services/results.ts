import { candidatesCol, interviewsCol, sessionDoc, violationsCol } from "../lib/collections";
import { toMillis } from "../lib/validation";
import type { CandidateDoc, EvaluationResult, InputMode, InterviewDoc, JdSnapshot, ReportStatus, ViolationType } from "../types/domain";
import { parseInterviewState } from "../types/interviewState";
import { computeIntegrity, type IntegrityResult } from "./integrity";

export interface TranscriptRow {
  section: string;
  question: string;
  answer: string;
  inputMode: InputMode | null;
  skill: string | null;
  reached: boolean;
}

export interface ResultDetail {
  interviewId: string;
  reportStatus: ReportStatus | null;
  lastError: string | null;
  evaluation: EvaluationResult | null;
  jdSnapshot: JdSnapshot | null;
  transcript: TranscriptRow[];
  violations: { id: string; type: ViolationType; occurredAt: number; snapshot: string | null }[];
  integrity: IntegrityResult;
}

export async function loadViolations(interviewId: string) {
  const snap = await violationsCol(interviewId).orderBy("occurredAt", "asc").get();
  return snap.docs.map((d) => {
    const v = d.data();
    return { id: d.id, type: v.type, occurredAt: toMillis(v.occurredAt) ?? 0, snapshot: v.mediaPath ?? null };
  });
}

export async function loadResultDetail(interviewId: string, interview: InterviewDoc): Promise<ResultDetail> {
  const [sessionSnap, violations] = await Promise.all([sessionDoc(interviewId).get(), loadViolations(interviewId)]);

  const transcript: TranscriptRow[] = [];
  if (sessionSnap.exists) {
    const state = parseInterviewState(sessionSnap.data()!.data);
    const answerById = new Map(state.answers.map((a) => [a.questionId, a]));
    for (const sp of state.plan) for (const q of sp.questions) {
      const a = answerById.get(q.id);
      transcript.push({ section: sp.section, question: q.prompt, answer: a?.answer ?? "", inputMode: a?.inputMode ?? null, skill: q.skill, reached: a !== undefined });
    }
  }

  return {
    interviewId,
    reportStatus: interview.report?.status ?? null,
    lastError: interview.report?.lastError ?? null,
    evaluation: (interview.report?.status === "COMPLETED" ? interview.report.jsonSummary : null) as EvaluationResult | null,
    jdSnapshot: interview.jdSnapshot ?? null,
    transcript,
    violations,
    integrity: computeIntegrity(violations.map((v) => v.type)),
  };
}

export async function loadCandidate(email: string): Promise<CandidateDoc | undefined> {
  if (!email || email.includes("/")) return undefined;
  return (await candidatesCol().doc(email).get()).data();
}

export async function getInterview(interviewId: string) {
  if (!interviewId || interviewId.includes("/")) return undefined;
  return (await interviewsCol().doc(interviewId).get()).data();
}
