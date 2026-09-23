import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { defaultWeightForLevel } from "../lib/format";
import type { ExpectedLevel, JdDetail, JdExtraction, JdListRow } from "../lib/types";
import { EmptyRow } from "./shared";

type Stage = "input" | "extract" | "review" | "saved";
interface SkillRow { skill: string; expectedLevel: ExpectedLevel; weight: number; weightEdited: boolean }
interface JdForm {
  title: string;
  jobRole: string;
  skillCluster: string;
  experienceYears: string;
  requiresCoding: boolean;
  requiredSkills: SkillRow[];
  responsibilities: string[];
  jdText: string;
}

const POLL_MS = 3000;
const MAX_POLLS = 10;

const blankForm = (): JdForm => ({ title: "", jobRole: "", skillCluster: "", experienceYears: "", requiresCoding: false, requiredSkills: [], responsibilities: [], jdText: "" });

export default function JdMaster() {
  const toast = useToast();
  const [jds, setJds] = useState<JdListRow[] | null>(null);
  const [stage, setStage] = useState<Stage>("input");
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [coding, setCoding] = useState<boolean | null>(null);
  const [inputMode, setInputMode] = useState<"paste" | "upload">("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<JdForm>(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ jdRef: string; title: string; created: boolean; hadQuestions: boolean; questionsReady: boolean; pollsDone: boolean } | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      setJds(await api<JdListRow[]>("/jd-master"));
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  }, [toast]);
  useEffect(() => {
    void loadList();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [loadList]);

  const reset = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    setStage("input");
    setEditingRef(null);
    setCoding(null);
    setTitle("");
    setText("");
    setFile(null);
    setForm(blankForm());
    setSaved(null);
    setError(null);
  };

  // ---- Duplicate detection (client-side, against the loaded list) ----
  const dup = useMemo(() => {
    const t = form.title.trim().toLowerCase();
    if (!t || editingRef || !jds) return { exact: null as string | null, near: [] as string[] };
    const exact = jds.find((j) => j.title.trim().toLowerCase() === t)?.title ?? null;
    const near = jds.filter((j) => j.title.toLowerCase() !== t && (j.title.toLowerCase().includes(t) || t.includes(j.title.toLowerCase()))).map((j) => j.title);
    return { exact, near };
  }, [form.title, jds, editingRef]);

  // ---- Extract ----
  const extract = async () => {
    setBusy(true);
    setError(null);
    setStage("extract");
    try {
      let result: JdExtraction;
      if (inputMode === "upload" && file) {
        const fd = new FormData();
        fd.append("file", file);
        result = await api<JdExtraction>("/jd-master/extract", { formData: fd });
      } else {
        result = await api<JdExtraction>("/jd-master/extract", { body: { text } });
      }
      setForm({
        title: title.trim(),
        jobRole: result.jobRole ?? "",
        skillCluster: result.skillCluster,
        experienceYears: result.experienceYears ?? "",
        requiresCoding: coding ?? result.requiresCoding,
        requiredSkills: result.requiredSkills.map((s) => ({ ...s, weightEdited: false })),
        responsibilities: result.responsibilities,
        jdText: result.jdText,
      });
      setStage("review");
    } catch (err) {
      setError(errorMessage(err));
      setStage("input");
    } finally {
      setBusy(false);
    }
  };

  // ---- Save ----
  const payload = () => ({
    jobRole: form.jobRole.trim() || null,
    skillCluster: form.skillCluster.trim() || "General",
    requiredSkills: form.requiredSkills.filter((s) => s.skill.trim()).map(({ skill, expectedLevel, weight }) => ({ skill: skill.trim(), expectedLevel, weight })),
    responsibilities: form.responsibilities.map((r) => r.trim()).filter(Boolean),
    experienceYears: form.experienceYears.trim() || null,
    requiresCoding: form.requiresCoding,
    jdText: form.jdText,
  });

  const pollForQuestions = (jdRef: string) => {
    let polls = 0;
    pollRef.current = window.setInterval(async () => {
      polls++;
      try {
        const list = await api<JdListRow[]>("/jd-master");
        setJds(list);
        const ready = list.find((j) => j.jdRef === jdRef)?.hasQuestions ?? false;
        if (ready || polls >= MAX_POLLS) {
          window.clearInterval(pollRef.current!);
          setSaved((s) => (s ? { ...s, questionsReady: ready, pollsDone: true } : s));
        }
      } catch {
        // keep polling until the cap
      }
    }, POLL_MS);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editingRef) {
        const r = await api<{ jdRef: string; title: string; hadQuestions: boolean }>(`/jd-master/${encodeURIComponent(editingRef)}`, { method: "PATCH", body: payload() });
        setSaved({ ...r, created: false, questionsReady: r.hadQuestions, pollsDone: true });
        toast(`Saved changes to "${r.title}".`);
      } else {
        const r = await api<{ jdRef: string; title: string }>("/jd-master", { body: { title: form.title.trim(), ...payload() } });
        setSaved({ ...r, created: true, hadQuestions: false, questionsReady: false, pollsDone: false });
        toast(`Saved "${r.title}". Generating its question bank…`);
        pollForQuestions(r.jdRef);
      }
      setStage("saved");
      await loadList();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = async (jdRef: string) => {
    try {
      const jd = await api<JdDetail>(`/jd-master/${encodeURIComponent(jdRef)}`);
      reset();
      setEditingRef(jdRef);
      setForm({
        title: jd.title,
        jobRole: jd.jobRole ?? "",
        skillCluster: jd.skillCluster,
        experienceYears: jd.experienceYears ?? "",
        requiresCoding: jd.requiresCoding,
        requiredSkills: jd.requiredSkills.map((s) => ({ ...s, weightEdited: true })),
        responsibilities: jd.responsibilities,
        jdText: jd.jdText,
      });
      setStage("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  const stageIndex = { input: 0, extract: 1, review: 2, saved: 3 }[stage];
  const canExtract = coding !== null && title.trim() !== "" && !busy && (inputMode === "paste" ? text.trim() !== "" : file !== null);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>JD Master</h1>
          <p>Turn a job description into structured skills and levels. Saving a new JD generates its 108-question bank in the background.</p>
        </div>
        {stage !== "input" && <button className="btn secondary" onClick={reset}>+ New JD</button>}
      </div>

      <div className="card">
        <div className="stepper">
          {["Paste/Upload", "Extract", "Review & Edit", "Save"].map((label, i) => (
            <div key={label} className={`step${stageIndex === i ? " active" : stageIndex > i ? " done" : ""}`}><span className="num">{i + 1}</span>{label}</div>
          ))}
        </div>
        {error && <div className="callout err" role="alert">{error}</div>}

        {(stage === "input" || stage === "extract") && (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="form-field">
              <label htmlFor="jd-title">JD Title</label>
              <input id="jd-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Java Backend Engineer" />
              <span className="form-hint">This becomes the JD's identity everywhere — candidates are matched to it by exact title.</span>
            </div>
            <div className="form-field">
              <span className="form-label" id="coding-q">Does this role require a Coding test?</span>
              <div className="tabs sub" role="radiogroup" aria-labelledby="coding-q">
                <button type="button" role="radio" aria-checked={coding === true} className={`tab-btn${coding === true ? " active" : ""}`} onClick={() => setCoding(true)}>Yes</button>
                <button type="button" role="radio" aria-checked={coding === false} className={`tab-btn${coding === false ? " active" : ""}`} onClick={() => setCoding(false)}>No</button>
              </div>
              {coding === null && <span className="form-hint">Answer this first — it decides whether candidates get a coding section.</span>}
            </div>
            <fieldset disabled={coding === null} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
              <div className="tabs sub">
                <button type="button" className={`tab-btn${inputMode === "paste" ? " active" : ""}`} onClick={() => setInputMode("paste")}>Paste text</button>
                <button type="button" className={`tab-btn${inputMode === "upload" ? " active" : ""}`} onClick={() => setInputMode("upload")}>Upload file</button>
              </div>
              {inputMode === "paste" ? (
                <textarea rows={10} aria-label="Job description text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full job description here" />
              ) : (
                <input type="file" accept=".txt,.docx,.pdf" aria-label="Job description file" onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
                }} />
              )}
              <div>
                <button className="btn" type="button" disabled={!canExtract} onClick={() => void extract()}>{busy ? "Extracting with Gemini… (this can take a minute)" : "Extract skills"}</button>
              </div>
            </fieldset>
          </div>
        )}

        {stage === "review" && (
          <>
            {dup.exact && <div className="callout err" role="alert">A JD titled "{dup.exact}" already exists. Rename this one, or edit the existing JD instead.</div>}
            {!dup.exact && dup.near.length > 0 && <div className="callout warn">Similar JD title(s) already exist: {dup.near.map((t) => `"${t}"`).join(", ")}. Check this isn't a duplicate.</div>}
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="f-title">Title{editingRef ? " (locked)" : ""}</label>
                <input id="f-title" type="text" value={form.title} disabled={!!editingRef} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-field"><label htmlFor="f-role">Job Role</label><input id="f-role" type="text" value={form.jobRole} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} /></div>
              <div className="form-field">
                <label htmlFor="f-cluster">Skill Cluster</label>
                <input id="f-cluster" type="text" list="f-clusters" value={form.skillCluster} onChange={(e) => setForm({ ...form, skillCluster: e.target.value })} />
                <datalist id="f-clusters">{[...new Set((jds ?? []).map((j) => j.skillCluster))].map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div className="form-field"><label htmlFor="f-exp">Experience Years</label><input id="f-exp" type="text" value={form.experienceYears} placeholder="e.g. 5-8" onChange={(e) => setForm({ ...form, experienceYears: e.target.value })} /></div>
              <div className="form-field" style={{ alignSelf: "end" }}>
                <label className="checkbox"><input type="checkbox" checked={form.requiresCoding} onChange={(e) => setForm({ ...form, requiresCoding: e.target.checked })} /> Requires a Coding section</label>
              </div>
            </div>

            <h3 style={{ fontSize: 14, margin: "8px 0" }}>Required Skills</h3>
            <p className="form-hint" style={{ marginTop: 0 }}>Weight (1–10) sets interview emphasis. Suggested from level: L1 → 3, L2 → 6, L3 → 10. Changing the level re-suggests the weight unless you've edited the weight yourself.</p>
            <div className="table-scroll" style={{ marginBottom: 10 }}>
              <table className="data-table">
                <thead><tr><th>Skill</th><th>Level</th><th>Weight</th><th /></tr></thead>
                <tbody>
                  {form.requiredSkills.length === 0 && <EmptyRow colSpan={4}>No skills yet.</EmptyRow>}
                  {form.requiredSkills.map((s, i) => {
                    const update = (patch: Partial<SkillRow>) => setForm({ ...form, requiredSkills: form.requiredSkills.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <tr key={i}>
                        <td><input type="text" aria-label={`Skill ${i + 1}`} value={s.skill} onChange={(e) => update({ skill: e.target.value })} /></td>
                        <td style={{ width: 110 }}>
                          <select aria-label={`Level for skill ${i + 1}`} value={s.expectedLevel} onChange={(e) => {
                            const level = e.target.value as ExpectedLevel;
                            update(s.weightEdited ? { expectedLevel: level } : { expectedLevel: level, weight: defaultWeightForLevel(level) });
                          }}>
                            <option>L1</option><option>L2</option><option>L3</option>
                          </select>
                        </td>
                        <td style={{ width: 100 }}>
                          <input type="number" min={1} max={10} aria-label={`Weight for skill ${i + 1}`} value={s.weight}
                            onChange={(e) => update({ weight: Math.min(10, Math.max(1, Number(e.target.value) || 1)), weightEdited: true })} />
                        </td>
                        <td className="actions"><button type="button" className="btn secondary small" onClick={() => setForm({ ...form, requiredSkills: form.requiredSkills.filter((_, j) => j !== i) })}>Remove</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn secondary small" onClick={() => setForm({ ...form, requiredSkills: [...form.requiredSkills, { skill: "", expectedLevel: "L2", weight: 6, weightEdited: false }] })}>+ Add skill</button>

            <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Responsibilities</h3>
            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              {form.responsibilities.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6 }}>
                  <input type="text" aria-label={`Responsibility ${i + 1}`} value={r} onChange={(e) => setForm({ ...form, responsibilities: form.responsibilities.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="btn secondary small" onClick={() => setForm({ ...form, responsibilities: form.responsibilities.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn secondary small" onClick={() => setForm({ ...form, responsibilities: [...form.responsibilities, ""] })}>+ Add responsibility</button>

            <div className="form-field" style={{ marginTop: 18 }}>
              <label htmlFor="f-text">Full JD Text</label>
              <textarea id="f-text" rows={6} value={form.jdText} onChange={(e) => setForm({ ...form, jdText: e.target.value })} />
              <span className="form-hint">Always stored with the JD as admin-facing context.</span>
            </div>

            <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
              <button className="btn" disabled={busy || !form.title.trim() || !!dup.exact} onClick={() => void save()}>{busy ? "Saving…" : editingRef ? "Save changes" : "Save JD"}</button>
              <button className="btn secondary" onClick={reset} disabled={busy}>Cancel</button>
            </div>
          </>
        )}

        {stage === "saved" && saved && (
          <>
            {saved.created ? (
              saved.questionsReady ? (
                <div className="callout ok">Saved "{saved.title}". Its question bank is ready.</div>
              ) : saved.pollsDone ? (
                <div className="callout warn">Saved "{saved.title}". Question generation is still running (or failed) — check the Question Bank page shortly, or generate it from there.</div>
              ) : (
                <div className="callout">Saved "{saved.title}". Generating its question bank in the background… (checking every 3s)</div>
              )
            ) : (
              <>
                <div className="callout ok">Saved changes to "{saved.title}".</div>
                {saved.hadQuestions && <div className="callout warn">This JD's existing questions were not touched. Regenerate them from the Question Bank page so they reflect your edits.</div>}
              </>
            )}
            <button className="btn secondary" onClick={reset}>Add another JD</button>
          </>
        )}
      </div>

      <ExistingJds jds={jds} onEdit={startEdit} reload={loadList} />
    </>
  );
}

function ExistingJds({ jds, onEdit, reload }: { jds: JdListRow[] | null; onEdit: (jdRef: string) => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, JdDetail>>({});

  const toggle = async (jdRef: string) => {
    if (open === jdRef) return setOpen(null);
    setOpen(jdRef);
    if (!details[jdRef]) {
      try {
        const d = await api<JdDetail>(`/jd-master/${encodeURIComponent(jdRef)}`);
        setDetails((m) => ({ ...m, [jdRef]: d }));
      } catch (err) {
        toast(errorMessage(err), "err");
      }
    }
  };

  const remove = async (jd: JdListRow) => {
    if (!window.confirm(`Delete JD "${jd.title}" and its ${jd.questionCount} generated question(s)?\n\nThis is blocked while any candidate has an active or pending interview against it.`)) return;
    try {
      const r = await api<{ deletedQuestionCount: number }>(`/jd-master/${encodeURIComponent(jd.jdRef)}`, { method: "DELETE" });
      toast(`Deleted "${jd.title}" and ${r.deletedQuestionCount} question(s).`);
      await reload();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  return (
    <div className="card">
      <h2>Existing JDs</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Title</th><th>Skill Cluster</th><th>Coding?</th><th>Question Bank</th><th /></tr></thead>
          <tbody>
            {jds === null && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
            {jds?.length === 0 && <EmptyRow colSpan={5}>No JDs yet — add one above.</EmptyRow>}
            {jds?.map((jd) => (
              <Fragment key={jd.jdRef}>
                <tr>
                  <td><strong>{jd.title}</strong></td>
                  <td>{jd.skillCluster}</td>
                  <td>{jd.requiresCoding ? "Yes" : "No"}</td>
                  <td>{jd.hasQuestions ? <span className="pill ok">{jd.questionCount} questions</span> : <span className="pill warn">Not generated</span>}</td>
                  <td className="actions">
                    <button className="btn secondary small" aria-expanded={open === jd.jdRef} onClick={() => void toggle(jd.jdRef)}>{open === jd.jdRef ? "Hide" : "View"}</button>
                    <button className="btn secondary small" onClick={() => onEdit(jd.jdRef)}>Edit</button>
                    <button className="btn danger small" onClick={() => void remove(jd)}>Delete</button>
                  </td>
                </tr>
                {open === jd.jdRef && (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      {!details[jd.jdRef] ? <span className="muted">Loading…</span> : <JdDetailView jd={details[jd.jdRef]} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JdDetailView({ jd }: { jd: JdDetail }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div><strong>Job Role:</strong> {jd.jobRole || <span className="faint">not specified</span>} · <strong>Experience:</strong> {jd.experienceYears || <span className="faint">not specified</span>}</div>
      <div>
        <strong>Required Skills</strong>
        {jd.requiredSkills.length === 0 ? <p className="faint">No skills listed.</p> : (
          <table className="data-table" style={{ marginTop: 6, maxWidth: 520 }}>
            <thead><tr><th>Skill</th><th>Level</th><th>Weight</th></tr></thead>
            <tbody>{jd.requiredSkills.map((s) => <tr key={s.skill}><td>{s.skill}</td><td>{s.expectedLevel}</td><td>{s.weight}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <div>
        <strong>Responsibilities</strong>
        {jd.responsibilities.length === 0 ? <p className="faint">None listed.</p> : <ul className="list-plain" style={{ marginTop: 6 }}>{jd.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>
      <div>
        <strong>Full JD Text</strong>
        {jd.jdText ? <pre className="pre-block" style={{ marginTop: 6 }}>{jd.jdText}</pre> : <p className="faint">No text stored.</p>}
      </div>
    </div>
  );
}
