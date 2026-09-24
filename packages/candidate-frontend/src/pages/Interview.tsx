import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CodeEditor } from "../components/CodeEditor";
import { useSpeech } from "../components/useSpeech";
import { errorMessage } from "../lib/api";
import { DRAFT_PREFIX, useCandidate } from "../lib/context";
import { SECTION_LABELS, type InputMode, type InterviewState } from "../lib/types";
import { Banners, BlockingOverlay, DuplicateTabBlock, SelfView } from "../proctoring/ProctorUI";
import { useDuplicateTabGuard, useProctoring } from "../proctoring/useProctoring";
import "../styles/interview.css";

const LOW_TIME_MS = 5 * 60 * 1000;

// Drafts are keyed PER QUESTION so a restore can never put one question's draft into another's box.
const draftKey = (questionId: string) => DRAFT_PREFIX + questionId;
const readDraft = (questionId: string) => {
  try {
    return localStorage.getItem(draftKey(questionId));
  } catch {
    return null;
  }
};
const writeDraft = (questionId: string, text: string) => {
  try {
    if (text) localStorage.setItem(draftKey(questionId), text);
    else localStorage.removeItem(draftKey(questionId)); // removed when emptied
  } catch {
    // storage unavailable — drafts are a convenience
  }
};
const removeDraftKey = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function Interview() {
  const { profile, interview } = useCandidate();
  const navigate = useNavigate();
  const duplicate = useDuplicateTabGuard(profile?.email);

  useEffect(() => {
    if (!interview) navigate("/interview/login", { replace: true });
    else if (interview.done) navigate("/interview/end", { replace: true });
  }, [interview, navigate]);

  if (duplicate) return <DuplicateTabBlock />; // also stops every detection loop and the camera
  if (!interview || interview.done) return null;
  return <InterviewScreen interview={interview} />;
}

function InterviewScreen({ interview }: { interview: InterviewState }) {
  const { sectionTimeLimitMs, submitAnswer, skipSection, resumeInterview } = useCandidate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const proctor = useProctoring(true, videoRef);

  const q = interview.currentQuestion;
  const isCoding = q.section === "coding";
  const sectionIdx = interview.plan.findIndex((sp) => sp.section === interview.currentSection);
  const section = interview.plan[sectionIdx];
  const isLastSection = sectionIdx === interview.plan.length - 1;
  const isLastQuestion = isLastSection && q.index === section.questions.length;
  const answeredIds = new Set(interview.answers.map((a) => a.questionId));
  const answeredInSection = section.questions.filter((x) => answeredIds.has(x.id)).length;

  const [answer, setAnswer] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("typed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Built entirely client-side: the backend only ever returns the CURRENT question's prompt.
  const [history, setHistory] = useState<{ id: string; section: string; question: string; answer: string }[]>([]);
  const qIdRef = useRef(q.id);
  qIdRef.current = q.id;

  const speech = useSpeech((text) => {
    setAnswer(text);
    setInputMode("voice");
    writeDraft(qIdRef.current, text);
  });
  const stopRecording = speech.stop;

  // Restore the draft on mount and on every question change — BEFORE the candidate can type,
  // so it can't clobber live input. Recording always stops on a question change.
  useLayoutEffect(() => {
    setAnswer(readDraft(q.id) ?? "");
    setInputMode("typed");
    setError(null);
    stopRecording();
  }, [q.id, stopRecording]);

  // ---- Section timer: purely cosmetic; the real deadline is enforced server-side ----
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = interview.sectionStartedAt + sectionTimeLimitMs - now;
  const expiredSyncFor = useRef<string | null>(null);
  useEffect(() => {
    // When the clock runs out, ask the server right away instead of waiting for the next heartbeat.
    const key = `${interview.currentSection}:${interview.sectionStartedAt}`;
    if (remaining <= 0 && expiredSyncFor.current !== key) {
      expiredSyncFor.current = key;
      void resumeInterview();
    }
  }, [remaining, interview.currentSection, interview.sectionStartedAt, resumeInterview]);

  const onType = (v: string) => {
    setAnswer(v);
    setInputMode("typed");
    writeDraft(q.id, v);
  };

  const submit = useCallback(async () => {
    const text = answer.trim();
    if (!text) return;
    // Captured BEFORE the await — state has advanced to the next question by the time it resolves.
    const key = draftKey(q.id);
    const asked = { id: q.id, section: q.section, question: q.prompt, answer: text };
    stopRecording();
    setBusy(true);
    setError(null);
    try {
      await submitAnswer(text, isCoding ? "typed" : inputMode, q.id);
      removeDraftKey(key);
      setHistory((h) => [...h, asked]);
    } catch (err) {
      // Deliberately keep the draft on a failed submit.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [answer, q, isCoding, inputMode, submitAnswer, stopRecording]);

  const doSkip = async () => {
    stopRecording();
    setConfirmSkip(false);
    setBusy(true);
    setError(null);
    try {
      await skipSection();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remainingInSection = section.questions.length - answeredInSection;

  return (
    <div className="interview">
      {/* 1. Section timer bar */}
      <div className={`timer-bar${remaining < LOW_TIME_MS ? " low" : ""}`} data-section={interview.currentSection} role="timer" aria-live="off">
        <span className="timer-label">{SECTION_LABELS[interview.currentSection]} section</span>
        <span className="timer-value tabular">{fmtClock(remaining)} remaining</span>
      </div>

      {/* 2. Stepper */}
      <ol className="section-stepper">
        {interview.plan.map((sp, i) => {
          const status = i < sectionIdx ? "done" : i === sectionIdx ? "active" : "upcoming";
          const answered = sp.questions.filter((x) => answeredIds.has(x.id)).length;
          return (
            <li key={sp.section} className={`section-step ${status}`}>
              <span className="step-marker" aria-hidden="true">{status === "done" ? "✓" : SECTION_LABELS[sp.section][0]}</span>
              <div className="step-body">
                <div className="step-title">
                  {SECTION_LABELS[sp.section]}
                  <span className="step-badge">{status === "done" ? "Done" : status === "active" ? "In progress" : "Upcoming"}</span>
                </div>
                <div className="step-progress" aria-hidden="true"><div style={{ width: `${(answered / sp.questions.length) * 100}%` }} /></div>
                <div className="step-count tabular">{answered} / {sp.questions.length} questions</div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* 3. Info row */}
      <div className="info-row">
        <button className="btn secondary" disabled={busy} onClick={() => setConfirmSkip(true)}>{isLastSection ? "Submit section & finish" : "Submit section →"}</button>
        <span className="proctor-chip">
          <span className="live-dot" aria-hidden="true" /> Proctoring active
          {proctor.strikeCount > 0 && <span className="strike"> · {proctor.strikeCount} flagged</span>}
        </span>
      </div>

      {/* 4. Question card */}
      <section className="card question-card" aria-labelledby="q-heading">
        <div className="question-meta">
          <span className="pill">{SECTION_LABELS[q.section]}</span>
          <span id="q-heading" className="muted">Question {q.index} of {section.questions.length}</span>
        </div>
        <p className="question-prompt">{q.prompt}</p>
      </section>

      {/* 5. Answer panel */}
      <section className="card answer-panel">
        {isCoding ? (
          <CodeEditor value={answer} onChange={onType} disabled={busy} />
        ) : (
          <textarea
            className="answer-input"
            aria-label="Your answer"
            placeholder="Type your answer here, or use the microphone below…"
            rows={8}
            disabled={busy}
            value={answer}
            onChange={(e) => onType(e.target.value)}
            onPaste={(e) => e.preventDefault()}
          />
        )}
        {inputMode === "voice" && !isCoding && <p className="hint">Transcribed from voice — you can edit before submitting.</p>}
        {speech.problem === "unsupported" && !isCoding && <p className="hint">Voice isn't supported in this browser — please type.</p>}
        {speech.problem === "denied" && !isCoding && <p className="hint">Microphone access was lost — please continue by typing your answer.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="controls-row">
          {!isCoding && speech.problem !== "unsupported" && (
            speech.recording
              ? <button className="btn danger" onClick={stopRecording} disabled={busy}><span className="rec-dot" aria-hidden="true" /> Stop recording</button>
              : <button className="btn secondary" onClick={() => speech.start(answer)} disabled={busy || speech.problem === "denied"}>🎙 Answer by voice</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={busy || !answer.trim()} onClick={() => void submit()}>{busy ? "Submitting…" : isLastQuestion ? "Submit & finish" : "Submit answer"}</button>
        </div>
      </section>

      {/* 7. History */}
      {history.length > 0 && (
        <section className="history">
          <button className="btn ghost small" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide" : "Show"} previous answers ({history.length})
          </button>
          {showHistory && (
            <ol className="history-list">
              {history.map((h) => (
                <li key={h.id}>
                  <div className="history-q"><span className="pill">{SECTION_LABELS[h.section as keyof typeof SECTION_LABELS]}</span> {h.question}</div>
                  <div className="history-a">{h.answer}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* 8. Submit-section confirm */}
      {confirmSkip && (
        <div className="modal-backdrop">
          <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="skip-title">
            <h2 id="skip-title" style={{ fontSize: 18 }}>{isLastSection ? "Finish the interview?" : `Submit ${SECTION_LABELS[section.section]}?`}</h2>
            <p>
              {isLastSection
                ? `This is the last section — submitting it now will end the interview, skipping the remaining ${remainingInSection} question(s) in it. This can't be undone.`
                : `Submit ${SECTION_LABELS[section.section]} now? The remaining ${remainingInSection} question(s) in this section will be skipped and can't be answered later.`}
            </p>
            <div className="modal-actions">
              <button className="btn secondary" autoFocus onClick={() => setConfirmSkip(false)}>Keep answering</button>
              <button className="btn danger" onClick={() => void doSkip()}>{isLastSection ? "Submit & finish" : "Submit section"}</button>
            </div>
          </div>
        </div>
      )}

      <SelfView videoRef={videoRef} cameraError={proctor.cameraError} />
      <Banners p={proctor} />
      <BlockingOverlay p={proctor} />
    </div>
  );
}
