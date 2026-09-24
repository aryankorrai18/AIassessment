import { Router, type Request, type Response } from "express";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "../../config/firebase";
import { candidatesCol, interviewsCol, sessionDoc } from "../../lib/collections";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { toMillis } from "../../lib/validation";
import { buildCandidateProfile, completeInTransaction, fireEvaluation } from "../../services/completion";
import { buildPlan, QuestionBankEmptyError } from "../../services/interviewPlan";
import { advance, initialState, isExpired, SECTION_TIME_LIMITS_MS, skipSection } from "../../services/stateMachine";
import { parseInterviewState, type InterviewState } from "../../types/interviewState";

const router = Router();

const NOT_STARTED = "Interview not started yet.";
const ALREADY_DONE = "This interview is already complete.";

/**
 * What the candidate is allowed to see: only the CURRENT question's prompt. Upcoming (and past)
 * prompts and skill tags are blanked so the plan can't be read ahead in devtools, and past answers
 * carry their questionId but no text.
 */
export function publicState(state: InterviewState): InterviewState {
  return {
    ...state,
    plan: state.plan.map((sp) => ({ ...sp, questions: sp.questions.map((q) => ({ ...q, prompt: "", skill: null })) })),
    currentQuestion: { ...state.currentQuestion, skill: null },
    answers: state.answers.map((a) => ({ ...a, answer: "" })),
  };
}

function sendSession(res: Response, status: number, state: InterviewState, startedAt: number | null, autoCompleted: boolean) {
  res.status(status).json({
    state: publicState(state),
    startedAt,
    sectionTimeLimitMs: SECTION_TIME_LIMITS_MS[state.currentSection],
    autoCompleted, // true ONLY when this response force-ended the interview
  });
}

const serverNow = () => FieldValue.serverTimestamp() as unknown as Timestamp;

/**
 * GET / and /heartbeat: returns the session, first applying reactive expiry (skip the
 * section, or complete the interview if it was the last one).
 */
async function readWithExpiry(interviewId: string, email: string, touchHeartbeat: boolean) {
  const sessionRef = sessionDoc(interviewId);
  const interviewRef = interviewsCol().doc(interviewId);

  const outcome = await db.runTransaction(async (tx) => {
    const [sessionSnap, interviewSnap] = await Promise.all([tx.get(sessionRef), tx.get(interviewRef)]);
    if (!sessionSnap.exists) throw new HttpError(404, NOT_STARTED);
    const state = parseInterviewState(sessionSnap.data()!.data);
    const startedAt = toMillis(interviewSnap.data()?.startedAt);

    let next = state;
    if (isExpired(state)) {
      next = skipSection(state);
      tx.update(sessionRef, { data: next, version: FieldValue.increment(1), updatedAt: serverNow() });
      if (next.done) completeInTransaction(tx, interviewRef, email);
    }
    if (touchHeartbeat && !state.done) tx.update(interviewRef, { lastHeartbeatAt: serverNow() });
    return { state: next, startedAt, completedNow: !state.done && next.done };
  });

  if (outcome.completedNow) fireEvaluation(interviewId);
  return outcome;
}

router.post("/start", async (req, res) => {
  const { interviewId, email } = req.candidateSession!;
  const sessionRef = sessionDoc(interviewId);
  const interviewRef = interviewsCol().doc(interviewId);

  // Idempotent: an existing session is returned, never reset.
  if ((await sessionRef.get()).exists) {
    const o = await readWithExpiry(interviewId, email, false);
    return sendSession(res, 200, o.state, o.startedAt, o.completedNow);
  }

  const [candidateSnap, interviewSnap] = await Promise.all([candidatesCol().doc(email).get(), interviewRef.get()]);
  const candidate = candidateSnap.data();
  if (!candidate || !interviewSnap.exists) return res.status(404).json({ error: "Candidate not found." });

  const profile = await buildCandidateProfile(email, candidate, interviewSnap.data()!);
  let state: InterviewState;
  try {
    state = initialState(profile, await buildPlan(profile));
  } catch (err) {
    if (err instanceof QuestionBankEmptyError) return res.status(422).json({ error: err.message });
    throw err;
  }

  const created = await db.runTransaction(async (tx) => {
    const [existing, interview] = await Promise.all([tx.get(sessionRef), tx.get(interviewRef)]);
    if (existing.exists) return false; // a concurrent /start won the race
    tx.create(sessionRef, { data: state, version: 1, updatedAt: serverNow() });
    tx.update(interviewRef, {
      status: "ACTIVE",
      startedAt: interview.data()?.startedAt ?? serverNow(),
      lastHeartbeatAt: serverNow(),
    });
    return true;
  });

  if (!created) {
    const o = await readWithExpiry(interviewId, email, false);
    return sendSession(res, 200, o.state, o.startedAt, o.completedNow);
  }
  const startedAt = toMillis((await interviewRef.get()).data()?.startedAt);
  sendSession(res, 201, state, startedAt, false);
});

router.get("/", async (req, res) => {
  const { interviewId, email } = req.candidateSession!;
  const o = await readWithExpiry(interviewId, email, false);
  sendSession(res, 200, o.state, o.startedAt, o.completedNow);
});

router.post("/heartbeat", async (req, res) => {
  const { interviewId, email } = req.candidateSession!;
  const o = await readWithExpiry(interviewId, email, true);
  sendSession(res, 200, o.state, o.startedAt, o.completedNow);
});

const answerSchema = z.object({
  answer: z.string().min(1),
  inputMode: z.enum(["voice", "typed"]),
  // Optional guard: the question the client believes it is answering. A stale retry for a
  // question the server has already moved past is a no-op instead of answering the next one.
  questionId: z.string().optional(),
});

type Mutation = "answer" | "skip";

async function mutate(req: Request, kind: Mutation, body?: z.infer<typeof answerSchema>) {
  const { interviewId, email } = req.candidateSession!;
  const sessionRef = sessionDoc(interviewId);
  const interviewRef = interviewsCol().doc(interviewId);

  const outcome = await db.runTransaction(async (tx) => {
    const [sessionSnap, interviewSnap] = await Promise.all([tx.get(sessionRef), tx.get(interviewRef)]);
    if (!sessionSnap.exists) throw new HttpError(404, NOT_STARTED);
    const state = parseInterviewState(sessionSnap.data()!.data);
    // Checked INSIDE the transaction: this is what makes double-submits and retries safe.
    if (state.done) throw new HttpError(409, ALREADY_DONE);

    const now = Date.now();
    const expired = isExpired(state, now);
    const startedAt = toMillis(interviewSnap.data()?.startedAt);

    let next: InterviewState;
    if (expired) {
      // A late answer submitted past the deadline is discarded, not accepted.
      next = skipSection(state, now);
    } else if (kind === "answer") {
      if (body!.questionId && body!.questionId !== state.currentQuestion.id) {
        return { state, startedAt, autoCompleted: false, completedNow: false };
      }
      next = advance(state, {
        questionId: state.currentQuestion.id,
        answer: body!.answer,
        inputMode: body!.inputMode,
        score: 0,
        feedback: "pending",
      }, now);
    } else {
      next = skipSection(state, now);
    }

    tx.update(sessionRef, { data: next, version: FieldValue.increment(1), updatedAt: serverNow() });
    if (next.done) completeInTransaction(tx, interviewRef, email);
    return { state: next, startedAt, autoCompleted: expired && next.done, completedNow: next.done };
  });

  if (outcome.completedNow) fireEvaluation(interviewId);
  return outcome;
}

router.post("/answer", async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "answer and inputMode are required." });
  try {
    const o = await mutate(req, "answer", parsed.data);
    sendSession(res, 200, o.state, o.startedAt, o.autoCompleted);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    logger.error({ err }, "Answer transaction failed");
    res.status(500).json({ error: "Could not record your answer — please try again." });
  }
});

router.post("/skip-section", async (req, res) => {
  try {
    const o = await mutate(req, "skip");
    sendSession(res, 200, o.state, o.startedAt, o.autoCompleted);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    logger.error({ err }, "Skip-section transaction failed");
    res.status(500).json({ error: "Could not move to the next section — please try again." });
  }
});

export default router;
