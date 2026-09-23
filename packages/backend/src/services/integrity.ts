import type { ViolationType } from "../types/domain";

const VIOLATION_WEIGHTS: Record<ViolationType, number> = {
  NO_FACE: 2, GAZE_AWAY: 2, MIC_SILENCE_TIMEOUT: 2,
  MULTIPLE_FACES: 12, THIRD_PERSON: 12, PROHIBITED_OBJECT: 15,
  TAB_SWITCH: 10, COPY_PASTE: 10, MIC_PERMISSION_DENIED: 10,
  PROMPT_INJECTION: 10, FULLSCREEN_EXIT: 10,
};
const DEFAULT_WEIGHT = 5; // defensive; all 11 types are covered above

const GRACE_COUNT: Partial<Record<ViolationType, number>> = { NO_FACE: 2, GAZE_AWAY: 2, MIC_SILENCE_TIMEOUT: 1 };

const ESCALATION_PER_REPEAT = 0.3; // +30% of base per chargeable repeat
const ESCALATION_CAP = 3;          // never more than 3× base
export const NEEDS_REVIEW_THRESHOLD = 40;

export type IntegrityVerdict = "Clean" | "Minor Concerns" | "Significant Concerns" | "Major Violations — Review Required";

export interface IntegrityResult {
  score: number;
  verdict: IntegrityVerdict;
  breakdown: { type: string; count: number; pointsDeducted: number }[];
  needsReview: boolean; // a soft flag only — the interview is NEVER auto-terminated
}

export function integrityVerdict(score: number): IntegrityVerdict {
  if (score >= 90) return "Clean";
  if (score >= 70) return "Minor Concerns";
  if (score >= 40) return "Significant Concerns";
  return "Major Violations — Review Required";
}

export function computeIntegrity(types: string[]): IntegrityResult {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);

  let score = 100;
  const breakdown: IntegrityResult["breakdown"] = [];
  for (const [type, count] of counts) {
    const base = VIOLATION_WEIGHTS[type as ViolationType] ?? DEFAULT_WEIGHT;
    const grace = GRACE_COUNT[type as ViolationType] ?? 0;
    let deducted = 0;
    for (let n = 1; n <= count; n++) {
      if (n <= grace) continue;
      const chargeableN = n - grace;
      const multiplier = Math.min(1 + ESCALATION_PER_REPEAT * (chargeableN - 1), ESCALATION_CAP);
      deducted += Math.round(base * multiplier); // ROUNDS PER OCCURRENCE
    }
    score -= deducted;
    breakdown.push({ type, count, pointsDeducted: deducted });
  }
  score = Math.max(0, score); // floored at 0, never negative
  breakdown.sort((a, b) => b.pointsDeducted - a.pointsDeducted);
  return { score, verdict: integrityVerdict(score), breakdown, needsReview: score < NEEDS_REVIEW_THRESHOLD };
}

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  NO_FACE: "No face detected",
  MULTIPLE_FACES: "Multiple faces detected",
  GAZE_AWAY: "Looked away (sustained)",
  TAB_SWITCH: "Switched tabs / window",
  COPY_PASTE: "Copy-paste attempted",
  PROHIBITED_OBJECT: "Prohibited object in frame",
  THIRD_PERSON: "Third person detected",
  PROMPT_INJECTION: "Prompt-injection attempt in answer",
  MIC_PERMISSION_DENIED: "Microphone permission denied",
  MIC_SILENCE_TIMEOUT: "Prolonged silence during voice answer",
  FULLSCREEN_EXIT: "Exited fullscreen mode",
};
