import { Router } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { violationsCol } from "../../lib/collections";
import { VIOLATION_TYPES } from "../../types/domain";

const router = Router();

const MAX_SNAPSHOT_BYTES = 500_000;
const violationSchema = z.object({
  type: z.enum(VIOLATION_TYPES),
  detail: z.record(z.string(), z.unknown()).default({}),
  snapshotDataUrl: z.string().max(MAX_SNAPSHOT_BYTES).nullable().default(null),
});

// Only discrete events (with at most one small still image) ever reach the server — never video.
router.post("/", async (req, res) => {
  const parsed = violationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid violation payload." });
  const { type, detail, snapshotDataUrl } = parsed.data;

  await violationsCol(req.candidateSession!.interviewId).add({
    type,
    detail,
    mediaPath: snapshotDataUrl && /^data:image\/(jpeg|png|webp);base64,/.test(snapshotDataUrl) ? snapshotDataUrl : null,
    occurredAt: FieldValue.serverTimestamp() as unknown as Timestamp,
  });
  res.json({ ok: true });
});

export default router;
