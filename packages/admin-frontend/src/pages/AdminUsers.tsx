import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import type { AdminRole, AdminUser } from "../lib/types";
import { EmptyRow } from "./shared";

export default function AdminUsers() {
  const toast = useToast();
  const { admin: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "ADMIN" as AdminRole });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api<AdminUser[]>("/auth/users"));
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => void load(), [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await api<AdminUser>("/auth/users", { body: form });
      toast(`Created ${u.role} account for ${u.name}. Share the temporary password with them securely.`);
      setForm({ name: "", email: "", password: "", role: "ADMIN" });
      setCreating(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (u: AdminUser, isActive: boolean) => {
    if (u.id === me?.id) return toast("You can't deactivate your own account.", "err");
    if (!isActive && !window.confirm(`Deactivate ${u.name}? They are signed out on their very next request.`)) return;
    try {
      await api(`/auth/users/${u.id}/active`, { method: "PATCH", body: { isActive } });
      toast(`${isActive ? "Reactivated" : "Deactivated"} ${u.name}.`);
      await load();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  const all = users ?? [];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Admin Users</h1>
          <p>Create and deactivate admin accounts. Deactivation takes effect on the account's very next request.</p>
        </div>
        <button className={`btn${creating ? " secondary" : ""}`} onClick={() => { setCreating(!creating); setError(null); }}>{creating ? "Cancel" : "+ Create admin"}</button>
      </div>
      <div className="stat-row">
        <div className="stat-card total"><div className="stat-label">Total accounts</div><div className="stat-value">{users ? all.length : "—"}</div></div>
        <div className="stat-card ready"><div className="stat-label">Active</div><div className="stat-value">{all.filter((u) => u.isActive).length}</div></div>
        <div className="stat-card total"><div className="stat-label">Active MASTER_ADMINs</div><div className="stat-value">{all.filter((u) => u.isActive && u.role === "MASTER_ADMIN").length}</div></div>
      </div>
      {creating && (
        <form className="card" onSubmit={create}>
          <h2>New admin account</h2>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="u-name">Name</label><input id="u-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-field"><label htmlFor="u-email">Email</label><input id="u-email" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="form-field">
              <label htmlFor="u-pass">Temporary password</label>
              <input id="u-pass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <span className="form-hint">At least 8 characters. They can change it from Profile.</span>
            </div>
            <div className="form-field">
              <label htmlFor="u-role">Role</label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}>
                <option value="ADMIN">ADMIN</option><option value="MASTER_ADMIN">MASTER_ADMIN</option>
              </select>
            </div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.email.trim() || !form.password}>{busy ? "Creating…" : "Create account"}</button>
        </form>
      )}
      <div className="card">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {!users && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
              {all.map((u) => (
                <tr key={u.id}>
                  <td>{u.name} {u.id === me?.id && <span className="pill">You</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={`pill ${u.role === "MASTER_ADMIN" ? "ok" : "warn"}`}>{u.role}</span></td>
                  <td>{u.isActive ? "✓ Active" : <span className="error-text">✕ Deactivated</span>}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td className="actions">
                    <button className={`btn small ${u.isActive ? "danger" : "secondary"}`} disabled={u.id === me?.id} onClick={() => void setActive(u, !u.isActive)}>
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
