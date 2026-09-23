import { Router } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import multer from "multer";
import { z } from "zod";
import { db } from "../../config/firebase";
import { recordAudit } from "../../lib/audit";
import { interviewsCol, jdMasterCol, questionBankCol } from "../../lib/collections";
import { firstZodIssue } from "../../lib/errors";
import { GeminiError } from "../../lib/gemini";
import { logger } from "../../lib/logger";
import { NO_SLASH, toMillis } from "../../lib/validation";
import { extractJd, extractTextFromFile, JdExtractionError } from "../../services/jdExtract";
import { generateForJd } from "../../services/questionGen";

const router = Router();

// Memory storage only — JD files are parsed and discarded, never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const saveSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").refine(NO_SLASH, 'Title must not contain a "/" character.'),
  jobRole: z.string().nullable().default(null),
  skillCluster: z.string().default("General"),
  requiredSkills: z.array(z.object({
    skill: z.string().min(1),
    expectedLevel: z.enum(["L1", "L2", "L3"]),
    weight: z.number().min(1).max(10).default(5),
  })).default([]),
  responsibilities: z.array(z.string()).default([]),
  experienceYears: z.string().nullable().default(null),
  requiresCoding: z.boolean().default(false),
  jdText: z.string().default(""),
});
const updateSchema = saveSchema.omit({ title: true });

const toJdRef = (title: string) => title.trim().toLowerCase();

async function questionCountFor(jdRef: string): Promise<number> {
  return (await questionBankCol().where("jdRef", "==", jdRef).count().get()).data().count;
}

router.post("/extract", upload.single("file"), async (req, res) => {
  let rawText: string;
  try {
    if (req.file) {
      rawText = await extractTextFromFile(req.file.originalname, req.file.buffer);
    } else {
      rawText = typeof req.body?.text === "string" ? req.body.text : "";
      if (!rawText.trim()) return res.status(400).json({ error: "No job description text provided." });
    }
    const result = await extractJd(rawText);
    res.json({ ...result, jdText: rawText });
  } catch (err) {
    if (err instanceof JdExtractionError || err instanceof GeminiError) return res.status(422).json({ error: err.message });
    logger.error({ err }, "JD extraction failed");
    res.status(500).json({ error: "Extraction failed unexpectedly." });
  }
});

router.get("/", async (_req, res) => {
  const snap = await jdMasterCol().orderBy("createdAt", "desc").get();
  const rows = await Promise.all(snap.docs.map(async (d) => {
    const jd = d.data();
    return {
      jdRef: d.id,
      title: jd.title,
      skillCluster: jd.skillCluster,
      requiresCoding: jd.requiresCoding,
      hasQuestions: jd.hasQuestions ?? false,
      questionCount: await questionCountFor(d.id),
    };
  }));
  res.json(rows);
});

router.get("/:jdRef", async (req, res) => {
  const snap = await jdMasterCol().doc(req.params.jdRef).get();
  const jd = snap.data();
  if (!jd) return res.status(404).json({ error: "JD not found." });
  res.json({
    jdRef: snap.id,
    title: jd.title,
    jobRole: jd.jobRole,
    skillCluster: jd.skillCluster,
    requiredSkills: jd.requiredSkills,
    responsibilities: jd.responsibilities,
    experienceYears: jd.experienceYears,
    requiresCoding: jd.requiresCoding,
    jdText: jd.jdText,
    hasQuestions: jd.hasQuestions ?? false,
    createdAt: toMillis(jd.createdAt),
    updatedAt: toMillis(jd.updatedAt),
  });
});

router.post("/", async (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid JD payload.") });
  const data = parsed.data;
  const jdRef = toJdRef(data.title);
  const now = FieldValue.serverTimestamp() as unknown as Timestamp;

  try {
    // .create() so a duplicate is a clean 409, not a silent overwrite.
    await jdMasterCol().doc(jdRef).create({ ...data, hasQuestions: false, createdAt: now, updatedAt: now });
  } catch (err) {
    if ((err as { code?: number }).code === 6 /* ALREADY_EXISTS */) {
      return res.status(409).json({ error: `A JD titled "${data.title}" already exists. Rename it or edit the existing one instead.` });
    }
    throw err;
  }

  const actor = req.admin!;
  await recordAudit(actor, {
    action: "JD_CREATED",
    targetType: "jd",
    targetId: jdRef,
    summary: `Created JD "${data.title}" (${data.requiredSkills.length} skills)`,
    detail: { title: data.title, skillCluster: data.skillCluster, requiresCoding: data.requiresCoding },
  });

  res.status(201).json({ jdRef, title: data.title });

  // Only on first creation, never on edit: generate the question bank in the
  // background, after the response has been sent.
  generateForJd(jdRef)
    .then(({ created, replaced }) => recordAudit(actor, {
      action: "QUESTION_BANK_GENERATED",
      targetType: "jd",
      targetId: jdRef,
      summary: `Generated ${created} questions for JD "${data.title}"`,
      detail: { created, replaced, trigger: "jd-created" },
    }))
    .catch((err) => logger.error({ err, jdRef }, "Background question generation failed"));
});

router.patch("/:jdRef", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstZodIssue(parsed.error, "Invalid JD payload.") });

  const ref = jdMasterCol().doc(req.params.jdRef);
  const jd = (await ref.get()).data();
  if (!jd) return res.status(404).json({ error: "JD not found." });

  await ref.update({ ...parsed.data, updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp });
  await recordAudit(req.admin!, {
    action: "JD_UPDATED",
    targetType: "jd",
    targetId: ref.id,
    summary: `Updated JD "${jd.title}"`,
    detail: { skillCluster: parsed.data.skillCluster, requiredSkills: parsed.data.requiredSkills.map((s) => s.skill) },
  });
  res.json({ jdRef: ref.id, title: jd.title, hadQuestions: jd.hasQuestions ?? false });
});

router.delete("/:jdRef", async (req, res) => {
  const ref = jdMasterCol().doc(req.params.jdRef);
  const jd = (await ref.get()).data();
  if (!jd) return res.status(404).json({ error: "JD not found." });

  const blockers = await interviewsCol().where("jdRef", "==", ref.id).where("status", "in", ["ACTIVE", "PENDING"]).get();
  if (blockers.docs.some((d) => d.data().status === "ACTIVE")) {
    return res.status(409).json({ error: "A candidate is currently taking an interview against this JD." });
  }
  if (!blockers.empty) {
    return res.status(409).json({ error: "A candidate has an interview scheduled (or awaiting scheduling) against this JD — resolve that first." });
  }

  // Cascade-delete the JD's entire question bank.
  const questions = await questionBankCol().where("jdRef", "==", ref.id).select().get();
  const writer = db.bulkWriter();
  questions.docs.forEach((d) => writer.delete(d.ref));
  writer.delete(ref);
  await writer.close();

  await recordAudit(req.admin!, {
    action: "JD_DELETED",
    targetType: "jd",
    targetId: ref.id,
    summary: `Deleted JD "${jd.title}" and its ${questions.size} questions`,
    detail: { title: jd.title, deletedQuestionCount: questions.size },
  });
  res.json({ ok: true, deletedQuestionCount: questions.size });
});

export default router;
