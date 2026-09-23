// Firestore's .doc() throws synchronously on an ID containing "/". IDs derived from
// user input are rejected at validation time, never sanitized (sanitizing lets two
// distinct values collide).
export const NO_SLASH = (v: string) => !v.includes("/");

export const toMillis = (t: { toMillis(): number } | null | undefined): number | null => t?.toMillis?.() ?? null;
