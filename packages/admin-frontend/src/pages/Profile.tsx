import { useState, type FormEvent } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Profile() {
  const toast = useToast();
  const { admin, refreshAdmin } = useAuth();
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newName.trim() && !newEmail.trim() && !newPassword) {
      return setError("Change at least one of name, email, or password.");
    }
    setBusy(true);
    try {
      // Blank fields are omitted, never sent as empty strings.
      await api("/auth/me", {
        method: "PATCH",
        body: {
          currentPassword,
          newName: newName.trim() || undefined,
          newEmail: newEmail.trim() || undefined,
          newPassword: newPassword || undefined,
        },
      });
      await refreshAdmin(); // sidebar identity updates immediately
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setCurrentPassword("");
      toast("Profile updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header"><div><h1>Profile</h1><p>Update your name, email or password.</p></div></div>
      <form className="card" onSubmit={submit} style={{ maxWidth: 480, display: "grid", gap: 14 }}>
        <div>
          <strong>{admin?.name}</strong>
          <div className="muted">{admin?.email} · {admin?.role}</div>
        </div>
        <div className="form-field"><label htmlFor="p-name">New name</label><input id="p-name" type="text" placeholder={admin?.name} value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
        <div className="form-field"><label htmlFor="p-email">New email</label><input id="p-email" type="text" placeholder={admin?.email} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
        <div className="form-field">
          <label htmlFor="p-pass">New password</label>
          <input id="p-pass" type="password" autoComplete="new-password" placeholder="Leave blank to keep your current password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="p-current">Current password *</label>
          <input id="p-current" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <span className="form-hint">Required to confirm any change above.</span>
        </div>
        {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div><button className="btn" type="submit" disabled={busy || !currentPassword}>{busy ? "Saving…" : "Save changes"}</button></div>
      </form>
    </>
  );
}
