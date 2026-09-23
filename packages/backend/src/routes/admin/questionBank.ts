import { Router } from "express";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { jdMasterCol, questionBankCol } from "../../lib/collections";
import { firstZodIssue } from "../../lib/errors";
import { GeminiError } from "../../lib/gemini";
import { logger } from "../../lib/logger";
import { toMillis } from "../../lib/validation";
import { generateForJd, generateGeneric, JdNotFoundError } from "../../services/questionGen";
import type { QuestionBankDoc } from "../../types/domain";

const router = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SCOPED_LIMIT = 500;
const GENERIC_SENTINEL = "__generic__";

function toRow(d: QueryDocumentSnapshot<QuestionBankDoc>) {
  const q = d.data();
  return {
    id: d.id,
    jdRef: q.jdRef,
    cluster: q.cluster,
    section: q.section,
    tier: q.tier,
    difficulty: q.difficulty,
    question: q.question,
    skill: q.skill ?? null,
    createdAt: toMillis(q.createdAt),
  };
}

router.get("/", async (req, res) => {
  const jdRef = typeof req.query.jdRef === "string" && req.query.jdRef ? req.query.jdRef : null;

  if (jdRef) {
    // Scoped fetch: unpaginated.
    const query: Query<QuestionBankDoc> = jdRef === GENERIC_SENTINEL
      ? questionBankCol().where("jdRef", "==", null)
      : questionBankCol().where("jdRef", "==", jdRef);
    const snap = await query.limit(SCOPED_LIMIT).get();
    return res.json({ items: snap.docs.map(toRow), nextCursor: null });
  }

  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_LIMIT) : DEFAULT_LIMIT;
  let query = questionBankCol().orderBy("createdAt", "desc").limit(limit);
  if (typeof req.query.cursor === "string" && req.query.cursor) {
    const cursorDoc = await questionBankCol().doc(req.query.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const snap = await query.get();
  res.json({
    items: snap.docs.map(toRow),
    nextCursor: snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null,
  });
});

router.delete("/:id", async (req, res) => {
  const ref = questionBankCol().doc(req.params.id);
  const question = (await ref.get()).data();
  if (!question) return res.status(404).json({ error: "Question not found." });
  await ref.delete();

  // Keep the denormalized flag honest when the last question of a JD goes.
  if (question.jdRef) {
    const remaining = (await questionBankCol().where("jdRef", "==", question.jdRef).limit(1).get()).size;
    if (remaining === 0) await jdMasterCol().doc(question.jdRef).update({ hasQuestions: false }).catch(() => undefined);
  }

  const source = question.jdRef ? `JD "${question.jdRef}"` : `the ${question.cluster} generic pool`;
  await recordAudit(req.admin!, {
    action: "QUESTION_DELETED",
    targetType: "question",
    targetId: ref.id,
    summary: `Deleted a ${question.section}/${question.difficulty} question from ${source}`,
    detail: { jdRef: question.jdRef, cluster: question.cluster, question: question.question },
  });
  res.json({ ok: true });
});

router.delete("/", async (req, res) => {
  const jdRef = typeof req.query.jdRef === "string" ? req.query.jdRef.trim() : "";
  if (!jdRef) return res.status(400).json({ error: "jdRef query param is required." });

  const snap = await questionBankCol().where("jdRef", "==", jdRef).select().get();
  const writer = db.bulkWriter();
  snap.docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
  await jdMasterCol().doc(jdRef).update({ hasQuestions: false }).catch(() => undefined);

  await recordAudit(req.admin!, {
    action: "QUESTION_BANK_CLEARED",
    targetType: "jd",
    targetId: jdRef,
    summary: `Cleared ${snap.size} questions from JD "${jdRef}"`,
    detail: { deleted: snap.size },
  });
  res.json({ deleted: snap.size });
});

const generateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("jd"), jdRef: z.string().min(1) }),
  z.object({ mode: z.literal("generic"), cluster: z.string().min(1), tier: z.string().default("4") }),
]);

router.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid request.") });
  const input = parsed.data;

  try {
    const result = input.mode === "jd"
      ? await generateForJd(input.jdRef)
      : await generateGeneric(input.cluster.trim(), input.tier);

    const replacedNote = result.replaced ? ` (replaced ${result.replaced})` : "";
    await recordAudit(req.admin!, {
      action: "QUESTION_BANK_GENERATED",
      targetType: input.mode === "jd" ? "jd" : "cluster",
      targetId: input.mode === "jd" ? input.jdRef : input.cluster,
      summary: input.mode === "jd"
        ? `Generated ${result.created} questions for JD "${input.jdRef}"${replacedNote}`
        : `Generated ${result.created} generic questions for the ${input.cluster} cluster (tier ${input.tier})${replacedNote}`,
      detail: { ...result, mode: input.mode },
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof JdNotFoundError) return res.status(404).json({ error: "JD not found." });
    if (err instanceof GeminiError) return res.status(422).json({ error: err.message });
    logger.error({ err }, "Question generation failed");
    res.status(500).json({ error: "Question generation failed unexpectedly." });
  }
});

export default router;
