import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { adminUsersCol } from "../../lib/collections";
import { ADMIN_REFRESH_COOKIE, clearAdminCookies, setAdminCookies } from "../../lib/cookies";
import { firstZodIssue } from "../../lib/errors";
import { compareSecret, hashSecret, hashSecretSync, hashToken, tokenMatchesHash } from "../../lib/hash";
import { signAdminAccess, signAdminRefresh, verifyAdminRefresh } from "../../lib/jwt";
import { adminLoginLimiter, passwordResetLimiter } from "../../middleware/rateLimit";
import { requireAdmin, requireRole } from "../../middleware/requireAdmin";
import { passwordResetEmail, sendEmail } from "../../services/email";
import type { AdminRole, AdminUserDoc } from "../../types/domain";

const router = Router();

const LOGIN_FAILED = "Email or password is incorrect.";
const SESSION_EXPIRED = "Session expired — please log in again.";

// A real bcrypt hash of a random value, compared against when the account does not
// exist so a missing account costs the same time as a wrong password.
const DUMMY_HASH = hashSecretSync(randomUUID());

export function toAdminUser(id: string, doc: AdminUserDoc) {
  return {
    id,
    email: doc.email,
    name: doc.name,
    role: doc.role,
    isActive: doc.isActive,
    createdBy: doc.createdBy ?? null,
    createdAt: doc.createdAt?.toMillis?.() ?? 0,
  };
}

/** Mints a fresh access/refresh pair, stores the refresh hash, sets both cookies. */
async function issueSession(res: Response, adminId: string, role: AdminRole) {
  const access = signAdminAccess(adminId, role);
  const refresh = signAdminRefresh(adminId, role);
  await adminUsersCol().doc(adminId).update({ refreshTokenHash: hashToken(refresh) });
  setAdminCookies(res, access, refresh);
}

router.post("/login", adminLoginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const snap = await adminUsersCol().where("email", "==", email.trim().toLowerCase()).limit(1).get();
  const doc = snap.docs[0];
  const admin = doc?.data();
  const passwordOk = await compareSecret(password, admin?.passwordHash ?? DUMMY_HASH);
  // Same string for no-such-account, inactive and wrong password — deliberately indistinguishable.
  if (!doc || !admin || !admin.isActive || !passwordOk) return res.status(401).json({ error: LOGIN_FAILED });

  await issueSession(res, doc.id, admin.role);
  res.json(toAdminUser(doc.id, admin));
});

router.post("/refresh", async (req, res) => {
  const token: string | undefined = req.cookies?.[ADMIN_REFRESH_COOKIE];
  const payload = verifyAdminRefresh(token);
  if (!token || !payload) {
    clearAdminCookies(res);
    return res.status(401).json({ error: SESSION_EXPIRED });
  }

  const ref = adminUsersCol().doc(payload.adminId);
  const outcome = await db.runTransaction(async (tx) => {
    const admin = (await tx.get(ref)).data();
    if (!admin || !admin.isActive) return { ok: false as const };
    if (!tokenMatchesHash(token, admin.refreshTokenHash)) {
      // Reuse of an already-rotated token: revoke the currently-valid session too.
      tx.update(ref, { refreshTokenHash: null });
      return { ok: false as const };
    }
    const access = signAdminAccess(payload.adminId, admin.role);
    const refresh = signAdminRefresh(payload.adminId, admin.role);
    tx.update(ref, { refreshTokenHash: hashToken(refresh) });
    return { ok: true as const, access, refresh };
  });

  if (!outcome.ok) {
    clearAdminCookies(res);
    return res.status(401).json({ error: SESSION_EXPIRED });
  }
  setAdminCookies(res, outcome.access, outcome.refresh);
  res.json({ ok: true });
});

// ---------- Self-service password reset (an addition beyond the PRD, which lists it as a non-goal) ----------

const RESET_TTL_MINUTES = 30;
const RESET_REQUESTED = "If an account exists for that email, we've sent a link to reset its password. It expires in 30 minutes.";
const RESET_INVALID = "This reset link is invalid or has expired. Request a new one.";

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.") });

router.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Enter a valid email address.") });

  // Same response whether or not the account exists, so this can't be used to find accounts.
  const snap = await adminUsersCol().where("email", "==", parsed.data.email).limit(1).get();
  const doc = snap.docs[0];
  const admin = doc?.data();
  if (doc && admin?.isActive) {
    const token = randomBytes(32).toString("base64url");
    // Only the hash is stored; a newer request replaces (and so invalidates) any earlier link.
    await doc.ref.update({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: Timestamp.fromMillis(Date.now() + RESET_TTL_MINUTES * 60_000),
    });
    const url = `${env.adminAppUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail(passwordResetEmail({ to: admin.email, name: admin.name, url, expiresMinutes: RESET_TTL_MINUTES }));
  }
  res.json({ ok: true, message: RESET_REQUESTED });
});

const resetSchema = z.object({
  token: z.string().min(1, RESET_INVALID),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

router.post("/reset-password", passwordResetLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, RESET_INVALID) });
  const { token, newPassword } = parsed.data;

  const snap = await adminUsersCol().where("passwordResetTokenHash", "==", hashToken(token)).limit(1).get();
  const doc = snap.docs[0];
  const passwordHash = await hashSecret(newPassword);

  // Single-use: validated and consumed in one transaction so a link can't be replayed.
  const admin = doc && await db.runTransaction(async (tx) => {
    const current = (await tx.get(doc.ref)).data();
    const valid = current?.isActive && current.passwordResetTokenHash === hashToken(token)
      && (current.passwordResetExpiresAt?.toMillis() ?? 0) > Date.now();
    if (!current || !valid) return null;
    // Resetting also signs the account out everywhere.
    tx.update(doc.ref, { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null, refreshTokenHash: null });
    return current;
  });
  if (!doc || !admin) return res.status(400).json({ error: RESET_INVALID });

  await recordAudit({ id: doc.id, name: admin.name, email: admin.email }, {
    action: "ADMIN_PASSWORD_RESET",
    targetType: "adminUser",
    targetId: doc.id,
    summary: `${admin.name} reset their password via an emailed link`,
    detail: {},
  });
  res.json({ ok: true });
});

router.get("/me", requireAdmin, async (req, res) => {
  const snap = await adminUsersCol().doc(req.admin!.id).get();
  res.json(toAdminUser(snap.id, snap.data()!));
});

// No guard: logging out must always work, even with an expired session.
router.post("/logout", async (req, res) => {
  const payload = verifyAdminRefresh(req.cookies?.[ADMIN_REFRESH_COOKIE]);
  if (payload) {
    try {
      await adminUsersCol().doc(payload.adminId).update({ refreshTokenHash: null });
    } catch {
      // account may be gone; cookies are cleared regardless
    }
  }
  clearAdminCookies(res);
  res.json({ ok: true });
});

const updateProfileSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newName: z.string().trim().min(1).optional(),
  newEmail: z.string().trim().toLowerCase().email().optional(),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").optional(),
}).refine((v) => v.newName || v.newEmail || v.newPassword, { message: "Provide at least one change." });

router.patch("/me", requireAdmin, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid request.") });
  const { currentPassword, newName, newEmail, newPassword } = parsed.data;

  const ref = adminUsersCol().doc(req.admin!.id);
  const admin = (await ref.get()).data();
  if (!admin) return res.status(404).json({ error: "Account not found." });
  if (!(await compareSecret(currentPassword, admin.passwordHash))) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const nameChanged = newName !== undefined && newName !== admin.name;
  const emailChanged = newEmail !== undefined && newEmail !== admin.email;
  const passwordChanged = newPassword !== undefined && !(await compareSecret(newPassword, admin.passwordHash));
  if (!nameChanged && !emailChanged && !passwordChanged) return res.status(400).json({ error: "Nothing changed." });

  if (emailChanged) {
    const clash = await adminUsersCol().where("email", "==", newEmail).limit(1).get();
    if (!clash.empty) return res.status(409).json({ error: "Another account already uses this email." });
  }

  const update: Partial<AdminUserDoc> = {};
  if (nameChanged) update.name = newName;
  if (emailChanged) update.email = newEmail;
  if (passwordChanged) update.passwordHash = await hashSecret(newPassword!);
  // Credential changes log out every other session.
  if (emailChanged || passwordChanged) {
    update.refreshTokenHash = null;
    // Any outstanding reset link is for the old credentials — cancel it.
    update.passwordResetTokenHash = null;
    update.passwordResetExpiresAt = null;
  }
  await ref.update(update);

  // Keep the session that made the change signed in.
  if (emailChanged || passwordChanged) await issueSession(res, ref.id, admin.role);

  const changed = [nameChanged && "name", emailChanged && "email", passwordChanged && "password"].filter(Boolean) as string[];
  await recordAudit(req.admin!, {
    action: "ADMIN_PROFILE_UPDATED",
    targetType: "adminUser",
    targetId: ref.id,
    summary: `${admin.name} updated their ${changed.join(", ")}`,
    detail: { changed, ...(emailChanged ? { previousEmail: admin.email, newEmail } : {}) },
  });

  const updated = (await ref.get()).data()!;
  res.json(toAdminUser(ref.id, updated));
});

router.get("/users", requireAdmin, requireRole("MASTER_ADMIN"), async (_req, res) => {
  const snap = await adminUsersCol().orderBy("createdAt", "asc").get();
  res.json(snap.docs.map((d) => toAdminUser(d.id, d.data())));
});

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(["ADMIN", "MASTER_ADMIN"]),
});

router.post("/users", requireAdmin, requireRole("MASTER_ADMIN"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid account payload.") });
  const { name, email, password, role } = parsed.data;

  const existing = await adminUsersCol().where("email", "==", email).limit(1).get();
  if (!existing.empty) return res.status(409).json({ error: "An account with this email already exists." });

  const ref = adminUsersCol().doc();
  await ref.set({
    email,
    name,
    passwordHash: await hashSecret(password),
    role,
    createdBy: req.admin!.id,
    isActive: true,
    refreshTokenHash: null,
    createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
  });

  await recordAudit(req.admin!, {
    action: "ADMIN_CREATED",
    targetType: "adminUser",
    targetId: ref.id,
    summary: `Created ${role} account for ${name} (${email})`,
    detail: { name, email, role },
  });

  const created = (await ref.get()).data()!;
  res.status(201).json(toAdminUser(ref.id, created));
});

const setActiveSchema = z.object({
  isActive: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]),
});

router.patch("/users/:id/active", requireAdmin, requireRole("MASTER_ADMIN"), async (req, res) => {
  const parsed = setActiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  const { isActive } = parsed.data;

  if (req.params.id === req.admin!.id) {
    return res.status(400).json({ error: "You can't deactivate your own account." });
  }

  const ref = adminUsersCol().doc(req.params.id);
  const target = (await ref.get()).data();
  if (!target) return res.status(404).json({ error: "Account not found." });

  await ref.update(isActive ? { isActive } : { isActive, refreshTokenHash: null });

  await recordAudit(req.admin!, {
    action: "ADMIN_DEACTIVATED",
    targetType: "adminUser",
    targetId: ref.id,
    summary: `${isActive ? "Reactivated" : "Deactivated"} ${target.name} (${target.email})`,
    detail: { isActive, email: target.email },
  });

  res.json({ ok: true });
});

export default router;
