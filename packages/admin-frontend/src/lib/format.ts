export const fmtDateTime = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const fmtDateTimeSeconds = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString() : "—");

/** The interview score is stored 0–100 but always displayed out of 10. */
export const score10 = (score: number | null | undefined) => (score === null || score === undefined ? "—" : (score / 10).toFixed(1));

export const ymd = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** "Nm SSs" */
export const fmtElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Value for a <input type="datetime-local"> from epoch ms, in local time. */
export const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export const VIOLATION_LABELS: Record<string, string> = {
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

export const defaultWeightForLevel = (level: "L1" | "L2" | "L3") => (level === "L3" ? 10 : level === "L2" ? 6 : 3);
