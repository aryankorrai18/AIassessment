import { Router } from "express";
import { candidatesCol, interviewsCol, jdMasterCol } from "../../lib/collections";
import { toMillis } from "../../lib/validation";
import { computeIntegrity } from "../../services/integrity";
import { reportFilename, writeReportPdf } from "../../services/pdfReport";
import { getInterview, loadCandidate, loadResultDetail, loadViolations } from "../../services/results";
import { runReportRetrySweep } from "../../services/sweeps";
import type { EvaluationResult } from "../../types/domain";

const router = Router();

router.post("/run-report-retry-sweep", async (_req, res) => {
  res.json(await runReportRetrySweep());
});

router.get("/", async (_req, res) => {
  const [interviews, candidates, jds] = await Promise.all([
    interviewsCol().where("status", "in", ["COMPLETED", "NO_SHOW"]).get(),
    candidatesCol().get(),
    jdMasterCol().select("title").get(),
  ]);
  const candidateById = new Map(candidates.docs.map((d) => [d.id, d.data()]));
  const jdTitle = new Map(jds.docs.map((d) => [d.id, d.data().title]));

  const rows = await Promise.all(interviews.docs.map(async (d) => {
    const iv = d.data();
    const candidate = candidateById.get(iv.candidateId);
    const summary = (iv.report?.status === "COMPLETED" ? iv.report.jsonSummary : null) as EvaluationResult | null;
    const violations = await loadViolations(d.id);
    const integrity = computeIntegrity(violations.map((v) => v.type));
    return {
      interviewId: d.id,
      empId: iv.candidateId,
      candidateName: candidate?.empName ?? iv.candidateId,
      cluster: candidate?.skillCluster ?? "unknown",
      jdTitle: iv.jdSnapshot?.title ?? (iv.jdRef ? jdTitle.get(iv.jdRef) ?? null : null),
      batchId: candidate?.batchId ?? null,
      status: iv.status === "NO_SHOW" ? "NO_SHOW" : iv.report?.status === "FAILED" ? "EVAL_FAILED" : "COMPLETED",
      reportStatus: iv.report?.status ?? null,
      score: summary?.overallScore ?? null, // RAW 0-100
      category: summary?.category ?? null,
      skillGap: summary?.skillGap ?? [],
      violationCount: violations.length,
      integrityScore: integrity.score,
      integrityVerdict: integrity.verdict,
      needsReview: integrity.needsReview,
      pdfPath: iv.report?.status === "COMPLETED" ? `/api/admin/results/${d.id}/pdf` : null,
      completedAt: toMillis(iv.completedAt),
    };
  }));
  rows.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  res.json(rows);
});

router.get("/:interviewId", async (req, res) => {
  const interview = await getInterview(req.params.interviewId);
  if (!interview) return res.status(404).json({ error: "Interview not found." });
  res.json(await loadResultDetail(req.params.interviewId, interview));
});

router.get("/:interviewId/pdf", async (req, res) => {
  const interview = await getInterview(req.params.interviewId);
  if (!interview) return res.status(404).json({ error: "Interview not found." });
  if (interview.report?.status !== "COMPLETED") return res.status(422).json({ error: "This interview hasn't been scored yet." });

  const [detail, candidate] = await Promise.all([loadResultDetail(req.params.interviewId, interview), loadCandidate(interview.candidateId)]);
  const header = {
    empId: interview.candidateId,
    name: candidate?.empName ?? interview.candidateId,
    jdTitle: interview.jdSnapshot?.title ?? candidate?.skillCluster ?? "General",
    cluster: candidate?.skillCluster ?? "unknown",
    completedAt: interview.completedAt?.toDate() ?? null,
  };
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${reportFilename(header)}"`);
  writeReportPdf(res, header, detail);
});

export default router;
