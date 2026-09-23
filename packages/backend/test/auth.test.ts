import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { hashToken, tokenMatchesHash } from "../src/lib/hash";
import {
  signAdminAccess, signAdminRefresh, signCandidateAccess, signCandidateRefresh,
  verifyAdminAccess, verifyAdminRefresh, verifyCandidateAccess, verifyCandidateRefresh,
} from "../src/lib/jwt";

describe("JWT type-claim checks", () => {
  it("accepts each token at its own verifier", () => {
    expect(verifyAdminAccess(signAdminAccess("a1", "ADMIN"))).toMatchObject({ adminId: "a1", role: "ADMIN", type: "access" });
    expect(verifyAdminRefresh(signAdminRefresh("a1", "MASTER_ADMIN"))).toMatchObject({ adminId: "a1", type: "refresh" });
    expect(verifyCandidateAccess(signCandidateAccess("i1", "E1"))).toMatchObject({ interviewId: "i1", empId: "E1", type: "access" });
    expect(verifyCandidateRefresh(signCandidateRefresh("i1", "E1"))).toMatchObject({ type: "refresh" });
  });

  it("rejects an access token presented at /refresh (acceptance #24)", () => {
    expect(verifyAdminRefresh(signAdminAccess("a1", "ADMIN"))).toBeNull();
    expect(verifyCandidateRefresh(signCandidateAccess("i1", "E1"))).toBeNull();
  });

  it("rejects a refresh token used as an access token", () => {
    expect(verifyAdminAccess(signAdminRefresh("a1", "ADMIN"))).toBeNull();
    expect(verifyCandidateAccess(signCandidateRefresh("i1", "E1"))).toBeNull();
  });

  it("does not let a candidate token pass as an admin token", () => {
    expect(verifyAdminAccess(signCandidateAccess("i1", "E1"))).toBeNull();
  });

  it("returns null (never throws) for garbage, missing, wrong-secret and expired tokens", () => {
    expect(verifyAdminAccess(undefined)).toBeNull();
    expect(verifyAdminAccess("not-a-jwt")).toBeNull();
    expect(verifyAdminAccess(jwt.sign({ adminId: "a", role: "ADMIN", type: "access" }, "other-secret"))).toBeNull();
    const expired = jwt.sign({ adminId: "a", role: "ADMIN", type: "access", exp: Math.floor(Date.now() / 1000) - 10 }, "test-secret");
    expect(verifyAdminAccess(expired)).toBeNull();
  });

  it("mints distinct refresh tokens even within the same second", () => {
    expect(signAdminRefresh("a1", "ADMIN")).not.toBe(signAdminRefresh("a1", "ADMIN"));
  });
});

describe("refresh token hash", () => {
  it("matches only the token it was computed from", () => {
    const t1 = signAdminRefresh("a1", "ADMIN");
    const t2 = signAdminRefresh("a1", "ADMIN");
    const stored = hashToken(t1);
    expect(tokenMatchesHash(t1, stored)).toBe(true);
    expect(tokenMatchesHash(t2, stored)).toBe(false);
    expect(tokenMatchesHash(t1, null)).toBe(false);
  });
});
