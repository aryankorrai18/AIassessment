import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GeminiError } from "../src/lib/gemini";
import { defaultWeightForLevel, JD_EXTRACTION_PROMPT } from "../src/services/jdExtract";
import {
  assertSlotCoverage, buildGenerationPrompt, dedupeWithinSlots, deriveTierFromExperience, DIFFICULTIES,
  postProcess, resolveSkillName, SECTIONS, TOTAL_TARGET, type WeightedSkill,
} from "../src/services/questionGen";
import { prdCodeBlock, squash } from "./prdFidelity";

const skills: WeightedSkill[] = [
  { skill: "Java", expectedLevel: "L3", weight: 10 },
  { skill: "Spring Boot", expectedLevel: "L2", weight: 6 },
  { skill: "Git", expectedLevel: "L1", weight: 3 },
];

const fullSet = (perSlot: number) =>
  SECTIONS.flatMap((section) => DIFFICULTIES.flatMap((difficulty) =>
    Array.from({ length: perSlot }, (_, i) => ({ section, difficulty, question: `${section} ${difficulty} q${i}`, skill: "java" }))));

describe("weights (acceptance #1)", () => {
  it("maps L3/L2/L1 to exactly 10/6/3", () => {
    expect([defaultWeightForLevel("L3"), defaultWeightForLevel("L2"), defaultWeightForLevel("L1")]).toEqual([10, 6, 3]);
  });
});

describe("deriveTierFromExperience", () => {
  it.each([
    [null, "3"], ["", "3"], ["not stated", "3"],
    ["5-8", "2"],   // averages digit groups: 6.5
    ["8+", "1"], ["10", "1"], ["3+", "3"], ["2", "3"], ["1", "4"], ["0-1", "4"], ["4-6", "2"], ["7-9", "1"],
  ])("%s → tier %s", (input, tier) => {
    expect(deriveTierFromExperience(input)).toBe(tier);
  });
});

describe("resolveSkillName", () => {
  it("matches case-insensitively and trimmed, returning the JD's own casing", () => {
    expect(resolveSkillName("  spring boot ", skills)).toBe("Spring Boot");
  });
  it("nulls anything not on the JD — never stores free text (acceptance #4)", () => {
    expect(resolveSkillName("Kubernetes", skills)).toBeNull();
    expect(resolveSkillName("Spring", skills)).toBeNull();
  });
  it("nulls when there is no skill list or no raw value", () => {
    expect(resolveSkillName("Java", [])).toBeNull();
    expect(resolveSkillName(null, skills)).toBeNull();
    expect(resolveSkillName(undefined, skills)).toBeNull();
  });
});

describe("dedupeWithinSlots", () => {
  it("drops exact (case/trim-insensitive) repeats within a slot, first wins", () => {
    const out = dedupeWithinSlots([
      { section: "definitions", difficulty: "basic", question: "What is a JVM?", id: 1 },
      { section: "definitions", difficulty: "basic", question: "  what is a jvm?  ", id: 2 },
      { section: "definitions", difficulty: "medium", question: "What is a JVM?", id: 3 },
    ]);
    expect(out.map((q) => q.id)).toEqual([1, 3]);
  });
  it("does not fuzzy-match near duplicates", () => {
    const out = dedupeWithinSlots([
      { section: "scenarios", difficulty: "basic", question: "What is a JVM?" },
      { section: "scenarios", difficulty: "basic", question: "What is the JVM?" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("assertSlotCoverage", () => {
  it("accepts a full 108-question set silently", () => {
    expect(fullSet(12)).toHaveLength(TOTAL_TARGET);
    expect(assertSlotCoverage(fullSet(12))).toEqual([]);
  });
  it("warns (does not throw) for thin slots of 1-7", () => {
    const isCodingAdvanced = (q: { section: string; difficulty: string }) => q.section === "coding" && q.difficulty === "advanced";
    const thin = [...fullSet(12).filter((q) => !isCodingAdvanced(q)), ...fullSet(12).filter(isCodingAdvanced).slice(0, 3)];
    expect(assertSlotCoverage(thin)).toEqual(["coding/advanced=3"]);
  });
  it("throws a GeminiError with the exact message for empty slots", () => {
    const missing = fullSet(12).filter((q) => q.section !== "coding" || q.difficulty === "basic");
    expect(() => assertSlotCoverage(missing)).toThrow(GeminiError);
    expect(() => assertSlotCoverage(missing)).toThrow(
      "Gemini's response left 2 slot(s) with zero questions (coding/medium, coding/advanced) — try generating again.");
  });
});

describe("postProcess", () => {
  it("resolves skills, then dedupes, then asserts coverage", () => {
    const raw = [...fullSet(12), { section: "definitions" as const, difficulty: "basic" as const, question: "definitions basic q0", skill: "Rust" }];
    const out = postProcess(raw, skills);
    expect(out).toHaveLength(108);
    expect(out.every((q) => q.skill === "Java")).toBe(true);
  });
});

describe("prompt fidelity against PRD Appendix A", () => {
  it("A.1 JD extraction prompt is verbatim", () => {
    expect(JD_EXTRACTION_PROMPT).toBe(prdCodeBlock("## A.1 JD extraction"));
  });

  it("A.2 interpolation helpers are verbatim", () => {
    const source = squash(fs.readFileSync(path.resolve(__dirname, "../src/services/questionGen.ts"), "utf-8"));
    const helpers = prdCodeBlock("## A.2 Question generation", 0);
    for (const fn of helpers.split(/\n(?=function )/)) expect(source).toContain(squash(fn));
  });

  it("A.2 prompt template is verbatim", () => {
    const template = prdCodeBlock("## A.2 Question generation", 1);
    for (const ctx of [
      { jdTitle: "Senior Java Dev", cluster: "Java", skills, experienceYears: "5-8", tier: "2" },
      { jdTitle: null, cluster: "QA", skills: [], experienceYears: null, tier: "4" },
    ]) {
      const prompt = buildGenerationPrompt(ctx);
      // Rebuild the expected prompt from the PRD template using the prompt's own interpolated pieces.
      const [head] = template.split("${contextLine(ctx)}");
      expect(prompt.startsWith(head)).toBe(true);
      expect(prompt).toContain("For EACH of the 9 slots, generate exactly 12 DIFFERENT questions — 108 questions total.");
      const tail = template.slice(template.indexOf("Return ONLY JSON"));
      expect(prompt.endsWith(tail)).toBe(true);
    }
  });
});
