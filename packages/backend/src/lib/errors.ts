import type { ZodError } from "zod";

/** An error whose message is safe to send to the client verbatim as `{ error }`. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** The schema's first issue message, or the given fallback (PRD §9 "first zod issue"). */
export function firstZodIssue(error: ZodError, fallback: string): string {
  return error.issues[0]?.message || fallback;
}
