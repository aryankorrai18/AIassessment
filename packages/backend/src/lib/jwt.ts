import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AdminRole } from "../types/domain";

// Both token kinds share one secret, so the `type` claim is the only thing
// preventing an access token being replayed at a refresh endpoint.

export const ADMIN_ACCESS_TTL = "15m";
export const ADMIN_REFRESH_TTL = "8h";
export const CANDIDATE_ACCESS_TTL = "15m";
export const CANDIDATE_REFRESH_TTL = "4h";

type TokenType = "access" | "refresh";

export interface AdminTokenPayload { adminId: string; role: AdminRole; type: TokenType }
export interface CandidateTokenPayload { interviewId: string; email: string; type: TokenType }

function sign(payload: object, expiresIn: "15m" | "8h" | "4h"): string {
  // jwtid makes two tokens minted in the same second distinct, so a rotated
  // refresh token never hashes identically to its predecessor.
  return jwt.sign(payload, env.jwtSecret, { expiresIn, jwtid: randomUUID() });
}

function verify<T extends { type: TokenType }>(token: string | undefined, type: TokenType, required: (keyof T)[]): T | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded !== "object" || decoded === null) return null;
    const payload = decoded as unknown as T;
    if (payload.type !== type) return null;
    for (const key of required) if (typeof payload[key] !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export const signAdminAccess = (adminId: string, role: AdminRole) =>
  sign({ adminId, role, type: "access" }, ADMIN_ACCESS_TTL);
export const signAdminRefresh = (adminId: string, role: AdminRole) =>
  sign({ adminId, role, type: "refresh" }, ADMIN_REFRESH_TTL);
export const signCandidateAccess = (interviewId: string, email: string) =>
  sign({ interviewId, email, type: "access" }, CANDIDATE_ACCESS_TTL);
export const signCandidateRefresh = (interviewId: string, email: string) =>
  sign({ interviewId, email, type: "refresh" }, CANDIDATE_REFRESH_TTL);

export const verifyAdminAccess = (t: string | undefined) => verify<AdminTokenPayload>(t, "access", ["adminId", "role"]);
export const verifyAdminRefresh = (t: string | undefined) => verify<AdminTokenPayload>(t, "refresh", ["adminId", "role"]);
export const verifyCandidateAccess = (t: string | undefined) => verify<CandidateTokenPayload>(t, "access", ["interviewId", "email"]);
export const verifyCandidateRefresh = (t: string | undefined) => verify<CandidateTokenPayload>(t, "refresh", ["interviewId", "email"]);
