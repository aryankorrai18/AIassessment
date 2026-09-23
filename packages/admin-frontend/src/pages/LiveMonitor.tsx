import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtElapsed } from "../lib/format";
import type { LiveRow } from "../lib/types";
import { EmptyRow } from "./shared";

const POLL_INTERVAL_MS = 7000;
const STALE_THRESHOLD_MS = 50_000; // 2.5× the candidate's 20s heartbeat

export default function LiveMonitor() {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await api<LiveRow[]>("/live-monitor");
        if (!cancelled) {
          setRows(r);
          setRefreshedAt(Date.now());
        }
      } catch {
        // failures are swallowed silently; the next poll retries
      }
    };
    void poll();
    const pollId = window.setInterval(poll, POLL_INTERVAL_MS);
    const tickId = window.setInterval(() => setNow(Date.now()), 1000); // animates elapsed times between polls
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, []);

  const isStale = (r: LiveRow) => !r.lastHeartbeatAt || now - r.lastHeartbeatAt > STALE_THRESHOLD_MS;
  const stale = (rows ?? []).filter(isStale).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Live Monitor</h1>
          <p>Interviews in progress right now, with how recently each candidate's browser checked in.</p>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat-card ready"><div className="stat-label">Active sessions</div><div className="stat-value">{rows?.length ?? "—"}</div></div>
        <div className="stat-card blocked"><div className="stat-label">Stale heartbeat (&gt;50s)</div><div className="stat-value">{stale}</div></div>
      </div>
      <div className="card">
        <div className="card-header">
          <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="pulse-dot" aria-hidden="true" /> Live sessions</h2>
          <span className="muted tabular">{refreshedAt ? `Last refreshed ${fmtElapsed(now - refreshedAt)} ago` : "Connecting…"}</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Candidate</th><th>Cluster</th><th>Elapsed</th><th>Last Heartbeat</th><th>Status</th></tr></thead>
            <tbody>
              {rows === null && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
              {rows?.length === 0 && <EmptyRow colSpan={5}>No interviews are in progress.</EmptyRow>}
              {rows?.map((r) => (
                <tr key={r.interviewId} className={isStale(r) ? "row-warning" : undefined}>
                  <td>{r.candidateName}</td>
                  <td>{r.cluster}</td>
                  <td className="tabular">{r.startedAt ? fmtElapsed(now - r.startedAt) : "not started"}</td>
                  <td className="tabular">{r.lastHeartbeatAt ? `${fmtElapsed(now - r.lastHeartbeatAt)} ago` : "never"}</td>
                  <td>{isStale(r) ? <span className="pill warn">⚠ Stale</span> : <span className="pill ok">✓ Live</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
