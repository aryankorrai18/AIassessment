import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

export const ADMIN_COOKIE = "admin_token";
export const ADMIN_REFRESH_COOKIE = "admin_refresh_token";
export const CANDIDATE_COOKIE = "candidate_token";
export const CANDIDATE_REFRESH_COOKIE = "candidate_refresh_token";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const base = (sameSite: "strict" | "lax"): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite,
  path: "/",
});

export function setAdminCookies(res: Response, access: string, refresh: string) {
  res.cookie(ADMIN_COOKIE, access, { ...base("strict"), maxAge: 15 * MIN });
  res.cookie(ADMIN_REFRESH_COOKIE, refresh, { ...base("strict"), maxAge: 8 * HOUR });
}

export function clearAdminCookies(res: Response) {
  res.clearCookie(ADMIN_COOKIE, base("strict"));
  res.clearCookie(ADMIN_REFRESH_COOKIE, base("strict"));
}

export function setCandidateCookies(res: Response, access: string, refresh: string) {
  res.cookie(CANDIDATE_COOKIE, access, { ...base("lax"), maxAge: 15 * MIN });
  res.cookie(CANDIDATE_REFRESH_COOKIE, refresh, { ...base("lax"), maxAge: 4 * HOUR });
}

export function clearCandidateCookies(res: Response) {
  res.clearCookie(CANDIDATE_COOKIE, base("lax"));
  res.clearCookie(CANDIDATE_REFRESH_COOKIE, base("lax"));
}
