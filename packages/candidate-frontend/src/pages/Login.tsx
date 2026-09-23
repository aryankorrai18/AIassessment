import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useCandidate } from "../lib/context";
import type { CandidateProfile } from "../lib/types";

export default function Login() {
  const { loading, profile, interview, consentGiven, setProfile, resumeInterview } = useCandidate();
  const navigate = useNavigate();
  const [empId, setEmpId] = useState("");
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
      const r = await api<{ profile: CandidateProfile; interviewStatus: "PENDING" | "ACTIVE" }>("/auth/login", { empId, accessKey });
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
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="lock-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </div>
        <div>
          <h1 style={{ fontSize: 22 }}>GapVise AI Assessment</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>Enter the Employee ID and access key from your invitation email.</p>
        </div>
        <div className="field">
          <label htmlFor="emp">Employee ID</label>
          <input id="emp" type="text" autoFocus autoComplete="username" placeholder="e.g. VRT001234" value={empId} onChange={(e) => setEmpId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="key">Access Key</label>
          <input id="key" type="password" autoComplete="off" placeholder="Your 12-character key" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </div>
        {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn full" type="submit" disabled={busy || !empId.trim() || !accessKey.trim()}>{busy ? "Checking…" : "Continue →"}</button>
      </form>
    </div>
  );
}
