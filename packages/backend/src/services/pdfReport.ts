import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import type { ViolationType } from "../types/domain";
import { VIOLATION_LABELS } from "./integrity";
import type { ResultDetail } from "./results";

export interface ReportHeader {
  email: string;
  name: string;
  jdTitle: string;
  cluster: string;
  completedAt: Date | null;
}

const MARGIN = 50;
const COLORS = { text: "#1f2328", muted: "#656d76", accent: "#2f5bd3", ok: "#1a7f37", warn: "#9a6700", err: "#cf222e", rule: "#d0d7de", faint: "#8c959f" };

const DISCLAIMER =
  "AI-assisted assessment. Scores are derived from per-question ratings by a language model and integrity signals from automated " +
  "proctoring, both of which can be wrong. Use this report to inform — not replace — human hiring judgment.";

const safePart = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function reportFilename(h: ReportHeader): string {
  return `${[h.name, h.email, h.jdTitle, ymd(h.completedAt ?? new Date())].map(safePart).join("_")}.pdf`;
}

const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });

/** Generated fresh and streamed — never persisted anywhere. */
export function writeReportPdf(out: Writable, header: ReportHeader, detail: ResultDetail) {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `GapVise AI report — ${header.name}` } });
  doc.pipe(out);
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 20; // room for the footer
  const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };

  const heading = (text: string) => {
    ensure(60);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.accent).text(text, MARGIN, doc.y, { width });
    const y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
    doc.moveDown(0.5).fillColor(COLORS.text).font("Helvetica").fontSize(10);
  };
  const para = (text: string, opts: { color?: string; font?: string; size?: number; indent?: number } = {}) => {
    doc.font(opts.font ?? "Helvetica").fontSize(opts.size ?? 10).fillColor(opts.color ?? COLORS.text);
    ensure(doc.heightOfString(text, { width: width - (opts.indent ?? 0) }) + 4);
    doc.text(text, MARGIN + (opts.indent ?? 0), doc.y, { width: width - (opts.indent ?? 0) });
  };

  /** Simple table with wrapped cells and page breaks between rows. */
  const table = (cols: { label: string; width: number }[], rows: { cells: string[]; colors?: (string | undefined)[] }[]) => {
    const drawRow = (cells: string[], bold: boolean, colors: (string | undefined)[] = []) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i].width - 8 }))) + 8;
      if (doc.y + h > bottom()) doc.addPage();
      const y = doc.y;
      let x = MARGIN;
      cells.forEach((c, i) => {
        doc.fillColor(colors[i] ?? (bold ? COLORS.muted : COLORS.text)).text(c, x + 4, y + 4, { width: cols[i].width - 8 });
        x += cols[i].width;
      });
      doc.moveTo(MARGIN, y + h).lineTo(MARGIN + width, y + h).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
      doc.y = y + h;
    };
    drawRow(cols.map((c) => c.label), true);
    rows.forEach((r) => drawRow(r.cells, false, r.colors));
    doc.x = MARGIN;
  };

  const ev = detail.evaluation;

  // ---- Header ----
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COLORS.text).text("GapVise AI — Candidate Assessment Report", MARGIN, MARGIN, { width });
  doc.moveDown(0.4).font("Helvetica").fontSize(10).fillColor(COLORS.muted);
  doc.text(`Candidate: ${header.name} (${header.email})`);
  doc.text(`Role: ${header.jdTitle}   ·   Cluster: ${header.cluster}`);
  doc.text(`Completed: ${header.completedAt ? formatDateTime(header.completedAt.getTime()) : "—"}`);

  // ---- Overall ----
  heading("Overall Assessment");
  if (ev) {
    const catColor = ev.category === "Category 1" ? COLORS.ok : ev.category === "Category 2" ? COLORS.warn : COLORS.err;
    doc.font("Helvetica-Bold").fontSize(22).fillColor(COLORS.text).text(`${(ev.overallScore / 10).toFixed(1)} / 10`, { continued: true });
    doc.font("Helvetica-Bold").fontSize(12).fillColor(catColor).text(`    ${ev.category}`);
    doc.moveDown(0.3);
    para(ev.summary);
  }

  // ---- Sections ----
  heading("Section Scores");
  if (ev) {
    table(
      [{ label: "Section", width: 110 }, { label: "Score", width: 60 }, { label: "Note", width: width - 170 }],
      ev.sectionScores.map((s) => ({ cells: [s.section[0].toUpperCase() + s.section.slice(1), `${(s.score / 10).toFixed(1)} / 10`, s.note || "—"] })),
    );
  }

  // ---- Strengths & improvements ----
  heading("Strengths & Improvements");
  if (ev) {
    para("Strengths", { font: "Helvetica-Bold", color: COLORS.ok });
    (ev.strengths.length ? ev.strengths : ["—"]).forEach((s) => para(`•  ${s}`, { indent: 8 }));
    doc.moveDown(0.4);
    para("Areas to improve", { font: "Helvetica-Bold", color: COLORS.warn });
    (ev.improvements.length ? ev.improvements : ["—"]).forEach((s) => para(`•  ${s}`, { indent: 8 }));
  }

  // ---- Skill gap ----
  heading("JD Skill Gap");
  if (ev && ev.skillGap.length) {
    table(
      [{ label: "Skill", width: width - 240 }, { label: "Expected", width: 70 }, { label: "Demonstrated", width: 100 }, { label: "Met", width: 70 }],
      ev.skillGap.map((g) => {
        // "Not Assessed" renders as a neutral dash — never a false "No".
        const notAssessed = g.demonstratedLevel === "Not Assessed";
        const met = notAssessed ? "—" : g.met ? "Yes" : "No";
        return { cells: [g.skill, g.expectedLevel, g.demonstratedLevel, met], colors: [undefined, undefined, notAssessed ? COLORS.faint : undefined, notAssessed ? COLORS.faint : g.met ? COLORS.ok : COLORS.err] };
      }),
    );
  } else {
    para("No JD skills to compare against (cluster-only interview).", { color: COLORS.muted });
  }

  // ---- Integrity ----
  heading("Integrity Evidence");
  const integ = detail.integrity;
  const verdictColor = integ.score >= 90 ? COLORS.ok : integ.score >= 40 ? COLORS.warn : COLORS.err;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.text).text(`${integ.score} / 100`, { continued: true });
  doc.fontSize(11).fillColor(verdictColor).text(`    ${integ.verdict}`);
  para(`${detail.violations.length} recorded event(s).${integ.needsReview ? " Flagged for human review — the interview was never auto-terminated." : ""}`, { color: COLORS.muted });
  if (integ.breakdown.length) {
    doc.moveDown(0.3);
    table(
      [{ label: "Signal", width: width - 160 }, { label: "Count", width: 60 }, { label: "Points deducted", width: 100 }],
      integ.breakdown.map((b) => ({ cells: [VIOLATION_LABELS[b.type as ViolationType] ?? b.type, String(b.count), String(b.pointsDeducted)] })),
    );
  }
  if (detail.violations.length) {
    doc.moveDown(0.5);
    para("Event log", { font: "Helvetica-Bold" });
    for (const v of detail.violations) {
      const label = `${formatDateTime(v.occurredAt)}  —  ${VIOLATION_LABELS[v.type] ?? v.type}`;
      if (v.snapshot) {
        ensure(140);
        para(label, { size: 9 });
        try {
          const buf = Buffer.from(v.snapshot.slice(v.snapshot.indexOf(",") + 1), "base64");
          const y = doc.y + 2;
          doc.image(buf, MARGIN + 8, y, { fit: [160, 120] });
          doc.y = y + 126;
        } catch {
          para("(snapshot could not be embedded)", { size: 8, color: COLORS.faint, indent: 8 });
        }
      } else {
        para(label, { size: 9 });
      }
    }
  }

  // ---- Transcript ----
  heading("Interview Transcript");
  detail.transcript.forEach((t, i) => {
    const meta = `${i + 1}. ${t.section.toUpperCase()} · ${t.reached ? (t.inputMode ?? "typed") : "NOT REACHED"}${t.skill ? ` · tests: ${t.skill}` : ""}`;
    ensure(50);
    para(meta, { size: 8, color: COLORS.faint, font: "Helvetica-Bold" });
    para(t.question, { font: "Helvetica-Bold", size: 10, color: t.reached ? COLORS.text : COLORS.faint });
    if (!t.reached) para("(not reached — interview ended before this question)", { font: "Helvetica-Oblique", size: 9, color: COLORS.faint, indent: 8 });
    else if (!t.answer.trim()) para("(no answer)", { font: "Helvetica-Oblique", size: 9, color: COLORS.muted, indent: 8 });
    else para(t.answer, { size: 9.5, indent: 8 });
    doc.moveDown(0.5);
  });

  // ---- Footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor(COLORS.faint)
      .text(DISCLAIMER, MARGIN, doc.page.height - MARGIN + 5, { width: width - 60 })
      .text(`Page ${i + 1} of ${range.count}`, MARGIN + width - 55, doc.page.height - MARGIN + 5, { width: 55, align: "right" });
    doc.page.margins.bottom = savedBottom;
  }
  doc.end();
}
