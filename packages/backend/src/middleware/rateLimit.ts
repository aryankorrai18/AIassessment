import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const LOGIN_LIMIT_OPTIONS = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  message: { error: "Too many failed attempts. Please wait a few minutes and try again." },
};

// In-memory store: assumes exactly one long-running backend instance.
export const adminLoginLimiter = rateLimit(LOGIN_LIMIT_OPTIONS);

export const candidateLoginLimiter = rateLimit({
  ...LOGIN_LIMIT_OPTIONS,
  keyGenerator: (req) => {
    const empId = typeof req.body?.empId === "string" ? req.body.empId.trim().toUpperCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${empId}`;
  },
});

// Password reset: counts EVERY request (not just failures), so the endpoint can't be used
// to spam someone's inbox or brute-force reset tokens.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please wait a few minutes and try again." },
});
