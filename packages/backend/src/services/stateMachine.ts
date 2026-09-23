import type { QuestionSection } from "../types/domain";
import type { AnswerRecord, CandidateProfile, InterviewState, SectionPlan } from "../types/interviewState";

// Per section, restarted on every section transition. Coding track 90 min, non-coding 60 min.
export const SECTION_TIME_LIMITS_MS: Record<QuestionSection, number> = {
  definitions: 25 * 60 * 1000, // 1,500,000
  scenarios: 35 * 60 * 1000,   // 2,100,000
  coding: 30 * 60 * 1000,      // 1,800,000
};

export function initialState(profile: CandidateProfile, plan: SectionPlan[], now = Date.now()): InterviewState {
  return {
    profile,
    plan,
    currentSection: plan[0].section,
    sectionStartedAt: now,
    currentQuestion: plan[0].questions[0],
    answers: [],
    done: false,
  };
}

/** Reactive expiry, checked on every session-touching request — there is no timer thread. */
export function isExpired(state: InterviewState, now = Date.now()): boolean {
  return !state.done && now >= state.sectionStartedAt + SECTION_TIME_LIMITS_MS[state.currentSection];
}

/** Moves to the first question of the next section (resetting the section clock), or finishes. */
function enterNextSection(state: InterviewState, answers: AnswerRecord[], now: number): InterviewState {
  const sectionIdx = state.plan.findIndex((sp) => sp.section === state.currentSection);
  const next = state.plan[sectionIdx + 1];
  if (!next) return { ...state, answers, done: true };
  return { ...state, answers, currentSection: next.section, currentQuestion: next.questions[0], sectionStartedAt: now };
}

/** Pure. Records `answer` (if any) for the open question and moves on. */
export function advance(state: InterviewState, answer: AnswerRecord | null, now = Date.now()): InterviewState {
  if (state.done) return state;
  const answers = answer ? [...state.answers, answer] : state.answers;
  const section = state.plan.find((sp) => sp.section === state.currentSection)!;
  const pos = section.questions.findIndex((q) => q.id === state.currentQuestion.id);
  const nextQuestion = section.questions[pos + 1];
  // Within a section the clock keeps running; only a section boundary resets it.
  if (nextQuestion) return { ...state, answers, currentQuestion: nextQuestion };
  return enterNextSection(state, answers, now);
}

/** Pure. Abandons the rest of the current section — the open question gets NO AnswerRecord. */
export function skipSection(state: InterviewState, now = Date.now()): InterviewState {
  if (state.done) return state;
  return enterNextSection(state, state.answers, now);
}
