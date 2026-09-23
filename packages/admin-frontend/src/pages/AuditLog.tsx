import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { fmtDateTimeSeconds } from "../lib/format";
import type { AuditRow } from "../lib/types";
import { EmptyRow } from "./shared";

// Destructive red, additive green, modification amber.
const ACTIONS: Record<string, { label: string; tone: "err" | "ok" | "warn" }> = {
  CANDIDATE_DELETED: { label: "Candidate deleted", tone: "err" },
  QUESTION_BANK_CLEARED: { label: "Question bank cleared", tone: "err" },
  QUESTION_DELETED: { label: "Question deleted", tone: "err" },
  ADMIN_DEACTIVATED: { label: "Admin access changed", tone: "err" },
  ACCESS_KEY_REISSUED: { label: "Access key reissued", tone: "err" },
  JD_DELETED: { label: "JD deleted", tone: "err" },
  GEMINI_KEY_CLEARED: { label: "Gemini API key cleared", tone: "err" },
  CANDIDATE_IMPORTED: { label: "Candidates imported", tone: "ok" },
  JD_CREATED: { label: "JD created", tone: "ok" },
  ADMIN_CREATED: { label: "Admin created", tone: "ok" },
  QUESTION_BANK_GENERATED: { label: "Questions generated", tone: "ok" },
  INTERVIEW_SCHEDULED: { label: "Interview scheduled", tone: "ok" },
  INTERVIEW_ATTEMPT_ADDED: { label: "Re-assessment scheduled", tone: "ok" },
  GEMINI_KEY_UPDATED: { label: "Gemini API key updated", tone: "warn" },
  JD_UPDATED: { label: "JD updated", tone: "warn" },
  ADMIN_PROFILE_UPDATED: { label: "Admin profile updated", tone: "warn" },
  ADMIN_PASSWORD_RESET: { label: "Password reset by email", tone: "warn" },
};

export default function AuditLog() {
  const toast = useToast();
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (from: string | null = null) => {
    try {
      const r = await api<{ items: AuditRow[]; nextCursor: string | null }>(`/audit-log${from ? `?cursor=${encodeURIComponent(from)}` : ""}`);
      setItems((prev) => (from && prev ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => void load(), [load]);

  // Both filters are client-side over already-loaded rows (the backend query is a bare orderBy).
  const presentActions = useMemo(() => [...new Set((items ?? []).map((i) => i.action))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((i) => (!action || i.action === action) &&
      (!q || [i.summary, i.actorName, i.actorEmail, i.targetId].some((f) => f.toLowerCase().includes(q))));
  }, [items, search, action]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Who changed what, and when. Append-only — entries can't be edited or deleted from anywhere in this app.</p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search summary, actor or target" aria-label="Search audit log" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {presentActions.map((a) => <option key={a} value={a}>{ACTIONS[a]?.label ?? a}</option>)}
          </select>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>When</th><th>Action</th><th>Summary</th><th>By</th><th /></tr></thead>
            <tbody>
              {!items && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
              {items && filtered.length === 0 && <EmptyRow colSpan={5}>No entries{items.length ? " match" : " yet"}.</EmptyRow>}
              {filtered.map((i) => (
                <Fragment key={i.id}>
                  <tr>
                    <td className="tabular" style={{ whiteSpace: "nowrap" }}>{fmtDateTimeSeconds(i.createdAt)}</td>
                    <td><span className={`pill ${ACTIONS[i.action]?.tone ?? ""}`}>{ACTIONS[i.action]?.label ?? i.action}</span></td>
                    <td>{i.summary}</td>
                    <td>{i.actorName}<div className="sub-line">{i.actorEmail}</div></td>
                    <td className="actions"><button className="btn secondary small" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "Hide" : "Details"}</button></td>
                  </tr>
                  {open === i.id && (
                    <tr className="detail-row">
                      <td colSpan={5}>
                        <div className="muted" style={{ marginBottom: 6 }}>{i.targetType} · <span className="mono">{i.targetId}</span></div>
                        <pre className="pre-block">{JSON.stringify(i.detail, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="muted">Showing {filtered.length} of {items?.length ?? 0} loaded entries</span>
          {cursor && <button className="btn secondary small" onClick={() => void load(cursor)}>Load older entries</button>}
        </div>
      </div>
    </>
  );
}
