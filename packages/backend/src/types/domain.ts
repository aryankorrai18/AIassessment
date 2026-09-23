import type { Timestamp } from "firebase-admin/firestore";

export type AdminRole = "MASTER_ADMIN" | "ADMIN";
export type ExpectedLevel = "L1" | "L2" | "L3";
export type InterviewStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "NO_SHOW";
export type ReportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type QuestionSection = "definitions" | "scenarios" | "coding";
export type QuestionDifficulty = "basic" | "medium" | "advanced";
export type InputMode = "voice" | "typed";

export const VIOLATION_TYPES = [
  "TAB_SWITCH", "COPY_PASTE", "NO_FACE", "MULTIPLE_FACES", "GAZE_AWAY",
  "PROHIBITED_OBJECT", "THIRD_PERSON", "PROMPT_INJECTION",
  "MIC_PERMISSION_DENIED", "MIC_SILENCE_TIMEOUT", "FULLSCREEN_EXIT",
] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export type AuditAction =
  | "CANDIDATE_DELETED" | "CANDIDATE_IMPORTED"
  | "JD_CREATED" | "JD_UPDATED" | "JD_DELETED"
  | "QUESTION_BANK_GENERATED" | "QUESTION_BANK_CLEARED" | "QUESTION_DELETED"
  | "ADMIN_CREATED" | "ADMIN_DEACTIVATED"
  | "INTERVIEW_SCHEDULED" | "ACCESS_KEY_REISSUED" | "INTERVIEW_ATTEMPT_ADDED"
  | "GEMINI_KEY_UPDATED" | "GEMINI_KEY_CLEARED" | "ADMIN_PROFILE_UPDATED"
  | "ADMIN_PASSWORD_RESET"; // addition beyond the PRD: self-service password reset

export interface RequiredSkill {
  skill: string;
  expectedLevel: ExpectedLevel;
  weight: number; // 1-10, interview emphasis. Derived from level, admin-editable.
}

// Collection: adminUsers (doc ID generated)
export interface AdminUserDoc {
  email: string;            // unique, lowercased
  name: string;
  passwordHash: string;     // bcrypt
  role: AdminRole;
  createdBy: string | null; // null for the seed account
  isActive: boolean;        // re-checked on EVERY request, not just login
  refreshTokenHash?: string | null; // rotated per refresh, nulled on logout/reuse
  passwordResetTokenHash?: string | null; // SHA-256 of a single-use reset token
  passwordResetExpiresAt?: Timestamp | null;
  createdAt: Timestamp;
}

// Collection: jdMaster (doc ID = jdRef = title.trim().toLowerCase())
export interface JdMasterDoc {
  title: string;              // original casing
  jobRole: string | null;
  skillCluster: string;
  requiredSkills: RequiredSkill[];
  responsibilities: string[];
  experienceYears: string | null; // free text band, e.g. "5-8"
  requiresCoding: boolean;
  jdText: string;
  hasQuestions?: boolean;     // denormalized; treat undefined as false
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Collection: candidates (doc ID = empId)
export interface CandidateDoc {
  empName: string;
  empEmail: string;
  skills: string[];        // top-5-by-weight from the matched JD
  tier: string;            // STRING "1".."4", not a number
  skillCluster: string;
  jdRef: string | null;    // MUTABLE — overwritten by every /reassess
  category: string | null; // mirrors the most recent completed evaluation
  batchId?: string;        // ISO string, shared across one whole import operation
  createdAt: Timestamp;
}

export interface InterviewScheduleEmbed {
  scheduledAt: Timestamp;
  reminderCount: number;
  lastReminderAt: Timestamp | null;
  noShow: boolean;
  escalatedAt: Timestamp | null;
}

export interface ReportEmbed {
  status: ReportStatus;
  attempts: number;
  lastError: string | null;
  pdfPath: string | null;  // ALWAYS null — PDFs are generated on demand, never stored
  jsonSummary: Record<string, unknown> | null; // real shape: EvaluationResult
  generatedAt: Timestamp | null;
}

export interface JdSnapshot {
  title: string;
  requiredSkills: RequiredSkill[];
  experienceYears: string | null;
}

// Collection: interviews (doc ID generated). One candidate MAY have several.
export interface InterviewDoc {
  candidateId: string;     // = Candidate doc ID (empId)
  jdRef?: string | null;   // IMMUTABLE, captured at interview creation
  accessKeyHash: string;   // bcrypt; raw key never stored
  status: InterviewStatus;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  lastHeartbeatAt: Timestamp | null;
  jdSnapshot: JdSnapshot | null;
  schedule: InterviewScheduleEmbed | null;
  report: ReportEmbed | null;
  refreshTokenHash?: string | null;
  createdAt: Timestamp;
}

// Subcollection: interviews/{id}/session/current (single doc)
export interface SessionDoc {
  data: Record<string, unknown>; // real shape: InterviewState; ALWAYS zod-parse on read
  version: number;               // optimistic lock counter
  updatedAt: Timestamp;
}

// Subcollection: interviews/{id}/violations/{violationId}
export interface ViolationDoc {
  type: ViolationType;
  detail: Record<string, unknown>;
  mediaPath: string | null; // inline base64 JPEG data URL, or null
  occurredAt: Timestamp;
}

// Collection: questionBank
export interface QuestionBankDoc {
  jdRef: string | null;     // null = generic cluster-level pool
  cluster: string;
  section: QuestionSection;
  tier: string;
  difficulty: QuestionDifficulty;
  question: string;
  skill?: string | null;    // validated against the JD's real skill list, never free text
  createdAt: Timestamp;
}

export interface DemandClusterDoc { unitSkills: string[] }          // doc ID = cluster name
export interface CompletedInterviewDoc { completedAt: Timestamp }    // doc ID = empId; write-only marker

export interface ApiUsageLogDoc {
  purpose: string; promptTokens: number; responseTokens: number;
  totalTokens: number; model: string; streamed: boolean; createdAt: Timestamp;
}

export interface MasterExportDoc {
  generatedBy: string; filePath: string; rowCount: number; createdAt: Timestamp;
}

// Collection: appSettings (doc ID = "gemini")
export interface GeminiKeySettingDoc {
  apiKey: string; updatedAt: Timestamp; updatedBy: string; updatedByName: string;
}

// Collection: auditLog. Actor identity is DENORMALIZED at write time so a later
// rename/deactivation cannot retroactively alter history.
export interface AuditLogDoc {
  action: AuditAction;
  actorId: string; actorName: string; actorEmail: string;
  targetType: string; targetId: string;
  summary: string;                     // human one-liner, built at write time
  detail: Record<string, unknown>;
  createdAt: Timestamp;
}

// ---- Evaluation result (PRD §4.2) ----
export interface EvaluationResult {
  overallScore: number;   // 0-100
  category: string;       // "Category 1" | "Category 2" | "Category 3"
  summary: string;
  strengths: string[];
  improvements: string[];
  sectionScores: { section: string; score: number; note: string }[];  // score 0-100
  skillGap: { skill: string; expectedLevel: string; demonstratedLevel: string; met: boolean }[];
}
