import { z } from "zod";

// PRD §4.1. Persisted state is zod-validated on every read — never cast.

const sectionSchema = z.enum(["definitions", "scenarios", "coding"]);

export const interviewQuestionSchema = z.object({
  id: z.string(),              // the QuestionBank document id
  section: sectionSchema,
  index: z.number().int(),     // 1-based WITHIN its section
  prompt: z.string(),
  skill: z.string().nullable(),
});

export const answerRecordSchema = z.object({
  questionId: z.string(),
  answer: z.string(),
  inputMode: z.enum(["voice", "typed"]),
  score: z.literal(0),         // answers are NEVER scored individually
  feedback: z.literal("pending"),
});

export const candidateProfileSchema = z.object({
  email: z.string(),
  name: z.string(),
  refId: z.string().nullable(),
  cluster: z.string(),
  jdRef: z.string().nullable(),
  hasCoding: z.boolean(),
});

export const sectionPlanSchema = z.object({
  section: sectionSchema,
  totalQuestions: z.number().int(),
  questions: z.array(interviewQuestionSchema), // ordered basic → medium → advanced
});

export const interviewStateSchema = z.object({
  profile: candidateProfileSchema,
  plan: z.array(sectionPlanSchema),
  currentSection: sectionSchema,
  sectionStartedAt: z.number(), // epoch ms; RESET on every section transition
  currentQuestion: interviewQuestionSchema,
  answers: z.array(answerRecordSchema),
  done: z.boolean(),
});

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type AnswerRecord = z.infer<typeof answerRecordSchema>;
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type SectionPlan = z.infer<typeof sectionPlanSchema>;
export type InterviewState = z.infer<typeof interviewStateSchema>;

export function parseInterviewState(data: unknown): InterviewState {
  const result = interviewStateSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Persisted interview state failed validation: ${result.error.issues[0]?.message ?? "unknown"}`);
  }
  return result.data;
}
