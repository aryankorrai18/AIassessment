export type QuestionSection = "definitions" | "scenarios" | "coding";
export type InputMode = "voice" | "typed";

export interface CandidateProfile {
  empId: string;
  empName: string;
  cluster: string;
  jdRef: string | null;
  hasCoding: boolean;
}

export interface InterviewQuestion {
  id: string;
  section: QuestionSection;
  index: number;
  prompt: string;
  skill: string | null;
}

export interface InterviewState {
  profile: CandidateProfile;
  plan: { section: QuestionSection; totalQuestions: number; questions: InterviewQuestion[] }[];
  currentSection: QuestionSection;
  sectionStartedAt: number;
  currentQuestion: InterviewQuestion;
  answers: { questionId: string; answer: string; inputMode: InputMode }[];
  done: boolean;
}

export interface SessionResponse {
  state: InterviewState;
  startedAt: number | null;
  sectionTimeLimitMs: number;
  autoCompleted: boolean;
}

export const SECTION_LABELS: Record<QuestionSection, string> = { definitions: "Definitions", scenarios: "Scenarios", coding: "Coding" };
