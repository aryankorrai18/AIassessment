import { Router } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { env } from "../../config/env";
import { recordAudit } from "../../lib/audit";
import { apiUsageLogCol, appSettingsCol, auditLogCol, candidatesCol, interviewsCol } from "../../lib/collections";
import { firstZodIssue } from "../../lib/errors";
import { invalidateGeminiKeyCache, testGeminiKey } from "../../lib/gemini";
import { toMillis } from "../../lib/validation";
import { requireRole } from "../../middleware/requireAdmin";
import { runIdleSweep, runNoShowSweep } from "../../services/sweeps";

// ---------- Live monitor ----------

export const liveMonitorRouter = Router();

liveMonitorRouter.get("/", async (_req, res) => {
  const active = await interviewsCol().where("status", "==", "ACTIVE").get();
  const rows = await Promise.all(active.docs.map(async (d) => {
    const iv = d.data();
    const candidate = (await candidatesCol().doc(iv.candidateId).get()).data();
    return {
      interviewId: d.id,
      candidateName: candidate?.empName ?? iv.candidateId,
      cluster: candidate?.skillCluster ?? "unknown",
      startedAt: toMillis(iv.startedAt),
      lastHeartbeatAt: toMillis(iv.lastHeartbeatAt),
    };
  }));
  res.json(rows);
});

// ---------- Sweep triggers mounted under /schedule ----------

export const scheduleSweepRouter = Router();
scheduleSweepRouter.post("/run-no-show-sweep", async (_req, res) => res.json(await runNoShowSweep()));
scheduleSweepRouter.post("/run-idle-sweep", async (_req, res) => res.json(await runIdleSweep()));

// ---------- API usage (cost visibility) ----------

const RECENT_LIMIT = 100;
export const apiUsageRouter = Router();

apiUsageRouter.get("/", async (_req, res) => {
  const snap = await apiUsageLogCol().orderBy("createdAt", "desc").get();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const summary = {
    totalCalls: 0, totalPromptTokens: 0, totalResponseTokens: 0, totalTokens: 0,
    byPurpose: {} as Record<string, { calls: number; totalTokens: number }>,
    byModel: {} as Record<string, { calls: number; totalTokens: number }>,
    last24h: { calls: 0, totalTokens: 0 },
  };
  const bump = (m: Record<string, { calls: number; totalTokens: number }>, k: string, t: number) => {
    m[k] ??= { calls: 0, totalTokens: 0 };
    m[k].calls++;
    m[k].totalTokens += t;
  };
  for (const d of snap.docs) {
    const u = d.data();
    summary.totalCalls++;
    summary.totalPromptTokens += u.promptTokens;
    summary.totalResponseTokens += u.responseTokens;
    summary.totalTokens += u.totalTokens;
    bump(summary.byPurpose, u.purpose, u.totalTokens);
    bump(summary.byModel, u.model, u.totalTokens);
    if ((toMillis(u.createdAt) ?? 0) >= dayAgo) {
      summary.last24h.calls++;
      summary.last24h.totalTokens += u.totalTokens;
    }
  }
  const recent = snap.docs.slice(0, RECENT_LIMIT).map((d) => ({ id: d.id, ...d.data(), createdAt: toMillis(d.data().createdAt) }));
  res.json({ summary, recent });
});

// ---------- Audit log (MASTER, read-only; no edit/delete route exists anywhere) ----------

export const auditLogRouter = Router();
auditLogRouter.use(requireRole("MASTER_ADMIN"));

auditLogRouter.get("/", async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 500) : 100;
  let query = auditLogCol().orderBy("createdAt", "desc").limit(limit);
  if (typeof req.query.cursor === "string" && req.query.cursor) {
    const cursorDoc = await auditLogCol().doc(req.query.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const snap = await query.get();
  res.json({
    items: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMillis(d.data().createdAt) })),
    nextCursor: snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null,
  });
});

// ---------- Settings: Gemini key (MASTER) ----------

export const settingsRouter = Router();
settingsRouter.use(requireRole("MASTER_ADMIN"));
const geminiKeyRef = () => appSettingsCol().doc("gemini");
const mask = (key: string) => "••••" + key.slice(-4);

settingsRouter.get("/gemini-key", async (_req, res) => {
  const stored = (await geminiKeyRef().get()).data();
  if (!stored?.apiKey) {
    return res.json({ isSet: false, maskedKey: null, updatedAt: null, updatedByName: null, usingEnvFallback: Boolean(env.geminiApiKey) });
  }
  res.json({ isSet: true, maskedKey: mask(stored.apiKey), updatedAt: toMillis(stored.updatedAt), updatedByName: stored.updatedByName, usingEnvFallback: false });
});

const keySchema = z.object({ apiKey: z.string().trim().min(10, "That doesn't look like a real API key.") });

settingsRouter.post("/gemini-key", async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid key.") });
  const { apiKey } = parsed.data;

  // Live-validated against the real Gemini API before saving.
  const check = await testGeminiKey(apiKey);
  if (!check.ok) return res.status(400).json({ error: check.detail ? `This key doesn't work: ${check.detail}` : "This key doesn't work." });

  const admin = req.admin!;
  await geminiKeyRef().set({ apiKey, updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp, updatedBy: admin.id, updatedByName: admin.name });
  invalidateGeminiKeyCache();
  // The key itself is never written to the audit log.
  await recordAudit(admin, { action: "GEMINI_KEY_UPDATED", targetType: "setting", targetId: "gemini", summary: `Updated the Gemini API key (${mask(apiKey)})`, detail: {} });
  res.json({ isSet: true, maskedKey: mask(apiKey), updatedAt: Date.now(), updatedByName: admin.name, usingEnvFallback: false });
});

settingsRouter.delete("/gemini-key", async (req, res) => {
  const ref = geminiKeyRef();
  const existed = (await ref.get()).exists;
  await ref.delete();
  invalidateGeminiKeyCache();
  if (existed) {
    await recordAudit(req.admin!, { action: "GEMINI_KEY_CLEARED", targetType: "setting", targetId: "gemini", summary: "Cleared the admin-managed Gemini API key (reverted to .env)", detail: {} });
  }
  res.json({ ok: true });
});
