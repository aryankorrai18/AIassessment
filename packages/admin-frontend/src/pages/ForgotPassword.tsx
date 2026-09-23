import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { IconLogo } from "../components/Icons";
import { api, errorMessage } from "../lib/api";
import "../styles/login.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/auth/forgot-password", { body: { email } });
      setSent(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-center">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="brand-name"><IconLogo /> GapVise AI</div>
        <h2>Reset your password</h2>
        {sent ? (
          <>
            <p className="callout ok" role="status" style={{ margin: 0 }}>{sent}</p>
            <p className="muted" style={{ margin: 0 }}>Didn't get it? Check spam, or wait a minute and request another link.</p>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>Enter your admin email and we'll send you a link to choose a new password.</p>
            <div className="form-field">
              <label htmlFor="fp-email">Email</label>
              <input id="fp-email" type="text" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn full" type="submit" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send reset link"}</button>
          </>
        )}
        <Link to="/admin/login">← Back to sign in</Link>
      </form>
    </div>
  );
}
