import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { IconUpload } from "../components/Icons";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { missingColumns, OPTIONAL_COLUMNS, REQUIRED_COLUMNS, rowFromSheet, validateRows, type ImportRow, type ValidatedRow } from "../lib/candidateValidation";
import { readFirstSheet } from "../lib/excel";
import { fmtDateTime } from "../lib/format";
import type { CandidateRow, JdListRow } from "../lib/types";
import { EmptyRow, Modal, StatusPill } from "./shared";

const PREVIEW_PAGE_SIZE = 100;
const IMPORT_CHUNK_SIZE = 200;

type ImportResponse = { imported: number; results: { rowIndex: number; email: string; status: "imported" | "skipped"; error?: string }[] };
type Tab = "list" | "bulk" | "single";

export default function Candidates() {
  const [tab, setTab] = useState<Tab>("list");
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [jds, setJds] = useState<JdListRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, j] = await Promise.all([api<CandidateRow[]>("/candidates"), api<JdListRow[]>("/jd-master")]);
      setCandidates(c);
      setJds(j);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Candidates</h1>
          <p>Import candidates, match them to a JD by exact title, and manage re-assessments.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([["list", "All Candidates"], ["bulk", "Bulk upload (Excel)"], ["single", "Add one candidate"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {error && <div className="callout err">{error}</div>}
      {tab === "list" && <CandidateList candidates={candidates} jds={jds} reload={load} />}
      {tab === "bulk" && <BulkUpload jds={jds} onImported={load} />}
      {tab === "single" && <AddOne jds={jds} onImported={load} />}
    </>
  );
}

// ---------------- List ----------------

function CandidateList({ candidates, jds, reload }: { candidates: CandidateRow[] | null; jds: JdListRow[]; reload: () => Promise<void> }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [reassessFor, setReassessFor] = useState<CandidateRow | null>(null);
  const titleByRef = useMemo(() => new Map(jds.map((j) => [j.jdRef, j.title])), [jds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (candidates ?? []).filter((c) => !q || c.email.includes(q) || c.name.toLowerCase().includes(q) || (c.refId ?? "").toLowerCase().includes(q));
  }, [candidates, search]);
  const pageRows = filtered.slice(page * PREVIEW_PAGE_SIZE, (page + 1) * PREVIEW_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE));

  const remove = async (c: CandidateRow, cascade: boolean) => {
    const attempts = c.interviewCount;
    const message = cascade
      ? `Delete ${c.name} (${c.email}) AND all ${attempts} interview attempt(s), including transcripts, scores and reports?\n\nThis cannot be undone.`
      : c.interviewStatus === "COMPLETED"
        ? `Delete candidate ${c.name} (${c.email})?\n\nTheir completed interview, score and report history are NOT deleted and stay visible in Results.`
        : `Delete candidate ${c.name} (${c.email})? Their interview record is kept.`;
    if (!window.confirm(message)) return;
    try {
      const r = await api<{ deletedInterviewCount: number }>(`/candidates/${encodeURIComponent(c.email)}${cascade ? "?cascade=true" : ""}`, { method: "DELETE" });
      toast(cascade ? `Deleted ${c.email} and ${r.deletedInterviewCount} interview record(s).` : `Deleted ${c.email}.`);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  return (
    <div className="card">
      <div className="toolbar">
        <input type="search" placeholder="Search name, email or reference ID" aria-label="Search candidates" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <button className="btn secondary" onClick={() => void reload()}>Refresh</button>
        <span className="spacer" />
        <span className="muted">{filtered.length} candidate(s)</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Reference ID</th><th>Cluster</th><th>JD Reference</th><th>Tier</th><th>Batch</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {candidates === null && <EmptyRow colSpan={9}>Loading…</EmptyRow>}
            {candidates !== null && pageRows.length === 0 && <EmptyRow colSpan={9}>{search ? "No candidates match your search." : "No candidates yet — import some from the Bulk upload tab."}</EmptyRow>}
            {pageRows.map((c) => {
              const busy = c.interviewStatus === "ACTIVE" || c.interviewStatus === "PENDING";
              return (
                <tr key={c.email}>
                  <td>{c.name}</td>
                  <td>{c.email}</td>
                  <td className="mono">{c.refId ?? <span className="faint">—</span>}</td>
                  <td>{c.skillCluster}</td>
                  <td>{c.jdRef ? titleByRef.get(c.jdRef) ?? c.jdRef : <span className="faint">—</span>}</td>
                  <td>{c.tier}</td>
                  <td>{c.batchId ? fmtDateTime(Date.parse(c.batchId)) : "—"}</td>
                  <td>
                    <StatusPill status={c.interviewStatus} />
                    {c.interviewCount > 1 && <span className="pill">×{c.interviewCount}</span>}
                  </td>
                  <td className="actions">
                    <button className="btn secondary small" disabled={busy} onClick={() => setReassessFor(c)}
                      title={busy ? (c.interviewStatus === "ACTIVE" ? "This candidate is taking an interview right now." : "This candidate already has an interview awaiting scheduling or start.") : undefined}>
                      Schedule Another Interview
                    </button>
                    <button className="btn secondary small" disabled={c.interviewStatus === "ACTIVE"} onClick={() => void remove(c, false)}
                      title={c.interviewStatus === "ACTIVE" ? "Can't delete while an interview is in progress." : undefined}>Delete</button>
                    <button className="btn danger small" disabled={c.interviewStatus === "ACTIVE"} onClick={() => void remove(c, true)}>Delete Candidate + Report</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn secondary small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
          <span className="muted">Page {page + 1} of {pages}</span>
          <button className="btn secondary small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
      {reassessFor && <ReassessModal candidate={reassessFor} jds={jds} onClose={() => setReassessFor(null)} onDone={reload} />}
    </div>
  );
}

function ReassessModal({ candidate, jds, onClose, onDone }: { candidate: CandidateRow; jds: JdListRow[]; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [jdReference, setJdReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ jdTitle: string }>(`/candidates/${encodeURIComponent(candidate.email)}/reassess`, { body: { jdReference } });
      toast(`Re-assessment against "${r.jdTitle}" created — schedule it from Interview Schedule.`);
      await onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Schedule another interview — ${candidate.name}`} onClose={onClose} locked={busy}>
      <form onSubmit={submit}>
        <p className="muted">Creates a new interview attempt against a JD. Previous attempts, scores and reports stay untouched.</p>
        <div className="form-field">
          <label htmlFor="reassess-jd">JD title</label>
          <input id="reassess-jd" type="text" list="reassess-jds" value={jdReference} onChange={(e) => setJdReference(e.target.value)} placeholder="Start typing a JD title" />
          <datalist id="reassess-jds">{jds.map((j) => <option key={j.jdRef} value={j.title} />)}</datalist>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !jdReference.trim()}>{busy ? "Creating…" : "Create attempt"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Bulk upload ----------------

async function importInChunks(rows: ImportRow[], onProgress: (landed: number) => void) {
  // ONE batchId for the whole operation, generated before chunking.
  const batchId = new Date().toISOString();
  let imported = 0;
  let processed = 0;
  const skipped: ImportResponse["results"] = [];
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
    try {
      const r = await api<ImportResponse>("/candidates/import", { body: { rows: chunk, batchId } });
      imported += r.imported;
      skipped.push(...r.results.filter((x) => x.status === "skipped"));
    } catch (err) {
      throw new Error(`Import stopped: ${imported} row(s) already landed before this error — ${errorMessage(err)}`);
    }
    processed += chunk.length;
    onProgress(processed);
  }
  return { imported, skipped };
}

function BulkUpload({ jds, onImported }: { jds: JdListRow[]; onImported: () => Promise<void> }) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{ imported: number; skipped: ImportResponse["results"] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.xlsx?$/i.test(file.name)) return setError("Please choose an .xlsx or .xls file.");
    try {
      const sheet = await readFirstSheet(file);
      if (sheet.length === 0) return setError("That sheet has no data rows.");
      const missing = missingColumns(Object.keys(sheet[0].values));
      if (missing.length) return setError(`Missing required column(s): ${missing.join(", ")}.`);
      const parsed = sheet.map((r) => rowFromSheet(r.rowNumber, r.values));
      setRows(validateRows(parsed, jds.map((j) => j.title), jds.map((j) => j.skillCluster)));
      setFileName(file.name);
      setOutcome(null);
      setStep(2);
    } catch (err) {
      setError(`Couldn't read that file: ${errorMessage(err)}`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void handleFile(e.dataTransfer.files[0]);
  };

  const ready = rows.filter((r) => r.errors.length === 0);
  const blocked = rows.length - ready.length;
  const withWarnings = ready.filter((r) => r.warnings.length > 0).length;

  const runImport = async () => {
    setStep(3);
    setError(null);
    setProgress({ done: 0, total: ready.length });
    try {
      // Only rows with zero errors are sent.
      const toSend = ready.map(({ errors: _e, warnings: _w, ...r }) => r);
      const result = await importInChunks(toSend, (done) => setProgress({ done, total: toSend.length }));
      setOutcome(result);
      toast(`Imported ${result.imported} candidate(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}.`);
      await onImported();
    } catch (err) {
      setError(errorMessage(err));
      await onImported();
    }
  };

  const reset = () => {
    setStep(1);
    setRows([]);
    setOutcome(null);
    setProgress(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="card">
      <div className="stepper">
        {["Upload", "Preview & Validate", "Import"].map((label, i) => (
          <div key={label} className={`step${step === i + 1 ? " active" : step > i + 1 ? " done" : ""}`}><span className="num">{i + 1}</span>{label}</div>
        ))}
      </div>
      {error && <div className="callout err" role="alert">{error}</div>}

      {step === 1 && (
        <>
          <div className={`dropzone${drag ? " drag" : ""}`} role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <IconUpload />
            <p><strong>Drop an Excel file here</strong> or click to choose one (.xlsx, .xls)</p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />
          </div>
          <p className="form-hint" style={{ marginTop: 12 }}>
            Required columns: {REQUIRED_COLUMNS.map((c) => <span key={c} className="pill">{c}</span>)}
            {" "}Optional: {OPTIONAL_COLUMNS.map((c) => <span key={c} className="pill">{c}</span>)}
          </p>
          <p className="form-hint">Each candidate is identified by their email, which they also use to sign in. Reference ID is your own ID for them (e.g. an employee or applicant ID).</p>
        </>
      )}

      {step >= 2 && (
        <>
          <div className="stat-row">
            <div className="stat-card total"><div className="stat-label">Total rows</div><div className="stat-value">{rows.length}</div></div>
            <div className="stat-card ready"><div className="stat-label">Ready to import</div><div className="stat-value">{ready.length}</div></div>
            <div className="stat-card warn"><div className="stat-label">With warnings</div><div className="stat-value">{withWarnings}</div></div>
            <div className="stat-card blocked"><div className="stat-label">Blocked</div><div className="stat-value">{blocked}</div></div>
          </div>
          {step === 2 && (
            <div className="toolbar">
              <span className="muted">{fileName}</span>
              <span className="spacer" />
              <button className="btn secondary" onClick={reset}>Choose another file</button>
              <button className="btn" disabled={ready.length === 0} onClick={() => void runImport()}>Import {ready.length} row(s)</button>
            </div>
          )}
          {step === 3 && progress && (
            <div className="callout" role="status">
              {outcome ? (
                <>
                  <strong>Done.</strong> Imported {outcome.imported}; skipped {outcome.skipped.length}.
                  {outcome.skipped.length > 0 && (
                    <ul className="list-plain" style={{ marginTop: 6 }}>
                      {outcome.skipped.slice(0, 20).map((s) => <li key={`${s.rowIndex}-${s.email}`}>Row {s.rowIndex} ({s.email}): {s.error}</li>)}
                    </ul>
                  )}
                  <div style={{ marginTop: 10 }}><button className="btn secondary small" onClick={reset}>Import another file</button></div>
                </>
              ) : error ? (
                <button className="btn secondary small" onClick={reset}>Start over</button>
              ) : (
                <>Importing… {progress.done} / {progress.total} rows sent</>
              )}
            </div>
          )}
          <div className="table-scroll" style={{ maxHeight: 520 }}>
            <table className="data-table">
              <thead><tr><th>Row</th><th>Status</th><th>Name</th><th>Email</th><th>Reference ID</th><th>Cluster</th><th>Tier</th><th>JD Reference</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowIndex} className={r.errors.length ? "row-error" : r.warnings.length ? "row-warning" : undefined}>
                    <td>{r.rowIndex}</td>
                    <td style={{ minWidth: 220 }}>
                      <strong>{r.errors.length ? "✕ Blocked" : r.warnings.length ? "⚠ Warning" : "✓ Ready"}</strong>
                      {(r.errors.length > 0 || r.warnings.length > 0) && (
                        <ul className="list-plain sub-line">{[...r.errors, ...r.warnings].map((m) => <li key={m}>{m}</li>)}</ul>
                      )}
                    </td>
                    <td>{r.name}</td>
                    <td>{r.email}</td>
                    <td className="mono">{r.refId || <span className="faint">—</span>}</td>
                    <td>{r.skillCluster}</td>
                    <td>{r.tier || <span className="faint">—</span>}</td>
                    <td>{r.jdReference || <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- Add one ----------------

function AddOne({ jds, onImported }: { jds: JdListRow[]; onImported: () => Promise<void> }) {
  const toast = useToast();
  const empty = { name: "", email: "", refId: "", skillCluster: "", tier: "4", jdReference: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const clusters = [...new Set(jds.map((j) => j.skillCluster))];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const row: ImportRow = { rowIndex: 1, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) } as ImportRow;
    row.email = row.email.toLowerCase();
    const [validated] = validateRows([row], jds.map((j) => j.title), clusters);
    setErrors(validated.errors);
    if (validated.errors.length) return;
    setBusy(true);
    try {
      // Its own fresh batchId.
      const r = await api<ImportResponse>("/candidates/import", { body: { rows: [row], batchId: new Date().toISOString() } });
      const res = r.results[0];
      if (res?.status === "skipped") {
        setErrors([res.error ?? "Skipped."]);
      } else {
        toast(`Added ${res.email}.${validated.warnings.length ? ` Note: ${validated.warnings[0]}` : ""}`);
        setForm(empty);
        await onImported();
      }
    } catch (err) {
      setErrors([errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 760 }}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="c-name">Name</label><input id="c-name" type="text" value={form.name} onChange={set("name")} /></div>
        <div className="form-field">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" type="email" value={form.email} onChange={set("email")} />
          <span className="form-hint">Identifies the candidate; they sign in with it.</span>
        </div>
        <div className="form-field">
          <label htmlFor="c-ref">Reference ID <span className="faint">(optional)</span></label>
          <input id="c-ref" type="text" value={form.refId} onChange={set("refId")} placeholder="e.g. employee or applicant ID" />
        </div>
        <div className="form-field">
          <label htmlFor="c-cluster">Skill Cluster</label>
          <input id="c-cluster" type="text" list="c-clusters" value={form.skillCluster} onChange={set("skillCluster")} />
          <datalist id="c-clusters">{clusters.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="form-field">
          <label htmlFor="c-tier">Tier</label>
          <select id="c-tier" value={form.tier} onChange={set("tier")}>
            <option value="1">1 (most senior)</option><option value="2">2</option><option value="3">3</option><option value="4">4 (most junior)</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="c-jd">JD Reference</label>
          <input id="c-jd" type="text" list="c-jds" value={form.jdReference} onChange={set("jdReference")} placeholder="Exact JD title (optional)" />
          <datalist id="c-jds">{jds.map((j) => <option key={j.jdRef} value={j.title} />)}</datalist>
        </div>
      </div>
      {errors.length > 0 && <ul className="list-plain error-text" role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add candidate"}</button>
    </form>
  );
}
