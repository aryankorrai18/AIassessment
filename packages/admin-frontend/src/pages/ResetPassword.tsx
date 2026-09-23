import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { IconLogo } from "../components/Icons";
import { api, errorMessage } from "../lib/api";
import "../styles/login.css";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("New password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { body: { token, newPassword: password } });
      setDone(true);
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
        <h2>Choose a new password</h2>
        {!token ? (
          <p className="callout err" style={{ margin: 0 }}>This page needs the link from your reset email. <Link to="/admin/forgot-password">Request a new link</Link>.</p>
        ) : done ? (
          <>
            <p className="callout ok" role="status" style={{ margin: 0 }}>Your password has been changed and you've been signed out everywhere.</p>
            <Link className="btn full" to="/admin/login">Sign in</Link>
          </>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="rp-new">New password</label>
              <input id="rp-new" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="form-hint">At least 8 characters.</span>
            </div>
            <div className="form-field">
              <label htmlFor="rp-confirm">Confirm new password</label>
              <input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {mismatch && <span className="error-text" style={{ fontSize: 12 }}>Passwords don't match.</span>}
            </div>
            {error && (
              <p className="error-text" role="alert" style={{ margin: 0 }}>
                {error} {error.includes("expired") && <Link to="/admin/forgot-password">Request a new link</Link>}
              </p>
            )}
            <button className="btn full" type="submit" disabled={busy || !password || !confirm || mismatch}>{busy ? "Saving…" : "Set new password"}</button>
          </>
        )}
        {!done && <Link to="/admin/login">← Back to sign in</Link>}
      </form>
    </div>
  );
}
