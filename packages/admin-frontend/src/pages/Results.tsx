import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { downloadWorkbook } from "../lib/excel";
import { capitalize, fmtDateTime, fmtDateTimeSeconds, score10, VIOLATION_LABELS, ymd } from "../lib/format";
import { latestScoredAttempts, summarizeSkillGaps } from "../lib/skillGap";
import type { ResultDetail, ResultRow } from "../lib/types";
import { CategoryPill, EmptyRow, VerdictPill } from "./shared";
import "../styles/results.css";

const POLL_MS = 4000;
const DOWNLOAD_GAP_MS = 300;
const COLS = 8;

const isScoring = (r: ResultRow) => r.reportStatus === "PENDING" || r.reportStatus === "PROCESSING";

export default function Results() {
  const toast = useToast();
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [cluster, setCluster] = useState("");
  const [jd, setJd] = useState("");
  const [batch, setBatch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<ResultRow[]>("/results"));
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => void load(), [load]);

  // Poll only while something is still scoring, then stop.
  const anyScoring = (rows ?? []).some(isScoring);
  useEffect(() => {
    if (!anyScoring) return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [anyScoring, load]);

  const all = rows ?? [];
  const clusters = useMemo(() => [...new Set(all.map((r) => r.cluster))].sort(), [all]);
  const jdTitles = useMemo(() => [...new Set(all.map((r) => r.jdTitle).filter(Boolean) as string[])].sort(), [all]);
  const batches = useMemo(() => [...new Set(all.map((r) => r.batchId).filter(Boolean) as string[])].sort().reverse(), [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) =>
      (!q || r.candidateName.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q)) &&
      (!cluster || r.cluster === cluster) && (!jd || r.jdTitle === jd) && (!batch || r.batchId === batch) && (!reviewOnly || r.needsReview));
  }, [all, search, cluster, jd, batch, reviewOnly]);
  const reviewCount = all.filter((r) => r.needsReview).length;
  const withPdf = filtered.filter((r) => r.pdfPath);

  const retrySweep = async () => {
    try {
      const r = await api<{ checked: number; retried: number }>("/results/run-report-retry-sweep", { method: "POST" });
      toast(`Report sweep done: ${r.checked} checked, ${r.retried} re-driven.`);
      await load();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  // Sequential with a gap: browsers throttle rapid programmatic downloads, and each PDF is generated on demand.
  const downloadAll = async () => {
    for (let i = 0; i < withPdf.length; i++) {
      setDownloading(`Downloading ${i + 1}/${withPdf.length}…`);
      const a = document.createElement("a");
      a.href = withPdf[i].pdfPath!;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
    }
    setDownloading(null);
  };

  const exportExcel = () => {
    const summary = summarizeSkillGaps(filtered);
    return downloadWorkbook(`results-export-${ymd()}.xlsx`, [
      {
        name: "Results",
        columns: ["Candidate", "Emp ID", "Cluster", "JD", "Status", "Score (/10)", "Category", "Integrity Score", "Integrity Verdict", "Violations", "Completed"],
        rows: filtered.map((r) => [r.candidateName, r.empId, r.cluster, r.jdTitle ?? "", statusLabel(r), r.reportStatus === "COMPLETED" ? score10(r.score) : "", r.category ?? "", r.integrityScore, r.integrityVerdict, r.violationCount, fmtDateTime(r.completedAt)]),
      },
      {
        name: "Skill Scores",
        columns: ["Candidate", "Emp ID", "JD", "Skill", "Expected Level", "Demonstrated Level", "Met Expectation"],
        rows: filtered.flatMap((r) => r.skillGap.map((g) => [r.candidateName, r.empId, r.jdTitle ?? "", g.skill, g.expectedLevel, g.demonstratedLevel,
          g.demonstratedLevel === "Not Assessed" ? "—" : g.met ? "Yes" : "No"])),
      },
      {
        name: "Skill Gap Summary",
        columns: ["JD", "Skill", "Expected Level", "% Met", "Met / Total", "Avg Demonstrated (0-3)"],
        rows: summary.map((s) => [s.jd, s.skill, s.expectedLevel, s.pctMet, `${s.met} / ${s.total}`, Number(s.avgDemonstrated.toFixed(2))]),
      },
    ]);
  };

  // Group by candidate, keeping the filtered order.
  const groups = useMemo(() => {
    const m = new Map<string, ResultRow[]>();
    for (const r of filtered) m.set(r.empId, [...(m.get(r.empId) ?? []), r]);
    return [...m.values()];
  }, [filtered]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Results</h1>
          <p>Scored interviews, integrity evidence and skill gaps. Scores display out of 10; integrity stays out of 100.</p>
        </div>
        <div className="page-actions">
          <button className="btn secondary" onClick={() => void retrySweep()}>Retry stuck reports</button>
          <button className="btn secondary" disabled={withPdf.length === 0 || downloading !== null} onClick={() => void downloadAll()}>{downloading ?? `Download PDFs (${withPdf.length})`}</button>
          <button className="btn" disabled={filtered.length === 0} onClick={() => void exportExcel()}>Export Master Excel</button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input type="search" placeholder="Search name or Emp ID" aria-label="Search results" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Filter by cluster" value={cluster} onChange={(e) => setCluster(e.target.value)}>
            <option value="">All clusters</option>{clusters.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Filter by JD" value={jd} onChange={(e) => setJd(e.target.value)}>
            <option value="">All JDs</option>{jdTitles.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select aria-label="Filter by batch" value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="">All batches</option>{batches.map((b) => <option key={b} value={b}>Imported {fmtDateTime(Date.parse(b))}</option>)}
          </select>
          <label className="checkbox"><input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} /> Needs review only ({reviewCount})</label>
        </div>
      </div>

      {jd && <SkillGapPanel rows={filtered} />}

      <div className="card">
        <div className="table-scroll">
          <table className="data-table results-table">
            <thead><tr><th>Candidate</th><th>JD</th><th>Status</th><th>Score (/10)</th><th>Category</th><th>Integrity</th><th>Completed</th><th /></tr></thead>
            <tbody>
              {rows === null && <EmptyRow colSpan={COLS}>Loading…</EmptyRow>}
              {rows !== null && groups.length === 0 && <EmptyRow colSpan={COLS}>No results{all.length ? " match these filters" : " yet"}.</EmptyRow>}
              {groups.map((g) => (g.length === 1 ? <AttemptRows key={g[0].interviewId} row={g[0]} /> : <CandidateGroup key={g[0].empId} rows={g} />))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const statusLabel = (r: ResultRow) => (r.status === "COMPLETED" ? "Completed" : r.status === "EVAL_FAILED" ? "Eval Failed" : "No Show");

function CandidateGroup({ rows }: { rows: ResultRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td><strong>{rows[0].candidateName}</strong><div className="sub-line">{rows[0].empId}</div></td>
        <td colSpan={6} className="muted">{rows.length} interview attempts — expand to see each JD's result.</td>
        <td className="actions"><button className="btn secondary small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : `Results (${rows.length})`}</button></td>
      </tr>
      {open && rows.map((r) => <AttemptRows key={r.interviewId} row={r} nested />)}
    </>
  );
}

function AttemptRows({ row: r, nested }: { row: ResultRow; nested?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={r.status !== "COMPLETED" ? "row-warning" : undefined}>
        <td style={nested ? { paddingLeft: 28 } : undefined}>
          {nested ? <strong>{r.jdTitle ?? "Cluster-only"}</strong> : <><strong>{r.candidateName}</strong><div className="sub-line">{r.empId}</div></>}
        </td>
        <td>{nested ? <span className="faint">—</span> : r.jdTitle ?? <span className="faint">cluster-only</span>}</td>
        <td>{r.status === "COMPLETED" ? "✓ Completed" : r.status === "EVAL_FAILED" ? "✕ Eval Failed" : "⚠ No Show"}</td>
        <td className="tabular">{r.status === "NO_SHOW" ? "—" : isScoring(r) ? "Scoring…" : score10(r.score)}</td>
        <td><CategoryPill category={r.category} /></td>
        <td className="tabular">
          {r.status === "NO_SHOW" ? "—" : <>{r.integrityScore}/100 <span className="muted">({r.violationCount})</span></>}
          {r.needsReview && <div className="error-text" style={{ fontSize: 12 }}>🚩 Needs review</div>}
        </td>
        <td>{fmtDateTime(r.completedAt)}</td>
        <td className="actions">
          <button className="btn secondary small" disabled={r.status === "NO_SHOW"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "View"}</button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={COLS}><ResultDetailView row={r} /></td>
        </tr>
      )}
    </>
  );
}

function ResultDetailView({ row }: { row: ResultRow }) {
  const [d, setD] = useState<ResultDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ResultDetail>(`/results/${row.interviewId}`).then(setD).catch((err) => setError(errorMessage(err)));
  }, [row.interviewId, row.reportStatus]);

  if (error) return <div className="callout err">{error}</div>;
  if (!d) return <span className="muted">Loading…</span>;
  const ev = d.evaluation;

  return (
    <div className="result-detail">
      <div>
        {d.reportStatus === "COMPLETED" && row.pdfPath && <a className="btn small" href={row.pdfPath} target="_blank" rel="noreferrer">Download PDF Report</a>}
        {d.reportStatus === "FAILED" && <div className="callout err" style={{ marginBottom: 0 }}>Evaluation failed: {d.lastError ?? "unknown error"}. Use "Retry stuck reports" to re-drive it.</div>}
        {(d.reportStatus === "PENDING" || d.reportStatus === "PROCESSING") && <div className="callout" style={{ marginBottom: 0 }}>Scoring is still running — this page refreshes automatically.</div>}
      </div>

      <div className="detail-grid">
        <div className="detail-box">
          <div className="detail-label">Overall assessment</div>
          {ev ? (
            <>
              <div className="big-score">{score10(ev.overallScore)} <span className="muted">/ 10</span></div>
              <CategoryPill category={ev.category} />
              <p style={{ marginBottom: 0 }}>{ev.summary}</p>
            </>
          ) : <span className="faint">Not scored yet.</span>}
        </div>
        <div className="detail-box">
          <div className="detail-label">By section</div>
          {ev ? ev.sectionScores.map((s) => (
            <div key={s.section} style={{ marginBottom: 8 }}>
              <strong>{capitalize(s.section)}</strong> <span className="tabular">{score10(s.score)} / 10</span>
              {s.note && <div className="sub-line">{s.note}</div>}
            </div>
          )) : <span className="faint">—</span>}
        </div>
        <div className="detail-box">
          <div className="detail-label">Integrity</div>
          <div className="big-score">{d.integrity.score} <span className="muted">/ 100</span></div>
          <VerdictPill verdict={d.integrity.verdict} /> <span className="muted">{d.violations.length} violation(s)</span>
          {d.integrity.needsReview && (
            <div className="callout err" style={{ marginTop: 10, marginBottom: 0 }}>
              Flagged for human review. The interview was <strong>never auto-terminated</strong> — review the evidence below before drawing conclusions.
            </div>
          )}
        </div>
      </div>

      {ev && (
        <div className="detail-grid two">
          <div className="detail-box strengths">
            <div className="detail-label">Strengths</div>
            {ev.strengths.length ? <ul className="list-plain">{ev.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <span className="faint">None noted.</span>}
          </div>
          <div className="detail-box improvements">
            <div className="detail-label">Areas to improve</div>
            {ev.improvements.length ? <ul className="list-plain">{ev.improvements.map((s) => <li key={s}>{s}</li>)}</ul> : <span className="faint">None noted.</span>}
          </div>
        </div>
      )}

      {ev && ev.skillGap.length > 0 && (
        <div>
          <div className="detail-label">JD skill gap</div>
          <table className="data-table" style={{ maxWidth: 680 }}>
            <thead><tr><th>Skill</th><th>Expected</th><th>Demonstrated</th><th>Met</th></tr></thead>
            <tbody>
              {ev.skillGap.map((g) => (
                <tr key={g.skill}>
                  <td>{g.skill}</td><td>{g.expectedLevel}</td><td>{g.demonstratedLevel}</td>
                  <td>{g.demonstratedLevel === "Not Assessed" ? <span className="faint">— Not assessed</span> : g.met ? <span className="pill ok">✓ Met</span> : <span className="pill err">✕ Gap</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="detail-label">Integrity evidence</div>
        {d.violations.length === 0 ? <span className="faint">No violations recorded.</span> : (
          <div className="evidence-grid">
            {d.violations.map((v) => (
              <div key={v.id} className="evidence-card">
                {v.snapshot ? <img src={v.snapshot} alt={`Snapshot: ${VIOLATION_LABELS[v.type] ?? v.type}`} /> : <div className="evidence-empty">No snapshot</div>}
                <div className="evidence-label">{VIOLATION_LABELS[v.type] ?? v.type}</div>
                <div className="sub-line tabular">{fmtDateTimeSeconds(v.occurredAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="detail-label">Transcript</div>
        {d.transcript.length === 0 ? <span className="faint">No transcript (interview never started).</span> : d.transcript.map((t, i) => (
          <div key={i} className="transcript-entry" style={t.reached ? undefined : { opacity: 0.7 }}>
            <div className="transcript-meta">{t.section} · {t.reached ? t.inputMode ?? "typed" : "not reached"}{t.skill ? ` · tests: ${t.skill}` : ""}</div>
            <div className="transcript-q">{t.question}</div>
            {!t.reached ? <div className="transcript-a"><em>(not reached — interview ended before this question)</em></div>
              : t.answer ? <div className="transcript-a">{t.answer}</div> : <div className="transcript-a"><em>(no answer)</em></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Only when a specific JD is selected — the aggregate is meaningless across mixed JDs. */
function SkillGapPanel({ rows }: { rows: ResultRow[] }) {
  const summary = summarizeSkillGaps(rows);
  const attempts = latestScoredAttempts(rows).length;
  return (
    <div className="card">
      <div className="card-header">
        <h2>Skill-gap summary</h2>
        <span className="muted">{attempts} candidate(s), most recent attempt each · "Not assessed" excluded</span>
      </div>
      {summary.length === 0 ? <p className="muted">No scored attempts with skill data for this JD yet.</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Skill</th><th>Expected Level</th><th>% Met</th><th>Avg Demonstrated</th></tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.skill}>
                  <td>{s.skill}</td>
                  <td>{s.expectedLevel}</td>
                  <td><span className={`pill ${s.pctMet >= 70 ? "ok" : s.pctMet >= 40 ? "warn" : "err"}`}>{s.pctMet}%</span> <span className="muted">({s.met}/{s.total})</span></td>
                  <td className="tabular">{s.avgDemonstrated.toFixed(1)} / 3</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

