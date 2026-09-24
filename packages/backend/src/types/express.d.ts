import type { AdminRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      admin?: { id: string; role: AdminRole; name: string; email: string };
      candidateSession?: { interviewId: string; email: string };
    }
  }
}

export {};
