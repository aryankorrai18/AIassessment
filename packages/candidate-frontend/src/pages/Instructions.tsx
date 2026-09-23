import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../lib/api";
import { useCandidate } from "../lib/context";

type Perm = "Not requested" | "Granted" | "Denied";

function PermPill({ state }: { state: Perm }) {
  return <span className={`pill ${state === "Granted" ? "ok" : state === "Denied" ? "err" : ""}`}>{state}</span>;
}

export default function Instructions() {
  const { profile, startInterview } = useCandidate();
  const navigate = useNavigate();
  const [camera, setCamera] = useState<Perm>("Not requested");
  const [mic, setMic] = useState<Perm>("Not requested");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = profile?.hasCoding ? 3 : 2;
  const guidelines: ReactNode[] = [
    <>Each question may be attempted <strong>only once</strong>; submitted responses are final.</>,
    <>Copy-paste is strictly prohibited throughout.</>,
    <>Ensure a stable internet connection.</>,
    <>Your interview has <em>{sections} sections</em>: Definitions → Scenarios{profile?.hasCoding ? " → Coding" : ""}. Definitions and Scenarios accept voice or typed answers{profile?.hasCoding ? "; Coding is typed" : ""}.</>,
    <>Close all applications including Outlook and Teams; notifications or pop-ups count as a violation.</>,
    <>The assessment runs in fullscreen, requested the moment you click Begin; exiting fullscreen is logged as a violation.</>,
    <>Each section has a <em>Submit section</em> button; remaining questions in that section are skipped and cannot be answered later.</>,
  ];

  const requestPermissions = async () => {
    setError(null);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setCamera(probe.getVideoTracks().length > 0 ? "Granted" : "Denied");
      setMic(probe.getAudioTracks().length > 0 ? "Granted" : "Denied");
      // Stop the probe immediately — the interview screen acquires its own stream.
      probe.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setCamera("Denied");
      setMic("Denied");
      setError(`Camera and microphone access is required: ${errorMessage(err)}. Allow it in your browser's site settings and try again.`);
    }
  };

  const begin = async () => {
    setBusy(true);
    setError(null);
    // Must happen inside this real user gesture. Non-blocking if the browser refuses.
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // continue without fullscreen; the interview screen offers to re-enter it
    }
    try {
      await startInterview();
      navigate("/interview/session", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const bothGranted = camera === "Granted" && mic === "Granted";

  return (
    <div>
      <h1 style={{ fontSize: 26 }}>Assessment Guidelines</h1>
      <p className="muted" style={{ marginTop: 4 }}>Read carefully before proceeding</p>

      <ol className="guidelines" style={{ listStyle: "none", padding: 0 }}>
        {guidelines.map((g, i) => (
          <li key={i} className="guideline"><span className="guideline-num">{String(i + 1).padStart(2, "0")}</span><span>{g}</span></li>
        ))}
      </ol>

      <div className="card">
        <h2 style={{ fontSize: 17, marginBottom: 6 }}>Camera & microphone</h2>
        <div className="perm-row"><span>Camera</span><PermPill state={camera} /></div>
        <div className="perm-row"><span>Microphone</span><PermPill state={mic} /></div>
        {!bothGranted && <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => void requestPermissions()}>Allow camera & microphone</button>}

        <div className="consent-box">
          During the assessment your camera is used to check that you're present and alone, and that no phone, book or second
          screen is in view; tab switches, copy-paste attempts and leaving fullscreen are also logged. <strong>No video is recorded
          or uploaded</strong> — only individual flagged events, each with at most one small still image, are kept for the hiring
          team to review. Your spoken answers are transcribed in your browser.
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I understand and consent to this monitoring for the duration of the assessment.</span>
        </label>

        {error && <p className="error-text" role="alert">{error}</p>}
        <div style={{ marginTop: 18 }}>
          <button className="btn" disabled={!bothGranted || !consent || busy} onClick={() => void begin()}>{busy ? "Preparing your interview…" : "Begin Assessment →"}</button>
        </div>
      </div>
    </div>
  );
}
