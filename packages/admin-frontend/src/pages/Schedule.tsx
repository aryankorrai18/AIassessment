import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { downloadWorkbook } from "../lib/excel";
import { fmtDateTime, toLocalInput, ymd } from "../lib/format";
import type { InterviewStatus, IssuedKey, ScheduledRow, UnscheduledRow } from "../lib/types";
import { EmptyRow, StatusPill } from "./shared";

// The candidate portal can live on a different origin from this admin app.
const PORTAL_ORIGIN = (import.meta.env.VITE_CANDIDATE_PORTAL_ORIGIN as string | undefined) || window.location.origin;

type SweepResult = { checked: number; reminded?: number; escalated?: number; finalized?: number; errors: string[] };

export default function Schedule() {
  const toast = useToast();
  const [tab, setTab] = useState<"scheduled" | "new">("scheduled");
  const [scheduled, setScheduled] = useState<ScheduledRow[] | null>(null);
  const [unscheduled, setUnscheduled] = useState<UnscheduledRow[] | null>(null);
  const [issued, setIssued] = useState<IssuedKey[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api<ScheduledRow[]>("/schedule"), api<UnscheduledRow[]>("/schedule/unscheduled")]);
      setScheduled(s);
      setUnscheduled(u);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => void load(), [load]);

  const addIssued = (keys: IssuedKey[]) => setIssued((prev) => [...keys, ...prev.filter((p) => !keys.some((k) => k.email === p.email))]);

  const exportKeys = () => downloadWorkbook(`access-keys-${ymd()}.xlsx`, [{
    name: "Access Keys",
    columns: ["Name", "Email", "Access Key", "Scheduled At", "Portal URL", "Sent"],
    rows: issued.map((k) => [k.name, k.email, k.key, fmtDateTime(k.scheduledAt), `${PORTAL_ORIGIN}/interview/login`, ""]),
  }]);

  const count = (st: InterviewStatus) => (scheduled ?? []).filter((s) => s.status === st).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Interview Schedule</h1>
          <p>Schedule interviews and issue one-time access keys. Keys are emailed to candidates and shown to you exactly once.</p>
        </div>
      </div>

      {issued.length > 0 && (
        <div className="callout warn" role="region" aria-label="Issued access keys">
          <strong>Shown once — the server only stores a hash, never the raw key.</strong>
          <div style={{ margin: "10px 0", display: "grid", gap: 4 }}>
            {issued.map((k) => (
              <div key={k.email} className="mono">
                {k.name} ({k.email}): <strong>{k.key}</strong>{"  "}
                {k.emailSent ? <span className="pill ok">✓ emailed</span> : <span className="pill err">✕ email failed</span>}
                {k.emailPreviewUrl && <> <a href={k.emailPreviewUrl} target="_blank" rel="noreferrer">Preview email →</a></>}
              </div>
            ))}
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="btn small" onClick={() => void exportKeys()}>Export as Excel</button>
            <button className="btn secondary small" onClick={() => setIssued([])}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat-card total"><div className="stat-label">Scheduled</div><div className="stat-value">{scheduled?.length ?? "—"}</div></div>
        <div className="stat-card warn"><div className="stat-label">Awaiting start</div><div className="stat-value">{count("PENDING")}</div></div>
        <div className="stat-card blocked"><div className="stat-label">No-shows</div><div className="stat-value">{count("NO_SHOW")}</div></div>
        <div className="stat-card ready"><div className="stat-label">Completed</div><div className="stat-value">{count("COMPLETED")}</div></div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "scheduled"} className={`tab-btn${tab === "scheduled" ? " active" : ""}`} onClick={() => setTab("scheduled")}>Scheduled</button>
        <button role="tab" aria-selected={tab === "new"} className={`tab-btn${tab === "new" ? " active" : ""}`} onClick={() => setTab("new")}>Schedule New ({unscheduled?.length ?? 0})</button>
      </div>

      {tab === "scheduled"
        ? <ScheduledTab rows={scheduled} reload={load} onIssued={addIssued} />
        : <ScheduleNewTab rows={unscheduled} onDone={async (keys) => { addIssued(keys); await load(); setTab("scheduled"); }} />}
    </>
  );
}

function ScheduledTab({ rows, reload, onIssued }: { rows: ScheduledRow[] | null; reload: () => Promise<void>; onIssued: (k: IssuedKey[]) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filtered = (rows ?? []).filter((r) => !status || r.status === status);

  const sweep = async (kind: "no-show" | "idle") => {
    setBusy(kind);
    try {
      const r = await api<SweepResult>(`/schedule/run-${kind}-sweep`, { method: "POST" });
      toast(kind === "no-show"
        ? `No-show sweep: ${r.checked} checked, ${r.reminded} reminded, ${r.escalated} escalated${r.errors.length ? `, ${r.errors.length} error(s)` : ""}.`
        : `Idle sweep: ${r.checked} checked, ${r.finalized} finalized${r.errors.length ? `, ${r.errors.length} error(s)` : ""}.`);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setBusy(null);
    }
  };

  const resend = async (r: ScheduledRow) => {
    if (!window.confirm(`Send ${r.name} a NEW access key? Their old key will stop working.`)) return;
    try {
      const res = await api<{ issued: IssuedKey[] }>(`/schedule/${r.interviewId}/resend`, { method: "POST" });
      onIssued(res.issued);
      toast(`New key issued for ${r.name}.`);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  const reschedule = async () => {
    if (!editing) return;
    try {
      await api(`/schedule/${editing.id}/reschedule`, { body: { scheduledAt: new Date(editing.value).toISOString() } });
      toast("Rescheduled — the reminder count was reset to 0/3. The access key is unchanged.");
      setEditing(null);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  return (
    <div className="card">
      <div className="toolbar">
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["PENDING", "ACTIVE", "COMPLETED", "NO_SHOW", "EXPIRED"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn secondary" disabled={busy !== null} onClick={() => void sweep("no-show")}>{busy === "no-show" ? "Running…" : "Run no-show sweep now"}</button>
        <button className="btn secondary" disabled={busy !== null} onClick={() => void sweep("idle")}
          title="Force-completes interviews whose candidate abandoned the tab (no heartbeat for 15+ minutes) and sends them for scoring.">
          {busy === "idle" ? "Running…" : "Run idle-interview sweep now"}
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Candidate</th><th>Cluster / JD</th><th>Scheduled</th><th>Status</th><th>Reminders</th><th /></tr></thead>
          <tbody>
            {rows === null && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {rows !== null && filtered.length === 0 && <EmptyRow colSpan={6}>No scheduled interviews{status ? " with that status" : ""}.</EmptyRow>}
            {filtered.map((r) => (
              <tr key={r.interviewId} className={r.status === "NO_SHOW" ? "row-error" : undefined}>
                <td>{r.name}<div className="sub-line">{r.email}{r.refId ? ` · ${r.refId}` : ""}</div></td>
                <td>{r.cluster}<div style={{ marginTop: 3 }}>{r.jdRef ? <span className="pill ok">JD: {r.jdRef}</span> : <span className="pill warn">cluster-only</span>}</div></td>
                <td>
                  {editing?.id === r.interviewId ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="datetime-local" aria-label="New date and time" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} style={{ width: "auto" }} />
                      <button className="btn small" disabled={!editing.value} onClick={() => void reschedule()}>Confirm</button>
                      <button className="btn secondary small" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : fmtDateTime(r.scheduledAt)}
                </td>
                <td><StatusPill status={r.status} icon /></td>
                <td className={`tabular reminders${r.reminderCount >= 3 ? " full" : ""}`} style={r.reminderCount >= 3 ? { color: "var(--err)", fontWeight: 600 } : undefined}>{r.reminderCount} / 3</td>
                <td className="actions">
                  {(r.status === "PENDING" || r.status === "NO_SHOW") && editing?.id !== r.interviewId && (
                    <>
                      <button className="btn secondary small" onClick={() => void resend(r)}>Resend key</button>
                      <button className="btn secondary small" onClick={() => setEditing({ id: r.interviewId, value: toLocalInput(r.scheduledAt) })}>Reschedule</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="form-hint" style={{ marginTop: 12 }}>A daily sweep (09:00) advances the reminder ladder automatically — 1/3 → 2/3 → 3/3 → marked NO_SHOW with an escalation email to MASTER_ADMINs.</p>
    </div>
  );
}

function ScheduleNewTab({ rows, onDone }: { rows: UnscheduledRow[] | null; onDone: (keys: IssuedKey[]) => Promise<void> }) {
  const toast = useToast();
  const [mode, setMode] = useState<"select" | "jd">("select");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jdRef, setJdRef] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const byJd = useMemo(() => {
    const m = new Map<string, UnscheduledRow[]>();
    for (const r of rows ?? []) {
      if (!r.jdRef) continue;
      m.set(r.jdRef, [...(m.get(r.jdRef) ?? []), r]);
    }
    return m;
  }, [rows]);

  const ids = mode === "select" ? [...selected] : (byJd.get(jdRef) ?? []).map((r) => r.interviewId);
  const allSelected = !!rows?.length && selected.size === rows.length;

  const submit = async () => {
    setBusy(true);
    try {
      const scheduledAt = new Date(when).toISOString();
      let keys: IssuedKey[];
      if (ids.length === 1) {
        keys = (await api<{ issued: IssuedKey[] }>("/schedule", { body: { interviewId: ids[0], scheduledAt } })).issued;
      } else {
        const r = await api<{ issued: IssuedKey[]; failed: { interviewId: string; error: string }[] }>("/schedule/bulk", { body: { interviewIds: ids, scheduledAt } });
        keys = r.issued;
        if (r.failed.length) toast(`${r.failed.length} interview(s) couldn't be scheduled: ${r.failed[0].error}`, "err");
      }
      toast(`Scheduled ${keys.length} interview(s).`);
      setSelected(new Set());
      setJdRef("");
      await onDone(keys);
    } catch (err) {
      toast(errorMessage(err), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="tabs sub" style={{ marginBottom: 14 }}>
        <button className={`tab-btn${mode === "select" ? " active" : ""}`} onClick={() => setMode("select")}>Select candidates</button>
        <button className={`tab-btn${mode === "jd" ? " active" : ""}`} onClick={() => setMode("jd")}>Bulk by JD</button>
      </div>

      {mode === "select" ? (
        <div className="table-scroll" style={{ maxHeight: 420, marginBottom: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set((rows ?? []).map((r) => r.interviewId)))} /></th>
                <th>Candidate</th><th>Email</th><th>Cluster</th><th>JD</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
              {rows?.length === 0 && <EmptyRow colSpan={5}>Everyone is scheduled. Import candidates or add a re-assessment to schedule more.</EmptyRow>}
              {rows?.map((r) => (
                <tr key={r.interviewId}>
                  <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.interviewId)} onChange={() => {
                    const next = new Set(selected);
                    if (next.has(r.interviewId)) next.delete(r.interviewId); else next.add(r.interviewId);
                    setSelected(next);
                  }} /></td>
                  <td>{r.name}{r.refId && <div className="sub-line">{r.refId}</div>}</td>
                  <td>{r.email}</td>
                  <td>{r.cluster}</td>
                  <td>{r.jdRef ?? <span className="pill warn">cluster-only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="form-field" style={{ maxWidth: 420, marginBottom: 14 }}>
          <label htmlFor="bulk-jd">JD</label>
          <select id="bulk-jd" value={jdRef} onChange={(e) => setJdRef(e.target.value)}>
            <option value="">Choose a JD…</option>
            {[...byJd.entries()].map(([ref, list]) => <option key={ref} value={ref}>{ref} ({list.length} candidate(s))</option>)}
          </select>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="form-field">
          <label htmlFor="sched-when">Date & time</label>
          <input id="sched-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: "auto" }} />
        </div>
        <button className="btn" style={{ alignSelf: "end" }} disabled={busy || ids.length === 0 || !when} onClick={() => void submit()}>
          {busy ? "Scheduling…" : `Schedule ${ids.length} & send access key(s)`}
        </button>
      </div>
    </div>
  );
}
