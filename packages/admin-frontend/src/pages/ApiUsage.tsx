import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { fmtDateTimeSeconds, fmtTokens } from "../lib/format";
import type { ApiUsage as Usage } from "../lib/types";
import { EmptyRow } from "./shared";

const PURPOSE_LABELS: Record<string, string> = {
  "jd-extraction": "JD Extraction",
  "question-generation-set": "Question Gen (set)",
  "question-generation-single": "Question Gen (regenerate)",
};
const purposeLabel = (p: string) => PURPOSE_LABELS[p] ?? p;

export default function ApiUsage() {
  const toast = useToast();
  const [data, setData] = useState<Usage | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Usage>("/api-usage"));
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => void load(), [load]);

  const s = data?.summary;
  const breakdown = (m: Record<string, { calls: number; totalTokens: number }>, label = (k: string) => k) =>
    Object.entries(m).sort((a, b) => b[1].totalTokens - a[1].totalTokens).map(([k, v]) => (
      <tr key={k}><td>{label(k)}</td><td className="tabular">{v.calls}</td><td className="tabular">{fmtTokens(v.totalTokens)}</td></tr>
    ));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>API Usage</h1>
          <p>Gemini token spend by purpose and model — a cost-visibility view, not an ops health metric.</p>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat-card total"><div className="stat-label">Total calls</div><div className="stat-value">{s?.totalCalls ?? "—"}</div></div>
        <div className="stat-card total"><div className="stat-label">Total tokens</div><div className="stat-value">{s ? fmtTokens(s.totalTokens) : "—"}</div></div>
        <div className="stat-card total"><div className="stat-label">Avg tokens / call</div><div className="stat-value">{s ? (s.totalCalls ? fmtTokens(Math.round(s.totalTokens / s.totalCalls)) : "0") : "—"}</div></div>
        <div className="stat-card ready"><div className="stat-label">Calls (last 24h)</div><div className="stat-value">{s?.last24h.calls ?? "—"}</div></div>
      </div>
      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h2>By purpose</h2>
          <table className="data-table"><thead><tr><th>Purpose</th><th>Calls</th><th>Tokens</th></tr></thead>
            <tbody>{s && Object.keys(s.byPurpose).length ? breakdown(s.byPurpose, purposeLabel) : <EmptyRow colSpan={3}>No calls yet.</EmptyRow>}</tbody></table>
        </div>
        <div className="card">
          <h2>By model</h2>
          <table className="data-table"><thead><tr><th>Model</th><th>Calls</th><th>Tokens</th></tr></thead>
            <tbody>{s && Object.keys(s.byModel).length ? breakdown(s.byModel) : <EmptyRow colSpan={3}>No calls yet.</EmptyRow>}</tbody></table>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h2>Recent calls</h2><button className="btn secondary small" onClick={() => void load()}>Refresh</button></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>When</th><th>Purpose</th><th>Model</th><th>Prompt</th><th>Response</th><th>Total</th></tr></thead>
            <tbody>
              {!data && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
              {data?.recent.length === 0 && <EmptyRow colSpan={6}>No calls yet.</EmptyRow>}
              {data?.recent.map((r) => (
                <tr key={r.id}>
                  <td className="tabular">{fmtDateTimeSeconds(r.createdAt)}</td>
                  <td>{purposeLabel(r.purpose)}</td>
                  <td className="mono">{r.model}</td>
                  <td className="tabular">{fmtTokens(r.promptTokens)}</td>
                  <td className="tabular">{fmtTokens(r.responseTokens)}</td>
                  <td className="tabular">{fmtTokens(r.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s && <p className="form-hint" style={{ marginTop: 10 }}>Showing the {data!.recent.length} most recent of {s.totalCalls} total calls. Failed Gemini calls aren't logged here (no tokens are billed for a rejected request).</p>}
      </div>
    </>
  );
}
