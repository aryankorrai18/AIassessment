import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, score10 } from "../lib/format";
import type { JdListRow, LiveRow, ResultRow, ScheduledRow } from "../lib/types";
import { CategoryPill } from "./shared";

const STALE_MS = 60_000;

interface Data { results: ResultRow[]; schedule: ScheduledRow[]; live: LiveRow[]; jds: JdListRow[] }

/** No dedicated stats endpoint — everything is derived client-side. */
export default function Overview() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<ResultRow[]>("/results"),
      api<ScheduledRow[]>("/schedule"),
      api<LiveRow[]>("/live-monitor"),
      api<JdListRow[]>("/jd-master"),
    ])
      .then(([results, schedule, live, jds]) => setData({ results, schedule, live, jds }))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <div className="callout err">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const now = Date.now();
  const activeNow = data.live.filter((l) => l.lastHeartbeatAt && now - l.lastHeartbeatAt <= STALE_MS).length;
  const upcoming = data.schedule.filter((s) => s.status === "PENDING" && s.scheduledAt > now).length;
  const completed = data.results.filter((r) => r.status !== "NO_SHOW");
  const needsReview = data.results.filter((r) => r.needsReview).length;

  // Average over ONE row per candidate: their most recent COMPLETED attempt with a score.
  const latestByCandidate = new Map<string, ResultRow>();
  for (const r of data.results) {
    if (r.status !== "COMPLETED" || r.score === null) continue;
    const prev = latestByCandidate.get(r.empId);
    if (!prev || (r.completedAt ?? 0) > (prev.completedAt ?? 0)) latestByCandidate.set(r.empId, r);
  }
  const scored = [...latestByCandidate.values()];
  const avg = scored.length ? (scored.reduce((s, r) => s + r.score!, 0) / scored.length / 10).toFixed(1) : "—";

  const failed = data.results.filter((r) => r.status === "EVAL_FAILED").length;
  const noShows = data.results.filter((r) => r.status === "NO_SHOW").length;
  const jdsWithoutBank = data.jds.filter((j) => !j.hasQuestions).length;
  const scoring = data.results.filter((r) => r.reportStatus === "PENDING" || r.reportStatus === "PROCESSING").length;

  const attention = [
    failed && { to: "/admin/results", tone: "err", text: `${failed} evaluation(s) failed — retry from Results` },
    needsReview && { to: "/admin/results", tone: "err", text: `${needsReview} interview(s) flagged for integrity review` },
    noShows && { to: "/admin/schedule", tone: "warn", text: `${noShows} candidate(s) marked as no-show` },
    jdsWithoutBank && { to: "/admin/question-bank", tone: "warn", text: `${jdsWithoutBank} JD(s) without a question bank` },
    scoring && { to: "/admin/results", tone: "warn", text: `${scoring} report(s) still scoring` },
  ].filter(Boolean) as { to: string; tone: string; text: string }[];

  const recent = [...completed].filter((r) => r.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 5);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Where things stand across interviews, scoring and question banks.</p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card ready"><div className="stat-label">Active now</div><div className="stat-value">{activeNow}</div></div>
        <div className="stat-card total"><div className="stat-label">Upcoming scheduled</div><div className="stat-value">{upcoming}</div></div>
        <div className="stat-card total"><div className="stat-label">Interviews completed</div><div className="stat-value">{completed.length}</div></div>
        <div className="stat-card blocked"><div className="stat-label">Needs review</div><div className="stat-value">{needsReview}</div></div>
        <div className="stat-card total"><div className="stat-label">Average score (/10)</div><div className="stat-value">{avg}</div></div>
      </div>

      <div className="card">
        <h2>Needs your attention</h2>
        {attention.length === 0 ? (
          <p className="muted">All clear — no failed evaluations, integrity flags, no-shows, JDs missing questions, or reports still scoring.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {attention.map((a) => (
              <Link key={a.text} to={a.to} className={`callout ${a.tone}`} style={{ marginBottom: 0, color: "var(--text)" }}>{a.text} →</Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recently completed</h2>
        {recent.length === 0 ? <p className="muted">No completed interviews yet.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Candidate</th><th>Cluster</th><th>Score (/10)</th><th>Category</th><th>Completed</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.interviewId}>
                    <td>{r.candidateName}<div className="sub-line">{r.empId}</div></td>
                    <td>{r.cluster}</td>
                    <td className="tabular">{r.reportStatus === "COMPLETED" ? score10(r.score) : "Scoring…"}</td>
                    <td><CategoryPill category={r.category} /></td>
                    <td>{fmtDateTime(r.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
