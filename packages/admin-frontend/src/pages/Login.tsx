import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { IconLogo } from "../components/Icons";
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
        <div className="brand-name login-brand"><IconLogo /> GapVise AI</div>
        <h1>AI-assisted technical interviews, from job description to scored report.</h1>
        <ul className="login-features">
          <li><strong>Structured from the JD.</strong> Upload a job description; required skills and levels are extracted and a question bank is generated for you.</li>
          <li><strong>Proctored, one-attempt interviews.</strong> Candidates sign in with a one-time key and are monitored without anything being recorded.</li>
          <li><strong>Defensible scoring.</strong> Every answer is scored individually; overall, section and skill-gap results are computed, not guessed.</li>
        </ul>
      </section>
      <section className="login-panel">
        <form className="card login-card" onSubmit={submit} noValidate>
          <h2>Sign in</h2>
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
