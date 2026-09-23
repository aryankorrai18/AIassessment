export type AdminRole = "MASTER_ADMIN" | "ADMIN";
export type ExpectedLevel = "L1" | "L2" | "L3";
export type InterviewStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "NO_SHOW";
export type ReportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type InputMode = "voice" | "typed";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  createdBy: string | null;
  createdAt: number;
}

export interface RequiredSkill {
  skill: string;
  expectedLevel: ExpectedLevel;
  weight: number;
}

export interface JdListRow {
  jdRef: string;
  title: string;
  skillCluster: string;
  requiresCoding: boolean;
  hasQuestions: boolean;
  questionCount: number;
}

export interface JdDetail {
  jdRef: string;
  title: string;
  jobRole: string | null;
  skillCluster: string;
  requiredSkills: RequiredSkill[];
  responsibilities: string[];
  experienceYears: string | null;
  requiresCoding: boolean;
  jdText: string;
  hasQuestions: boolean;
}

export interface JdExtraction {
  jobRole: string | null;
  skillCluster: string;
  requiredSkills: RequiredSkill[];
  responsibilities: string[];
  experienceYears: string | null;
  requiresCoding: boolean;
  jdText: string;
}

export interface CandidateRow {
  empId: string;
  empName: string;
  empEmail: string;
  skills: string[];
  tier: string;
  skillCluster: string;
  jdRef: string | null;
  category: string | null;
  batchId?: string;
  createdAt: number | null;
  interviewStatus: InterviewStatus | null;
  interviewCount: number;
}

export interface QuestionRow {
  id: string;
  jdRef: string | null;
  cluster: string;
  section: "definitions" | "scenarios" | "coding";
  tier: string;
  difficulty: "basic" | "medium" | "advanced";
  question: string;
  skill: string | null;
  createdAt: number | null;
}

export interface UnscheduledRow {
  interviewId: string;
  empId: string;
  empName: string;
  empEmail: string;
  cluster: string;
  jdRef: string | null;
}

export interface ScheduledRow extends UnscheduledRow {
  status: InterviewStatus;
  scheduledAt: number;
  reminderCount: number;
}

export interface IssuedKey {
  empId: string;
  name: string;
  empEmail: string;
  key: string;
  scheduledAt: number;
  emailSent: boolean;
  emailPreviewUrl: string | null;
}

export interface LiveRow {
  interviewId: string;
  candidateName: string;
  cluster: string;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
}

export interface SkillGapEntry {
  skill: string;
  expectedLevel: string;
  demonstratedLevel: string;
  met: boolean;
}

export type IntegrityVerdict = "Clean" | "Minor Concerns" | "Significant Concerns" | "Major Violations — Review Required";

export interface ResultRow {
  interviewId: string;
  empId: string;
  candidateName: string;
  cluster: string;
  jdTitle: string | null;
  batchId: string | null;
  status: "COMPLETED" | "EVAL_FAILED" | "NO_SHOW";
  reportStatus: ReportStatus | null;
  score: number | null;
  category: string | null;
  skillGap: SkillGapEntry[];
  violationCount: number;
  integrityScore: number;
  integrityVerdict: IntegrityVerdict;
  needsReview: boolean;
  pdfPath: string | null;
  completedAt: number | null;
}

export interface EvaluationResult {
  overallScore: number;
  category: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  sectionScores: { section: string; score: number; note: string }[];
  skillGap: SkillGapEntry[];
}

export interface ResultDetail {
  interviewId: string;
  reportStatus: ReportStatus | null;
  lastError: string | null;
  evaluation: EvaluationResult | null;
  jdSnapshot: { title: string; requiredSkills: RequiredSkill[]; experienceYears: string | null } | null;
  transcript: { section: string; question: string; answer: string; inputMode: InputMode | null; skill: string | null; reached: boolean }[];
  violations: { id: string; type: string; occurredAt: number; snapshot: string | null }[];
  integrity: { score: number; verdict: IntegrityVerdict; breakdown: { type: string; count: number; pointsDeducted: number }[]; needsReview: boolean };
}

export interface ApiUsageRow {
  id: string;
  purpose: string;
  model: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  createdAt: number | null;
}

export interface ApiUsage {
  summary: {
    totalCalls: number;
    totalPromptTokens: number;
    totalResponseTokens: number;
    totalTokens: number;
    byPurpose: Record<string, { calls: number; totalTokens: number }>;
    byModel: Record<string, { calls: number; totalTokens: number }>;
    last24h: { calls: number; totalTokens: number };
  };
  recent: ApiUsageRow[];
}

export interface AuditRow {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  targetType: string;
  targetId: string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: number | null;
}

export interface GeminiKeyStatus {
  isSet: boolean;
  maskedKey: string | null;
  updatedAt: number | null;
  updatedByName: string | null;
  usingEnvFallback: boolean;
}
