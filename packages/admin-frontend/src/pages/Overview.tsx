import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, score10 } from "../lib/format";
import type { JdListRow, LiveRow, ResultRow, ScheduledRow } from "../lib/types";
import { CategoryPill } from "./shared";

const STALE_MS = 60_000;
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number) => (n < WORDS.length ? WORDS[n] : String(n));
const plural = (n: number, noun: string) => (n === 1 ? noun : `${noun}s`);
const verb = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface Data { results: ResultRow[]; schedule: ScheduledRow[]; live: LiveRow[]; jds: JdListRow[] }
interface Clause { n: number; text: (n: number) => string; to: string; flag?: boolean }
interface Todo { n: number; text: string; to: string; go: string; tone: "err" | "warn" }

/** Joins clauses as prose: "A, B and C." — each clause links to where it gets handled. */
function Brief({ clauses, fallback }: { clauses: Clause[]; fallback: string }) {
  const shown = clauses.filter((c) => c.n > 0).slice(0, 4);
  if (shown.length === 0) return <p className="brief-lead">{fallback}</p>;
  const parts: ReactNode[] = [];
  shown.forEach((c, i) => {
    let text = c.text(c.n);
    if (i === 0) text = text[0].toUpperCase() + text.slice(1);
    if (i > 0) parts.push(i === shown.length - 1 ? " and " : ", ");
    parts.push(<Link key={c.to + i} to={c.to} className={c.flag ? "flag" : undefined}>{text}</Link>);
  });
  return <p className="brief-lead">{parts}.</p>;
}

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

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  if (error) return <div className="callout err">{error}</div>;
  if (!data) {
    return (
      <div aria-busy="true" aria-label="Loading overview">
        <div className="skeleton" style={{ height: 16, width: 160, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 38, width: "70%", marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 38, width: "45%", marginBottom: 36 }} />
        <div className="skeleton" style={{ height: 84, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  const now = Date.now();
  const activeNow = data.live.filter((l) => l.lastHeartbeatAt && now - l.lastHeartbeatAt <= STALE_MS).length;
  const upcoming = data.schedule.filter((s) => s.status === "PENDING" && s.scheduledAt > now).length;
  const completed = data.results.filter((r) => r.status !== "NO_SHOW");
  const needsReview = data.results.filter((r) => r.needsReview).length;

  // Average over ONE row per candidate: their most recent COMPLETED attempt with a score.
  const latestByCandidate = new Map<string, ResultRow>();
  for (const r of data.results) {
    if (r.status !== "COMPLETED" || r.score === null) continue;
    const prev = latestByCandidate.get(r.email);
    if (!prev || (r.completedAt ?? 0) > (prev.completedAt ?? 0)) latestByCandidate.set(r.email, r);
  }
  const scored = [...latestByCandidate.values()];
  const avg = scored.length ? (scored.reduce((s, r) => s + r.score!, 0) / scored.length / 10).toFixed(1) : "—";

  const failed = data.results.filter((r) => r.status === "EVAL_FAILED").length;
  const noShows = data.results.filter((r) => r.status === "NO_SHOW").length;
  const jdsWithoutBank = data.jds.filter((j) => !j.hasQuestions).length;
  const scoring = data.results.filter((r) => r.reportStatus === "PENDING" || r.reportStatus === "PROCESSING").length;

  // Most urgent first; the sentence shows the first four that apply.
  const clauses: Clause[] = [
    { n: failed, to: "/admin/results", flag: true, text: (n) => `${word(n)} ${plural(n, "report")} couldn't be generated` },
    { n: needsReview, to: "/admin/results", flag: true, text: (n) => `${word(n)} ${plural(n, "interview")} ${verb(n, "needs", "need")} an integrity review` },
    { n: noShows, to: "/admin/schedule", text: (n) => `${word(n)} ${plural(n, "candidate")} didn't show up` },
    { n: activeNow, to: "/admin/live-monitor", text: (n) => `${word(n)} ${plural(n, "interview")} ${verb(n, "is", "are")} in progress` },
    { n: scoring, to: "/admin/results", text: (n) => `${word(n)} ${plural(n, "report")} ${verb(n, "is", "are")} still scoring` },
    { n: jdsWithoutBank, to: "/admin/question-bank", text: (n) => `${word(n)} ${plural(n, "JD")} ${verb(n, "needs", "need")} a question bank` },
    { n: upcoming, to: "/admin/schedule", text: (n) => `${word(n)} ${plural(n, "candidate")} ${verb(n, "is", "are")} scheduled to start` },
  ];
  const fallback = completed.length
    ? `Nothing needs you right now. ${word(completed.length)[0].toUpperCase() + word(completed.length).slice(1)} ${plural(completed.length, "interview")} completed so far.`
    : "Nothing needs you right now. Schedule a candidate to see results here.";

  const todos: Todo[] = [
    { n: failed, tone: "err", to: "/admin/results", go: "Retry in Results", text: `${failed} ${plural(failed, "evaluation")} failed` },
    { n: needsReview, tone: "err", to: "/admin/results", go: "Review in Results", text: `${needsReview} ${plural(needsReview, "interview")} flagged for integrity review` },
    { n: noShows, tone: "warn", to: "/admin/schedule", go: "Reschedule", text: `${noShows} ${plural(noShows, "candidate")} marked as no-show` },
    { n: jdsWithoutBank, tone: "warn", to: "/admin/question-bank", go: "Generate questions", text: `${jdsWithoutBank} ${plural(jdsWithoutBank, "JD")} without a question bank` },
    { n: scoring, tone: "warn", to: "/admin/results", go: "Open Results", text: `${scoring} ${plural(scoring, "report")} still scoring` },
  ];
  const attention = todos.filter((t) => t.n > 0);

  const recent = [...completed].filter((r) => r.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 5);

  return (
    <>
      <h1 className="visually-hidden">Overview</h1>
      <section className="brief" aria-label="Summary">
        <div className="brief-date">{today}</div>
        <Brief clauses={clauses} fallback={fallback} />
      </section>

      <div className="stat-row">
        <div className="stat-card ready"><div className="stat-label">Active now</div><div className="stat-value">{activeNow}</div></div>
        <div className="stat-card total"><div className="stat-label">Scheduled</div><div className="stat-value">{upcoming}</div></div>
        <div className="stat-card total"><div className="stat-label">Completed</div><div className="stat-value">{completed.length}</div></div>
        <div className="stat-card blocked"><div className="stat-label">Needs review</div><div className="stat-value">{needsReview}</div></div>
        <div className="stat-card total"><div className="stat-label">Average score (out of 10)</div><div className="stat-value">{avg}</div></div>
      </div>

      <div className="card">
        <h2>Needs your attention</h2>
        {attention.length === 0 ? (
          <p className="muted">All clear: no failed evaluations, integrity flags, no-shows, JDs missing questions or reports still scoring.</p>
        ) : (
          <ul className="attention-list">
            {attention.map((a) => (
              <li key={a.text}>
                <Link to={a.to}>
                  <span className={`attention-dot ${a.tone}`} aria-hidden="true" />
                  <span className="attention-text">{a.text}</span>
                  <span className="attention-go">{a.go}</span>
                </Link>
              </li>
            ))}
          </ul>
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
                    <td>{r.candidateName}<div className="sub-line">{r.email}</div></td>
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
