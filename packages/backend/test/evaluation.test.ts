import { describe, expect, it, vi } from "vitest";
import type { InterviewState } from "../src/types/interviewState";
import { prdCodeBlock } from "./prdFidelity";

vi.mock("../src/config/firebase", () => ({ db: {}, firestoreMode: "test" }));
const { buildEvaluationPrompt, buildTranscript, deriveEvaluation, getCategory, getLevel, levelMeetsExpected } = await import("../src/services/evaluation");
const { computeIntegrity, integrityVerdict } = await import("../src/services/integrity");

/** A plan of `n` questions in one section, all testing `skill`, with the first `answered` answered. */
function stateWith(sections: { section: "definitions" | "scenarios"; skills: (string | null)[] }[], answeredIds: string[]): InterviewState {
  const plan = sections.map(({ section, skills }) => ({
    section,
    totalQuestions: skills.length,
    questions: skills.map((skill, i) => ({ id: `${section}-${i}`, section, index: i + 1, prompt: `Q ${section} ${i}`, skill })),
  }));
  return {
    profile: { email: "t@example.com", name: "T", refId: null, cluster: "Java", jdRef: "jd", hasCoding: false },
    plan,
    currentSection: plan[0].section,
    sectionStartedAt: 0,
    currentQuestion: plan[0].questions[0],
    answers: answeredIds.map((questionId) => ({ questionId, answer: "an answer", inputMode: "typed" as const, score: 0 as const, feedback: "pending" as const })),
    done: true,
  };
}
const gemini = (scores: [number, number][]) => ({ summary: "s", strengths: [], improvements: [], sectionScores: [], questionScores: scores.map(([index, score]) => ({ index, score })) });

describe("evaluation derivations", () => {
  it("acceptance #14: 10 of 30 answered perfectly scores 33, not 100 (unreached count as 0)", () => {
    const skills = Array<string | null>(30).fill(null);
    const s = stateWith([{ section: "definitions", skills }], Array.from({ length: 10 }, (_, i) => `definitions-${i}`));
    const t = buildTranscript(s);
    const r = deriveEvaluation(s, t, gemini(Array.from({ length: 10 }, (_, i) => [i + 1, 10])), null);
    expect(r.overallScore).toBe(Math.round(((10 * 10 + 20 * 0) / 30) * 10));
    expect(r.overallScore).toBe(33);
    expect(r.category).toBe("Category 3");
  });

  it("acceptance #15: a skill whose questions were never reached is Not Assessed with met:false", () => {
    const s = stateWith([{ section: "definitions", skills: ["Java", "Java", "SQL", "SQL"] }], ["definitions-0", "definitions-1"]);
    const jd = { title: "T", experienceYears: null, requiredSkills: [
      { skill: "Java", expectedLevel: "L1" as const, weight: 3 }, { skill: "SQL", expectedLevel: "L1" as const, weight: 3 }, { skill: "Go", expectedLevel: "L1" as const, weight: 3 }] };
    const r = deriveEvaluation(s, buildTranscript(s), gemini([[1, 10], [2, 10]]), jd);
    expect(r.skillGap.find((g) => g.skill === "SQL")).toEqual({ skill: "SQL", expectedLevel: "L1", demonstratedLevel: "Not Assessed", met: false });
    expect(r.skillGap.find((g) => g.skill === "Go")!.demonstratedLevel).toBe("Not Assessed");
    expect(r.skillGap.find((g) => g.skill === "Java")).toMatchObject({ demonstratedLevel: "L3", met: true });
  });

  it("acceptance #16: a skill averaging exactly 4 after rounding shows L1 (and unreached tagged questions count as 0)", () => {
    // Scores 8 and 0 (unreached) → avg 4 → L1. 4.4 would round to 4 as well.
    const s = stateWith([{ section: "definitions", skills: ["Java", "Java"] }], ["definitions-0"]);
    const jd = { title: "T", experienceYears: null, requiredSkills: [{ skill: "Java", expectedLevel: "L1" as const, weight: 3 }] };
    const r = deriveEvaluation(s, buildTranscript(s), gemini([[1, 8]]), jd);
    expect(r.skillGap[0]).toMatchObject({ demonstratedLevel: "L1", met: true });
    expect(getLevel(Math.round(4.4))).toBe("L1");
    expect(getLevel(4.4)).toBe("Not Awarded"); // why rounding first matters
  });

  it("acceptance #17: overall 75 → Category 1, 74 → Category 2", () => {
    expect(getCategory(75 / 10)).toBe("Category 1");
    expect(getCategory(74 / 10)).toBe("Category 2");
    expect(getCategory(50 / 10)).toBe("Category 2");
    expect(getCategory(49 / 10)).toBe("Category 3");
  });

  it("band edges for getLevel and levelMeetsExpected", () => {
    expect([10, 9, 8, 5, 4, 3, 0].map(getLevel)).toEqual(["L3", "L3", "L2", "L2", "L1", "Not Awarded", "Not Awarded"]);
    expect(getLevel(null)).toBe("Not Awarded");
    expect(levelMeetsExpected("L2", "L2")).toBe(true);
    expect(levelMeetsExpected("L1", "L2")).toBe(false);
    expect(levelMeetsExpected("Not Awarded", "L1")).toBe(false);
  });

  it("section scores follow state.plan (not Gemini), a missing note becomes '', a reached-but-unscored question is 0", () => {
    const s = stateWith([{ section: "definitions", skills: [null, null] }, { section: "scenarios", skills: [null, null] }],
      ["definitions-0", "definitions-1", "scenarios-0"]);
    const r = deriveEvaluation(s, buildTranscript(s), {
      ...gemini([[1, 10], [2, 6], [99, 10]]), // #3 (scenarios-0) reached but unscored; 99 doesn't exist
      sectionScores: [{ section: "scenarios", note: "ok" }, { section: "bogus", note: "x" }],
    }, null);
    expect(r.sectionScores).toEqual([
      { section: "definitions", score: 80, note: "" },
      { section: "scenarios", score: 0, note: "ok" },
    ]);
    expect(r.overallScore).toBe(40);
  });

  it("a blank-string answer still counts as reached", () => {
    const s = stateWith([{ section: "definitions", skills: [null] }], []);
    s.answers.push({ questionId: "definitions-0", answer: "", inputMode: "voice", score: 0, feedback: "pending" });
    expect(buildTranscript(s)[0].reached).toBe(true);
  });
});

describe("evaluation prompt (Appendix A.3)", () => {
  it("renders the transcript block exactly: numbering, em-dash skill tag, 3-space answer indent, NOT REACHED", () => {
    const s = stateWith([{ section: "definitions", skills: ["Java", null] }], ["definitions-0"]);
    const prompt = buildEvaluationPrompt(buildTranscript(s), null, "Java");
    expect(prompt).toContain("1. [definitions — tests: Java] Q: Q definitions 0\n   A: an answer\n\n2. [definitions] Q: Q definitions 1\n   A: (NOT REACHED — interview ended before this question)");
    expect(prompt).toContain("Skill cluster: Java (no specific job description linked — evaluate against general expectations for this cluster).");
  });

  it("matches the PRD template verbatim around the interpolated blocks", () => {
    const template = prdCodeBlock("## A.3 Interview evaluation", 1);
    const s = stateWith([{ section: "definitions", skills: [null] }], []);
    const prompt = buildEvaluationPrompt(buildTranscript(s), null, "Java");
    const [head, rest] = template.split("${contextBlock}");
    const [middle, tail] = rest.split("${transcriptBlock}");
    expect(prompt.startsWith(head)).toBe(true);
    expect(prompt).toContain(middle);
    expect(prompt.endsWith(tail)).toBe(true);
  });
});

describe("integrity scoring", () => {
  it("acceptance #19: two NO_FACE events deduct 0; the third deducts 2", () => {
    expect(computeIntegrity(["NO_FACE", "NO_FACE"]).score).toBe(100);
    expect(computeIntegrity(["NO_FACE", "NO_FACE", "NO_FACE"]).score).toBe(98);
  });

  it("acceptance #20: eight TAB_SWITCH deduct 10+13+16+19+22+25+28+30 = 163 and floor at 0", () => {
    const r = computeIntegrity(Array(8).fill("TAB_SWITCH"));
    expect(r.breakdown).toEqual([{ type: "TAB_SWITCH", count: 8, pointsDeducted: 163 }]);
    expect(r.score).toBe(0);
  });

  it("acceptance #21: a score of 39 sets needsReview with the em-dash verdict", () => {
    const r = computeIntegrity(["PROHIBITED_OBJECT", "PROHIBITED_OBJECT", "PROHIBITED_OBJECT", "MIC_SILENCE_TIMEOUT", "MIC_SILENCE_TIMEOUT"]);
    // PROHIBITED_OBJECT: 15 + 20 + 24 = 59; MIC_SILENCE_TIMEOUT: 1 grace, then 2 → 61 deducted → 39
    expect(r.score).toBe(39);
    expect(r.needsReview).toBe(true);
    expect(r.verdict).toBe("Major Violations — Review Required");
  });

  it("rounds per occurrence, not per type subtotal", () => {
    // PROHIBITED_OBJECT ×4: 15 + round(19.5)=20 + 24 + round(28.5)=29 = 88. Rounding the subtotal (87) would give 87.
    expect(computeIntegrity(Array(4).fill("PROHIBITED_OBJECT")).breakdown[0].pointsDeducted).toBe(88);
  });

  it("verdict bands and breakdown sort", () => {
    expect([100, 90, 89, 70, 69, 40, 39].map(integrityVerdict)).toEqual([
      "Clean", "Clean", "Minor Concerns", "Minor Concerns", "Significant Concerns", "Significant Concerns", "Major Violations — Review Required"]);
    const r = computeIntegrity(["GAZE_AWAY", "GAZE_AWAY", "GAZE_AWAY", "PROHIBITED_OBJECT"]);
    expect(r.breakdown.map((b) => b.type)).toEqual(["PROHIBITED_OBJECT", "GAZE_AWAY"]);
    expect(r.needsReview).toBe(false);
  });
});
