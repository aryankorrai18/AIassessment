import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { capitalize } from "../lib/format";
import type { JdListRow, QuestionRow } from "../lib/types";
import { EmptyRow } from "./shared";

const GENERIC = "__generic__";

export default function QuestionBank() {
  const toast = useToast();
  const [jds, setJds] = useState<JdListRow[]>([]);
  const [items, setItems] = useState<QuestionRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [jdFilter, setJdFilter] = useState("");
  const [cluster, setCluster] = useState("");
  const [section, setSection] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const loadJds = useCallback(async () => setJds(await api<JdListRow[]>("/jd-master")), []);

  const load = useCallback(async (append = false, from: string | null = null) => {
    try {
      const qs = new URLSearchParams();
      if (jdFilter) qs.set("jdRef", jdFilter);
      if (append && from) qs.set("cursor", from);
      const r = await api<{ items: QuestionRow[]; nextCursor: string | null }>(`/question-bank?${qs}`);
      setItems((prev) => (append && prev ? [...prev, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [jdFilter, toast]);

  useEffect(() => { void loadJds(); }, [loadJds]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const refreshAll = async () => {
    await Promise.all([loadJds(), load()]);
  };

  const filtered = useMemo(() => (items ?? []).filter((q) =>
    (!cluster || q.cluster === cluster) && (!section || q.section === section) && (!difficulty || q.difficulty === difficulty)), [items, cluster, section, difficulty]);
  const clusters = useMemo(() => [...new Set((items ?? []).map((q) => q.cluster))].sort(), [items]);
  const jdSpecific = (items ?? []).filter((q) => q.jdRef).length;
  const generic = (items ?? []).length - jdSpecific;
  const jdsWithQuestions = jds.filter((j) => j.hasQuestions).length;
  const selectedJd = jds.find((j) => j.jdRef === jdFilter);

  const deleteOne = async (q: QuestionRow) => {
    if (!window.confirm("Delete this question from the bank?")) return;
    try {
      await api(`/question-bank/${q.id}`, { method: "DELETE" });
      setItems((prev) => prev?.filter((x) => x.id !== q.id) ?? null);
      toast("Question deleted.");
      void loadJds();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  const deleteAll = async () => {
    if (!selectedJd || !items) return;
    if (!window.confirm(`Delete all ${items.length} questions for "${selectedJd.title}"? Candidates can't be interviewed against this JD until it is regenerated.`)) return;
    try {
      const r = await api<{ deleted: number }>(`/question-bank?jdRef=${encodeURIComponent(selectedJd.jdRef)}`, { method: "DELETE" });
      toast(`Deleted ${r.deleted} question(s).`);
      await refreshAll();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Question Bank</h1>
          <p>QA and visibility only — there is no approval gate. Every generated question is immediately usable in interviews.</p>
        </div>
      </div>

      <GenerateCard jds={jds} onGenerated={refreshAll} />

      <div className="stat-row">
        <div className="stat-card total"><div className="stat-label">Loaded questions</div><div className="stat-value">{items?.length ?? "—"}{cursor ? <span className="muted" style={{ fontSize: 13 }}> (more available)</span> : null}</div></div>
        <div className="stat-card ready"><div className="stat-label">JD-specific</div><div className="stat-value">{jdSpecific}</div></div>
        <div className="stat-card warn"><div className="stat-label">Generic cluster pool</div><div className="stat-value">{generic}</div></div>
        <div className="stat-card total"><div className="stat-label">JDs with questions</div><div className="stat-value">{jdsWithQuestions} / {jds.length}</div></div>
      </div>

      <div className="card">
        <div className="toolbar">
          <select aria-label="Filter by JD" value={jdFilter} onChange={(e) => setJdFilter(e.target.value)}>
            <option value="">All</option>
            <option value={GENERIC}>Generic pool only (no JD)</option>
            {jds.map((j) => <option key={j.jdRef} value={j.jdRef}>{j.title}</option>)}
          </select>
          <select aria-label="Filter by cluster" value={cluster} onChange={(e) => setCluster(e.target.value)}>
            <option value="">All clusters</option>
            {clusters.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Filter by section" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option><option value="definitions">Definitions</option><option value="scenarios">Scenarios</option><option value="coding">Coding</option>
          </select>
          <select aria-label="Filter by difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">All difficulties</option><option value="basic">Basic</option><option value="medium">Medium</option><option value="advanced">Advanced</option>
          </select>
          <span className="spacer" />
          {selectedJd && items && (
            <>
              <span className="muted">Full set: {items.length}</span>
              <button className="btn danger small" disabled={items.length === 0} onClick={() => void deleteAll()}>Delete all {items.length}</button>
            </>
          )}
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Question</th><th>Skill</th><th>Cluster / JD</th><th>Section</th><th>Tier</th><th>Difficulty</th><th /></tr></thead>
            <tbody>
              {items === null && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
              {items !== null && filtered.length === 0 && <EmptyRow colSpan={7}>No questions match.</EmptyRow>}
              {filtered.map((q) => (
                <tr key={q.id}>
                  <td style={{ maxWidth: 360 }}>{q.question}</td>
                  <td>{q.skill ? <span className="pill ok">{q.skill}</span> : <span className="faint">—</span>}</td>
                  <td>{q.cluster}<div style={{ marginTop: 3 }}>{q.jdRef ? <span className="pill ok">JD: {q.jdRef}</span> : <span className="pill warn">generic pool</span>}</div></td>
                  <td>{capitalize(q.section)}</td>
                  <td>{q.tier}</td>
                  <td>{capitalize(q.difficulty)}</td>
                  <td className="actions"><button className="btn secondary small" onClick={() => void deleteOne(q)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cursor && <div style={{ marginTop: 12 }}><button className="btn secondary" onClick={() => void load(true, cursor)}>Load more</button></div>}
      </div>
    </>
  );
}

function GenerateCard({ jds, onGenerated }: { jds: JdListRow[]; onGenerated: () => Promise<void> }) {
  const toast = useToast();
  const [mode, setMode] = useState<"jd" | "generic">("jd");
  const [jdRef, setJdRef] = useState("");
  const [cluster, setCluster] = useState("");
  const [tier, setTier] = useState("4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jd = jds.find((j) => j.jdRef === jdRef);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "jd" ? { mode, jdRef } : { mode, cluster: cluster.trim(), tier };
      const r = await api<{ created: number; replaced: number }>("/question-bank/generate", { body });
      toast(r.replaced > 0 ? `Regenerated: ${r.created} new questions replaced the previous ${r.replaced}.` : `Generated ${r.created} questions.`);
      await onGenerated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Generate questions</h2>
        <div className="tabs sub">
          <button className={`tab-btn${mode === "jd" ? " active" : ""}`} onClick={() => setMode("jd")}>Specific JD</button>
          <button className={`tab-btn${mode === "generic" ? " active" : ""}`} onClick={() => setMode("generic")}>No JD — generic cluster</button>
        </div>
      </div>
      {mode === "jd" ? (
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="g-jd">JD</label>
            <select id="g-jd" value={jdRef} onChange={(e) => setJdRef(e.target.value)}>
              <option value="">Choose a JD…</option>
              {jds.map((j) => <option key={j.jdRef} value={j.jdRef}>{j.title}{j.hasQuestions ? ` (${j.questionCount} questions)` : ""}</option>)}
            </select>
            {jd && <span className="form-hint">Cluster: {jd.skillCluster} · Difficulty will be calibrated from this JD's required experience band (not a manual tier)</span>}
          </div>
        </div>
      ) : (
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="g-cluster">Cluster</label>
            <input id="g-cluster" type="text" list="g-clusters" value={cluster} onChange={(e) => setCluster(e.target.value)} placeholder="e.g. QA Automation" />
            <datalist id="g-clusters">{[...new Set(jds.map((j) => j.skillCluster))].map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="form-field">
            <label htmlFor="g-tier">Tier</label>
            <select id="g-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="1">1 (most senior)</option><option value="2">2</option><option value="3">3</option><option value="4">4 (most junior)</option>
            </select>
            <span className="form-hint">Without a JD, tier is the only difficulty signal.</span>
          </div>
        </div>
      )}
      {error && <div className="callout err" role="alert">{error}</div>}
      <button className="btn" disabled={busy || (mode === "jd" ? !jdRef : !cluster.trim())} onClick={() => void generate()}>
        {busy ? "Generating 108 questions… (this can take a minute)" : jd?.hasQuestions && mode === "jd" ? "Regenerate (replaces existing)" : "Generate"}
      </button>
    </div>
  );
}
