import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IconBan, IconBellOff, IconCamera, IconCheck, IconLock, IconMaximize, IconSkip, IconWifi } from "../components/Icons";
import { errorMessage } from "../lib/api";
import { useCandidate } from "../lib/context";

type Perm = "Not requested" | "Granted" | "Denied";

function PermTag({ label, state }: { label: string; state: Perm }) {
  return <span className={`tag ${state === "Granted" ? "ok" : state === "Denied" ? "err" : ""}`}>{label}: {state}</span>;
}

function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li>{icon}<span>{children}</span></li>;
}

function Step({ n, complete, title, children }: { n: number; complete: boolean; title: string; children: ReactNode }) {
  return (
    <li className={`ready-step${complete ? " complete" : ""}`}>
      <span className="step-mark" aria-hidden="true">{complete ? <IconCheck size={14} /> : n}</span>
      <div>
        <h3>{title}{complete && <span className="visually-hidden"> (done)</span>}</h3>
        <div className="ready-step-body">{children}</div>
      </div>
    </li>
  );
}

export default function Instructions() {
  const { profile, startInterview } = useCandidate();
  const navigate = useNavigate();
  const [camera, setCamera] = useState<Perm>("Not requested");
  const [mic, setMic] = useState<Perm>("Not requested");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A short-lived preview so candidates can check their framing. The interview screen acquires its own stream.
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview;
    return () => preview?.getTracks().forEach((t) => t.stop());
  }, [preview]);

  const hasCoding = !!profile?.hasCoding;
  const sections = [
    { name: "Definitions", how: "Explain concepts. Type or speak." },
    { name: "Scenarios", how: "Work through real situations. Type or speak." },
    ...(hasCoding ? [{ name: "Coding", how: "Write short solutions. Typed only." }] : []),
  ];

  const requestPermissions = async () => {
    setError(null);
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setCamera(probe.getVideoTracks().length > 0 ? "Granted" : "Denied");
      setMic(probe.getAudioTracks().length > 0 ? "Granted" : "Denied");
      // Keep only the video for the preview; the microphone is released straight away.
      probe.getAudioTracks().forEach((t) => t.stop());
      setPreview(probe);
    } catch (err) {
      setCamera("Denied");
      setMic("Denied");
      setError(`Camera and microphone access is required: ${errorMessage(err)}. Allow it in your browser's site settings and try again.`);
    }
  };

  const begin = async () => {
    setBusy(true);
    setError(null);
    // Release the preview camera before the interview screen asks for its own.
    preview?.getTracks().forEach((t) => t.stop());
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
  const firstName = profile?.name.split(" ")[0];

  return (
    <div>
      <h1 className="page-title">Before you begin{firstName ? `, ${firstName}` : ""}</h1>
      <p className="page-lede">This takes about two minutes to read. Once you begin, the clock for the first section starts.</p>

      <div className="prep">
        <div>
          <ol className="route" aria-label={`Your interview has ${sections.length} sections, in this order`}>
            {sections.map((s) => (
              <li key={s.name}><strong>{s.name}</strong><span>{s.how}</span></li>
            ))}
          </ol>

          <section className="rules">
            <h2>Your answers</h2>
            <ul>
              <Rule icon={<IconLock />}>Each question may be attempted <strong>only once</strong>; submitted answers are final.</Rule>
              <Rule icon={<IconBan />}>Copy-paste is <strong>not allowed</strong> anywhere in the assessment.</Rule>
              <Rule icon={<IconSkip />}>Each section has a <em>Submit section</em> button. Questions left in that section are skipped and can't be answered later.</Rule>
            </ul>
          </section>

          <section className="rules">
            <h2>Your setup</h2>
            <ul>
              <Rule icon={<IconWifi />}>Use a stable internet connection.</Rule>
              <Rule icon={<IconBellOff />}>Close other apps, including Outlook and Teams. Notifications or pop-ups count as a violation.</Rule>
              <Rule icon={<IconMaximize />}>The assessment runs in <strong>fullscreen</strong>, starting when you click Begin. Leaving fullscreen is recorded as a violation.</Rule>
            </ul>
          </section>
        </div>

        <aside className="panel ready" aria-labelledby="ready-title">
          <h2 id="ready-title">Get ready</h2>
          <ol className="ready-steps">
            <Step n={1} complete={bothGranted} title="Turn on your camera and microphone">
              <div className="preview">
                <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" hidden={!preview} />
                {!preview && (
                  <div className="preview-empty">
                    <IconCamera size={22} />
                    <span>Your camera preview appears here. Sit facing the screen, with your face in good light.</span>
                  </div>
                )}
              </div>
              <div className="perm-list">
                <PermTag label="Camera" state={camera} />
                <PermTag label="Microphone" state={mic} />
              </div>
              {!bothGranted && <button className="btn secondary" onClick={() => void requestPermissions()}>Allow camera & microphone</button>}
            </Step>

            <Step n={2} complete={consent} title="Agree to monitoring">
              <p className="consent-text">
                Your camera checks that you're present and alone, and that no phone, book or second screen is in view. Tab switches,
                copy-paste attempts and leaving fullscreen are also logged. <strong>No video is recorded or uploaded</strong> — only
                individual flagged events, each with at most one small still image, are kept for the hiring team. Spoken answers are
                transcribed in your browser.
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>I understand and consent to this monitoring for the duration of the assessment.</span>
              </label>
            </Step>

            <Step n={3} complete={false} title="Start the assessment">
              {error && <p className="error-text" role="alert">{error}</p>}
              <button className="btn large full" disabled={!bothGranted || !consent || busy} onClick={() => void begin()}>
                {busy ? "Preparing your interview…" : "Begin assessment"}
              </button>
              <p className="hint">{!bothGranted ? "Allow camera and microphone to continue." : !consent ? "Tick the consent box to continue." : "Opens in fullscreen."}</p>
            </Step>
          </ol>
        </aside>
      </div>
    </div>
  );
}
