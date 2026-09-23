import type { NextFunction, Request, Response } from "express";
import { interviewsCol } from "../lib/collections";
import { CANDIDATE_COOKIE } from "../lib/cookies";
import { verifyCandidateAccess } from "../lib/jwt";

/**
 * The server-side half of the one-attempt guard: the moment an interview leaves
 * PENDING/ACTIVE, an existing token stops working.
 */
export async function requireCandidate(req: Request, res: Response, next: NextFunction) {
  const payload = verifyCandidateAccess(req.cookies?.[CANDIDATE_COOKIE]);
  if (!payload) return res.status(401).json({ error: "Not authenticated" });

  const interview = (await interviewsCol().doc(payload.interviewId).get()).data();
  if (!interview || (interview.status !== "PENDING" && interview.status !== "ACTIVE")) {
    return res.status(401).json({ error: "This interview session is no longer active." });
  }

  req.candidateSession = { interviewId: payload.interviewId, empId: payload.empId };
  next();
}
