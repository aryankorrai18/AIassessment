import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { CandidateProfile, InputMode, InterviewState, SessionResponse } from "./types";

const HEARTBEAT_INTERVAL_MS = 20_000;
const NO_LONGER_ACTIVE = "This interview session is no longer active.";
export const DRAFT_PREFIX = "cand-draft:";

interface CandidateValue {
  loading: boolean;
  profile: CandidateProfile | null;
  setProfile: (p: CandidateProfile | null) => void;
  consentGiven: boolean;
  interview: InterviewState | null;
  startedAt: number | null;
  sectionTimeLimitMs: number;
  timeExpired: boolean;
  startInterview: () => Promise<void>;
  resumeInterview: () => Promise<boolean>;
  submitAnswer: (answer: string, inputMode: InputMode, questionId: string) => Promise<void>;
  skipSection: () => Promise<void>;
  reset: () => void;
}

const Ctx = createContext<CandidateValue | null>(null);

export function clearAllDrafts() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable
  }
}

export function CandidateProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [sectionTimeLimitMs, setSectionTimeLimitMs] = useState(0);
  const [timeExpired, setTimeExpired] = useState(false);
  const interviewRef = useRef<InterviewState | null>(null);
  interviewRef.current = interview;

  /** Every session response goes through here. autoCompleted latches timeExpired. */
  const applySession = useCallback((r: SessionResponse) => {
    setInterview(r.state);
    setStartedAt(r.startedAt);
    setSectionTimeLimitMs(r.sectionTimeLimitMs);
    if (r.autoCompleted) setTimeExpired(true);
  }, []);

  /** The server ended the interview underneath us (idle sweep / expiry elsewhere). */
  const markEnded = useCallback(() => {
    setInterview((cur) => (cur ? { ...cur, done: true } : cur));
  }, []);

  const resumeInterview = useCallback(async () => {
    try {
      applySession(await api<SessionResponse>("/session"));
      setConsentGiven(true);
      return true;
    } catch {
      return false;
    }
  }, [applySession]);

  // On mount: who am I, and is there an interview to resume? (This is what makes a
  // mid-interview refresh resume rather than restart.)
  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ profile: CandidateProfile; interviewStatus: string }>("/auth/me");
        setProfile(me.profile);
        if (me.interviewStatus === "ACTIVE") await resumeInterview();
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [resumeInterview]);

  // Heartbeat: runs whenever an interview exists and is not done (fresh start OR resumed).
  // Failures are swallowed entirely — a network blip must never surface as an error; the next tick retries.
  const running = !!interview && !interview.done;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(async () => {
      try {
        applySession(await api<SessionResponse>("/session/heartbeat", {}));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && err.message === NO_LONGER_ACTIVE) markEnded();
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [running, applySession, markEnded]);

  useEffect(() => {
    if (interview?.done) clearAllDrafts();
  }, [interview?.done]);

  const startInterview = useCallback(async () => {
    applySession(await api<SessionResponse>("/session/start", {}));
    setConsentGiven(true);
  }, [applySession]);

  const handleMutationError = useCallback((err: unknown) => {
    if (err instanceof ApiError && (err.status === 409 || (err.status === 401 && err.message === NO_LONGER_ACTIVE))) {
      markEnded(); // already complete — nothing more to submit
      return;
    }
    throw err;
  }, [markEnded]);

  const submitAnswer = useCallback(async (answer: string, inputMode: InputMode, questionId: string) => {
    try {
      applySession(await api<SessionResponse>("/session/answer", { answer, inputMode, questionId }));
    } catch (err) {
      handleMutationError(err);
    }
  }, [applySession, handleMutationError]);

  const skipSection = useCallback(async () => {
    try {
      applySession(await api<SessionResponse>("/session/skip-section", {}));
    } catch (err) {
      handleMutationError(err);
    }
  }, [applySession, handleMutationError]);

  const reset = useCallback(() => {
    setProfile(null);
    setConsentGiven(false);
    setInterview(null);
    setStartedAt(null);
    setSectionTimeLimitMs(0);
    setTimeExpired(false);
  }, []);

  return (
    <Ctx.Provider value={{ loading, profile, setProfile, consentGiven, interview, startedAt, sectionTimeLimitMs, timeExpired, startInterview, resumeInterview, submitAnswer, skipSection, reset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCandidate(): CandidateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCandidate must be used inside CandidateProvider");
  return v;
}
