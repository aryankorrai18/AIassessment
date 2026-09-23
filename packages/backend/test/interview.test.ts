import { describe, expect, it, vi } from "vitest";
import type { InterviewState, SectionPlan } from "../src/types/interviewState";

vi.mock("../src/config/firebase", () => ({ db: {}, firestoreMode: "test" }));
const { drawSection, repairSkillCoverage, sectionsFor, splitAcrossDifficulties, SECTION_TARGETS } = await import("../src/services/interviewPlan");
const { advance, initialState, isExpired, skipSection, SECTION_TIME_LIMITS_MS } = await import("../src/services/stateMachine");
type PoolQuestion = import("../src/services/interviewPlan").PoolQuestion;

const DIFFS = ["basic", "medium", "advanced"] as const;
/** 12 questions per difficulty for a section, like a real generated bank. */
const bank = (section: "definitions" | "scenarios" | "coding", skillFor: (i: number) => string | null = () => null): PoolQuestion[] =>
  DIFFS.flatMap((difficulty) => Array.from({ length: 12 }, (_, i) => ({
    id: `${section}-${difficulty}-${i}`, section, difficulty, prompt: `${section} ${difficulty} ${i}`, skill: skillFor(i),
  })));

const profile = (hasCoding: boolean) => ({ empId: "E1", empName: "Test", cluster: "Java", jdRef: "jd", hasCoding });

function plan(hasCoding: boolean): SectionPlan[] {
  return sectionsFor(hasCoding).map((s) => drawSection(s, bank(s), hasCoding ? SECTION_TARGETS[s].coding : SECTION_TARGETS[s].nonCoding));
}
const bandCounts = (sp: SectionPlan) => DIFFS.map((d) => sp.questions.filter((q) => q.id.includes(`-${d}-`)).length);

describe("plan building (acceptance #9)", () => {
  it("splits remainders onto the easiest bands", () => {
    expect(splitAcrossDifficulties(8)).toEqual([3, 3, 2]);
    expect(splitAcrossDifficulties(15)).toEqual([5, 5, 5]);
    expect(splitAcrossDifficulties(3)).toEqual([1, 1, 1]);
    expect(splitAcrossDifficulties(10)).toEqual([4, 3, 3]);
    expect(splitAcrossDifficulties(20)).toEqual([7, 7, 6]);
  });

  it("coding candidate: 26 questions as 3/3/2, 5/5/5, 1/1/1", () => {
    const p = plan(true);
    expect(p.map((s) => s.section)).toEqual(["definitions", "scenarios", "coding"]);
    expect(p.reduce((n, s) => n + s.questions.length, 0)).toBe(26);
    expect(p.map(bandCounts)).toEqual([[3, 3, 2], [5, 5, 5], [1, 1, 1]]);
  });

  it("non-coding candidate gets MORE: 30 questions as 4/3/3, 7/7/6, and no coding section", () => {
    const p = plan(false);
    expect(p.map((s) => s.section)).toEqual(["definitions", "scenarios"]);
    expect(p.reduce((n, s) => n + s.questions.length, 0)).toBe(30);
    expect(p.map(bandCounts)).toEqual([[4, 3, 3], [7, 7, 6]]);
  });

  it("orders basic → medium → advanced with a 1-based contiguous index and no repeats", () => {
    for (const sp of plan(true)) {
      expect(sp.questions.map((q) => q.index)).toEqual(sp.questions.map((_, i) => i + 1));
      const order = sp.questions.map((q) => DIFFS.findIndex((d) => q.id.includes(`-${d}-`)));
      expect([...order].sort()).toEqual(order);
      expect(new Set(sp.questions.map((q) => q.id)).size).toBe(sp.questions.length);
    }
  });

  it("a short bucket contributes fewer questions instead of failing", () => {
    const thin = bank("definitions").filter((q) => q.difficulty !== "advanced" || q.id.endsWith("-0"));
    const sp = drawSection("definitions", thin, 10);
    expect(bandCounts(sp)).toEqual([4, 3, 1]);
    expect(sp.totalQuestions).toBe(8);
  });
});

describe("skill coverage repair", () => {
  it("swaps an uncovered bank skill in place, evicting a skill with ≥2 representatives", () => {
    const pool = bank("definitions", (i) => (i === 11 ? "Rare" : "Common"));
    const pools = new Map([["definitions" as const, pool]]);
    // A plan drawn only from "Common" questions.
    const sp = drawSection("definitions", pool.filter((q) => q.skill === "Common"), 8);
    const before = sp.questions.map((q) => q.index);
    const [repaired] = repairSkillCoverage([sp], pools);
    expect(repaired.questions.some((q) => q.skill === "Rare")).toBe(true);
    expect(repaired.questions).toHaveLength(8);
    expect(repaired.questions.map((q) => q.index)).toEqual(before);
  });

  it("leaves a skill uncovered when no swap is possible (no backtracking)", () => {
    const defs = drawSection("definitions", bank("definitions", () => "A"), 8);
    const pools = new Map([["definitions" as const, bank("definitions", () => "A")], ["coding" as const, bank("coding", () => "OnlyInCoding")]]);
    // The coding section isn't in this plan, so its skill can't be swapped in.
    const [repaired] = repairSkillCoverage([defs], pools);
    expect(repaired.questions.every((q) => q.skill === "A")).toBe(true);
  });

  it("evicts the section's LAST question when no skill has 2+ representatives", () => {
    const pool: PoolQuestion[] = [
      { id: "q1", section: "definitions", difficulty: "basic", prompt: "1", skill: "A" },
      { id: "q2", section: "definitions", difficulty: "basic", prompt: "2", skill: "B" },
      { id: "q3", section: "definitions", difficulty: "basic", prompt: "3", skill: "C" },
    ];
    const sp: SectionPlan = { section: "definitions", totalQuestions: 2, questions: [
      { id: "q1", section: "definitions", index: 1, prompt: "1", skill: "A" },
      { id: "q2", section: "definitions", index: 2, prompt: "2", skill: "B" },
    ] };
    const [repaired] = repairSkillCoverage([sp], new Map([["definitions" as const, pool]]));
    expect(repaired.questions.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(repaired.questions[1].index).toBe(2);
  });
});

describe("state machine", () => {
  const T0 = 1_000_000;
  const answer = (s: InterviewState, text = "x") => ({ questionId: s.currentQuestion.id, answer: text, inputMode: "typed" as const, score: 0 as const, feedback: "pending" as const });

  it("keeps the section clock within a section and resets it on a boundary", () => {
    let s = initialState(profile(true), plan(true), T0);
    for (let i = 0; i < 7; i++) s = advance(s, answer(s), T0 + 1000 * (i + 1));
    expect(s.currentSection).toBe("definitions");
    expect(s.sectionStartedAt).toBe(T0);
    s = advance(s, answer(s), T0 + 9000); // 8th and last definitions question
    expect(s.currentSection).toBe("scenarios");
    expect(s.sectionStartedAt).toBe(T0 + 9000);
    expect(s.currentQuestion.index).toBe(1);
    expect(s.answers).toHaveLength(8);
  });

  it("sets done after the last question of the last section", () => {
    let s = initialState(profile(true), plan(true), T0);
    for (let i = 0; i < 26; i++) s = advance(s, answer(s), T0);
    expect(s.done).toBe(true);
    expect(s.answers).toHaveLength(26);
    expect(advance(s, answer(s), T0)).toBe(s); // no-op once done
  });

  it("skipSection records NO answer for the open question and moves on", () => {
    let s = initialState(profile(false), plan(false), T0);
    s = advance(s, answer(s), T0);
    s = skipSection(s, T0 + 5);
    expect(s.answers).toHaveLength(1);
    expect(s.currentSection).toBe("scenarios");
    expect(s.sectionStartedAt).toBe(T0 + 5);
    s = skipSection(s, T0 + 6);
    expect(s.done).toBe(true);
  });

  it("expires exactly at sectionStartedAt + limit", () => {
    const s = initialState(profile(true), plan(true), T0);
    expect(SECTION_TIME_LIMITS_MS).toEqual({ definitions: 1_500_000, scenarios: 2_100_000, coding: 1_800_000 });
    expect(isExpired(s, T0 + 1_499_999)).toBe(false);
    expect(isExpired(s, T0 + 1_500_000)).toBe(true);
    expect(isExpired({ ...s, done: true }, T0 + 9_999_999)).toBe(false);
  });
});
