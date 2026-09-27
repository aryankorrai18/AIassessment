import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck, IconChevronDown, IconLogo, IconMic } from "../components/Icons";
import { useNavigate } from "react-router-dom";
import { CodeEditor } from "../components/CodeEditor";
import { ThemeToggle } from "../components/Shell";
import { useSpeech } from "../components/useSpeech";
import { errorMessage } from "../lib/api";
import { DRAFT_PREFIX, useCandidate } from "../lib/context";
import { SECTION_LABELS, type InputMode, type InterviewState } from "../lib/types";
import { Banners, BlockingOverlay, DuplicateTabBlock, SelfView } from "../proctoring/ProctorUI";
import { useDuplicateTabGuard, useProctoring } from "../proctoring/useProctoring";
import "../styles/interview.css";

const LOW_TIME_MS = 5 * 60 * 1000;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

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
  const { profile, sectionTimeLimitMs, submitAnswer, skipSection, resumeInterview } = useCandidate();
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

  // Each new question starts at the top of the page, with the cursor in the answer box.
  const composerRef = useRef<HTMLDivElement>(null);
  const firstQuestion = useRef(true);
  useEffect(() => {
    if (firstQuestion.current) {
      firstQuestion.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    composerRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [q.id]);

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
  const low = remaining < LOW_TIME_MS;
  const timeLeftPct = sectionTimeLimitMs > 0 ? Math.max(0, Math.min(100, (remaining / sectionTimeLimitMs) * 100)) : 100;
  const trimmed = answer.trim();
  const size = isCoding ? `${answer ? answer.split("\n").length : 0} lines` : `${trimmed ? trimmed.split(/\s+/).length : 0} words`;
  const sectionName = SECTION_LABELS[section.section];

  // Ctrl/Cmd + Enter submits from anywhere in the composer.
  const onComposerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!busy && trimmed) void submit();
  };

  return (
    <div className="session">
      <header className="session-bar">
        <div className="session-bar-inner">
          <IconLogo size={28} />
          <div className="where">
            <strong>{sectionName}</strong>
            <span className="tabular">Question {q.index} of {section.questions.length}</span>
          </div>
          <span className="session-bar-spacer" />
          <span className="proctor-status">
            <span className="live-dot" aria-hidden="true" />
            <span className="proctor-status-text">Proctoring on</span>
            {proctor.strikeCount > 0 && <span className="flagged">{proctor.strikeCount} flagged</span>}
          </span>
          {/* Purely cosmetic: the real deadline is enforced server-side. */}
          <div className={`clock${low ? " low" : ""}`} data-section={interview.currentSection} role="timer" aria-live="off" aria-label={`${fmtClock(remaining)} left in ${sectionName}`}>
            <span className="clock-value">{fmtClock(remaining)}</span>
            <span className="clock-label">left in {sectionName}</span>
          </div>
          <ThemeToggle />
        </div>
        <div className={`fuse${low ? " low" : ""}`} aria-hidden="true"><span style={{ width: `${timeLeftPct}%` }} /></div>
      </header>

      <div className="session-body">
        <aside className="rail" aria-label="Your progress">
          <SelfView videoRef={videoRef} cameraError={proctor.cameraError} name={profile?.name} />

          <ol className="tracker">
            {interview.plan.map((sp, i) => {
              const status = i < sectionIdx ? "done" : i === sectionIdx ? "active" : "upcoming";
              const answered = sp.questions.filter((x) => answeredIds.has(x.id)).length;
              return (
                <li key={sp.section} className={`tracker-section ${status}`}>
                  <div className="tracker-head">
                    <span className="tracker-name">
                      {status === "done" && <IconCheck size={14} />}
                      {SECTION_LABELS[sp.section]}
                    </span>
                    <span className="tracker-count">
                      {answered} / {sp.questions.length}
                      <span className="visually-hidden"> answered{status === "done" ? ", section submitted" : status === "active" ? ", in progress" : ", upcoming"}</span>
                    </span>
                  </div>
                  <div className="marks" aria-hidden="true">
                    {sp.questions.map((x) => {
                      const state = answeredIds.has(x.id) ? "answered" : x.id === q.id ? "current" : status === "done" ? "skipped" : "";
                      return <span key={x.id} className={`mark ${state}`} />;
                    })}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="rail-submit">
            <button className="btn secondary full" disabled={busy} onClick={() => setConfirmSkip(true)}>
              {isLastSection ? "Submit section & finish" : `Submit ${sectionName}`}
            </button>
            <p className="hint">Skips the {remainingInSection} question{remainingInSection === 1 ? "" : "s"} left in this section.</p>
          </div>
        </aside>

        <main className="question">
          <p className="q-meta tabular">Question {q.index} of {section.questions.length}</p>
          <h1 className="q-prompt">{q.prompt}</h1>

          <div ref={composerRef} className={`composer${speech.recording ? " recording" : ""}`} onKeyDown={onComposerKey}>
            {isCoding ? (
              <CodeEditor value={answer} onChange={onType} disabled={busy} />
            ) : (
              <textarea
                className="answer-input"
                aria-label="Your answer"
                placeholder="Type your answer here, or use the microphone below…"
                rows={10}
                disabled={busy}
                value={answer}
                onChange={(e) => onType(e.target.value)}
                onPaste={(e) => e.preventDefault()}
              />
            )}
            <div className="composer-bar">
              {!isCoding && speech.problem !== "unsupported" && (
                speech.recording ? (
                  <>
                    <button className="btn danger small" onClick={stopRecording} disabled={busy}><span className="rec-dot" aria-hidden="true" />Stop recording</button>
                    <span className="listening" aria-live="polite">Listening…</span>
                  </>
                ) : (
                  <button className="btn secondary small" onClick={() => speech.start(answer)} disabled={busy || speech.problem === "denied"}><IconMic />Answer by voice</button>
                )
              )}
              <span className="composer-spacer" />
              <span className="composer-meta">
                <span className="tabular">{size}</span>
                <span className="shortcut-hint" aria-hidden="true"><kbd>{IS_MAC ? "⌘" : "Ctrl"}</kbd> <kbd>Enter</kbd></span>
              </span>
              <button className="btn" disabled={busy || !trimmed} onClick={() => void submit()} aria-keyshortcuts={IS_MAC ? "Meta+Enter" : "Control+Enter"}>
                {busy ? "Submitting…" : isLastQuestion ? "Submit & finish" : "Submit answer"}
              </button>
            </div>
          </div>

          <div className="composer-notes">
            {inputMode === "voice" && !isCoding && <p className="hint">Transcribed from voice — you can edit before submitting.</p>}
            {speech.problem === "unsupported" && !isCoding && <p className="hint">Voice isn't supported in this browser — please type.</p>}
            {speech.problem === "denied" && !isCoding && <p className="hint">Microphone access was lost — please continue by typing your answer.</p>}
            {error && <p className="error-text" role="alert">{error}</p>}
          </div>

          {history.length > 0 && (
            <section className="history">
              <button className="history-toggle" aria-expanded={showHistory} aria-controls="history-list" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? "Hide" : "Show"} previous answers ({history.length})
                <IconChevronDown />
              </button>
              {showHistory && (
                <ol id="history-list" className="history-list">
                  {history.map((h) => (
                    <li key={h.id}>
                      <div className="history-q"><small>{SECTION_LABELS[h.section as keyof typeof SECTION_LABELS]}</small>{h.question}</div>
                      <div className="history-a">{h.answer}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </main>
      </div>

      {confirmSkip && (
        <div className="modal-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="skip-title">
            <h2 id="skip-title">{isLastSection ? "Finish the interview?" : `Submit ${sectionName}?`}</h2>
            <p>
              {isLastSection
                ? `This is the last section — submitting it now will end the interview, skipping the remaining ${remainingInSection} question(s) in it. This can't be undone.`
                : `Submit ${sectionName} now? The remaining ${remainingInSection} question(s) in this section will be skipped and can't be answered later.`}
            </p>
            <div className="dialog-actions">
              <button className="btn secondary" autoFocus onClick={() => setConfirmSkip(false)}>Keep answering</button>
              <button className="btn danger" onClick={() => void doSkip()}>{isLastSection ? "Submit & finish" : "Submit section"}</button>
            </div>
          </div>
        </div>
      )}

      <Banners p={proctor} />
      <BlockingOverlay p={proctor} />
    </div>
  );
}
