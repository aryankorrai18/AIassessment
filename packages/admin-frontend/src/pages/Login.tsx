import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { IconCheck, IconLogo } from "../components/Icons";
import { errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import "../styles/login.css";

export default function LoginPage() {
  const { admin, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && admin) return <Navigate to="/admin/overview" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/admin/overview", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-split">
      <section className="login-hero">
        <div className="brand-name login-brand"><IconLogo size={40} /> <span>GapVise <b>AI</b></span></div>
        <h1>Every candidate, measured against the job.</h1>
        <ul className="login-features">
          <li><span className="feature-icon"><IconCheck size={14} /></span><span><strong>Built from the job description.</strong> Skills and levels are extracted, and a 108-question bank is written for the role.</span></li>
          <li><span className="feature-icon"><IconCheck size={14} /></span><span><strong>Proctored without recording.</strong> One attempt per invite, checked in the browser, with nothing filmed.</span></li>
          <li><span className="feature-icon"><IconCheck size={14} /></span><span><strong>Scores you can explain.</strong> Each answer is scored; every total and skill gap is computed from those scores.</span></li>
        </ul>
      </section>
      <section className="login-panel">
        <form className="card login-card" onSubmit={submit} noValidate>
          <div>
            <h2>Sign in</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>Use your GapVise admin account.</p>
          </div>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input id="email" type="text" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-field">
            <div className="label-row">
              <label htmlFor="password">Password</label>
              <Link to="/admin/forgot-password" className="small-link">Forgot password?</Link>
            </div>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn full" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
