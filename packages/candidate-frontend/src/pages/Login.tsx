import { useState, type FormEvent } from "react";
import { IconCamera, IconClock, IconLock } from "../components/Icons";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useCandidate } from "../lib/context";
import type { CandidateProfile } from "../lib/types";

export default function Login() {
  const { loading, profile, interview, consentGiven, setProfile, resumeInterview } = useCandidate();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && profile) {
    if (interview?.done) return <Navigate to="/interview/end" replace />;
    return <Navigate to={interview && consentGiven ? "/interview/session" : "/interview/instructions"} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ profile: CandidateProfile; interviewStatus: "PENDING" | "ACTIVE" }>("/auth/login", { email, accessKey });
      // Already started on another visit? Resume at the same question rather than restarting.
      const resumed = r.interviewStatus === "ACTIVE" && (await resumeInterview());
      setProfile(r.profile);
      navigate(resumed ? "/interview/session" : "/interview/instructions", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section>
        <h1 className="page-title">Your technical assessment</h1>
        <p className="page-lede">
          A timed interview in your browser, built from the job you applied for. Answer in your own words — typed, spoken or in code.
        </p>
        <ul className="expect">
          <li>
            <span className="expect-icon" aria-hidden="true"><IconClock size={20} /></span>
            <div><strong>60 to 90 minutes</strong><span>Two or three timed sections, depending on the role. Set aside the full time.</span></div>
          </li>
          <li>
            <span className="expect-icon" aria-hidden="true"><IconCamera size={20} /></span>
            <div><strong>Camera and microphone on</strong><span>Checks run in your browser. No video is recorded; only flagged moments are kept.</span></div>
          </li>
          <li>
            <span className="expect-icon" aria-hidden="true"><IconLock size={20} /></span>
            <div><strong>One attempt</strong><span>Each answer is final once you submit it, so take your time on each question.</span></div>
          </li>
        </ul>
      </section>

      <form className="panel login-form" onSubmit={submit} noValidate>
        <div>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 6 }}>Enter your email address and the access key from your invitation email.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoFocus autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="key">Access key</label>
          <input id="key" type="password" autoComplete="off" placeholder="Your 12-character key" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn large full" type="submit" disabled={busy || !email.trim() || !accessKey.trim()}>{busy ? "Checking…" : "Continue"}</button>
      </form>
    </div>
  );
}
