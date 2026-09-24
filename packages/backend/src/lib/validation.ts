// Firestore's .doc() throws synchronously on an ID containing "/". IDs derived from
// user input are rejected at validation time, never sanitized (sanitizing lets two
// distinct values collide).
export const NO_SLASH = (v: string) => !v.includes("/");

export const toMillis = (t: { toMillis(): number } | null | undefined): number | null => t?.toMillis?.() ?? null;

/** Candidate emails are the candidate record ID: trimmed and lowercased everywhere. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A usable candidate record ID: valid email shape, and nothing Firestore rejects in a doc ID. */
export const isCandidateEmail = (email: string) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) && email.length <= 254;
