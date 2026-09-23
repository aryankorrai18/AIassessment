import { Router } from "express";
import { firestoreMode } from "../config/firebase";
import { appSettingsCol } from "../lib/collections";
import { getGeminiApiKey, testGeminiKey } from "../lib/gemini";

const router = Router();

// 500 only when Firestore fails; a Gemini failure is reported in the body at 200.
router.get("/", async (_req, res) => {
  const body: { firestore: "ok" | "error"; gemini: "ok" | "error"; mode: string; detail?: Record<string, string> } = {
    firestore: "ok", gemini: "ok", mode: firestoreMode,
  };
  const detail: Record<string, string> = {};
  try {
    await appSettingsCol().doc("gemini").get();
  } catch (err) {
    body.firestore = "error";
    detail.firestore = err instanceof Error ? err.message : String(err);
  }
  try {
    const key = await getGeminiApiKey();
    const check = key ? await testGeminiKey(key) : { ok: false as const, detail: "No Gemini API key configured." };
    if (!check.ok) {
      body.gemini = "error";
      detail.gemini = check.detail;
    }
  } catch (err) {
    body.gemini = "error";
    detail.gemini = err instanceof Error ? err.message : String(err);
  }
  if (Object.keys(detail).length) body.detail = detail;
  res.status(body.firestore === "error" ? 500 : 200).json(body);
});

export default router;
