import { Router } from "express";
import { db } from "../../config/firebase";
import { candidatesCol, interviewsCol } from "../../lib/collections";
import { CANDIDATE_REFRESH_COOKIE, clearCandidateCookies, setCandidateCookies } from "../../lib/cookies";
import { compareSecret, hashToken, tokenMatchesHash } from "../../lib/hash";
import { signCandidateAccess, signCandidateRefresh, verifyCandidateRefresh } from "../../lib/jwt";
import { isCandidateEmail, normalizeEmail } from "../../lib/validation";
import { candidateLoginLimiter } from "../../middleware/rateLimit";
import { requireCandidate } from "../../middleware/requireCandidate";
import { buildCandidateProfile } from "../../services/completion";

const router = Router();

const LOGIN_FAILED = "Email or access key is incorrect, or this interview is no longer available.";
const NO_LONGER_ACTIVE = "This interview session is no longer active.";
const SESSION_EXPIRED = "Session expired — please log in again.";

router.post("/login", candidateLoginLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
  const accessKey = typeof req.body?.accessKey === "string" ? req.body.accessKey.trim().toUpperCase() : "";
  if (!accessKey || !isCandidateEmail(email)) return res.status(401).json({ error: LOGIN_FAILED });

  const candidate = (await candidatesCol().doc(email).get()).data();
  if (!candidate) return res.status(401).json({ error: LOGIN_FAILED });

  // Check the key against EVERY open, scheduled interview for this candidate.
  const open = await interviewsCol().where("candidateId", "==", email).where("status", "in", ["PENDING", "ACTIVE"]).get();
  let match: (typeof open.docs)[number] | undefined;
  for (const d of open.docs) {
    const iv = d.data();
    if (iv.schedule && iv.accessKeyHash && (await compareSecret(accessKey, iv.accessKeyHash))) {
      match = d;
      break;
    }
  }
  if (!match) return res.status(401).json({ error: LOGIN_FAILED });

  const refresh = signCandidateRefresh(match.id, email);
  // Logging in moves the interview off PENDING (so the no-show ladder stops for it).
  const status = await db.runTransaction(async (tx) => {
    const current = (await tx.get(match!.ref)).data();
    if (!current || (current.status !== "PENDING" && current.status !== "ACTIVE")) return null;
    tx.update(match!.ref, { status: "ACTIVE", refreshTokenHash: hashToken(refresh) });
    return current.status;
  });
  if (!status) return res.status(401).json({ error: LOGIN_FAILED });

  setCandidateCookies(res, signCandidateAccess(match.id, email), refresh);
  const profile = await buildCandidateProfile(email, candidate, match.data());
  res.json({ profile, interviewStatus: status });
});

router.post("/refresh", async (req, res) => {
  const token: string | undefined = req.cookies?.[CANDIDATE_REFRESH_COOKIE];
  const payload = verifyCandidateRefresh(token);
  if (!token || !payload) {
    clearCandidateCookies(res);
    return res.status(401).json({ error: SESSION_EXPIRED });
  }

  const ref = interviewsCol().doc(payload.interviewId);
  const outcome = await db.runTransaction(async (tx) => {
    const interview = (await tx.get(ref)).data();
    if (!interview || (interview.status !== "PENDING" && interview.status !== "ACTIVE")) return { error: NO_LONGER_ACTIVE };
    if (!tokenMatchesHash(token, interview.refreshTokenHash)) {
      // Replay of an already-rotated token: revoke the live session too.
      tx.update(ref, { refreshTokenHash: null });
      return { error: SESSION_EXPIRED };
    }
    const refresh = signCandidateRefresh(payload.interviewId, payload.email);
    tx.update(ref, { refreshTokenHash: hashToken(refresh) });
    return { access: signCandidateAccess(payload.interviewId, payload.email), refresh };
  });

  if ("error" in outcome) {
    clearCandidateCookies(res);
    return res.status(401).json({ error: outcome.error });
  }
  setCandidateCookies(res, outcome.access, outcome.refresh);
  res.json({ ok: true });
});

router.get("/me", requireCandidate, async (req, res) => {
  const { interviewId, email } = req.candidateSession!;
  const [interviewSnap, candidateSnap] = await Promise.all([interviewsCol().doc(interviewId).get(), candidatesCol().doc(email).get()]);
  const interview = interviewSnap.data();
  const candidate = candidateSnap.data();
  if (!interview || !candidate) return res.status(401).json({ error: "Not authenticated" });
  res.json({ profile: await buildCandidateProfile(email, candidate, interview), interviewStatus: interview.status });
});

// No guard: logging out must always work.
router.post("/logout", async (req, res) => {
  const payload = verifyCandidateRefresh(req.cookies?.[CANDIDATE_REFRESH_COOKIE]);
  if (payload) await interviewsCol().doc(payload.interviewId).update({ refreshTokenHash: null }).catch(() => undefined);
  clearCandidateCookies(res);
  res.json({ ok: true });
});

export default router;
