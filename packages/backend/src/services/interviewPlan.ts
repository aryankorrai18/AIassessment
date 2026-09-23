import { questionBankCol } from "../lib/collections";
import type { QuestionDifficulty, QuestionSection } from "../types/domain";
import type { CandidateProfile, InterviewQuestion, SectionPlan } from "../types/interviewState";

export const SECTION_ORDER: QuestionSection[] = ["definitions", "scenarios", "coding"];
const DIFFICULTY_ORDER: QuestionDifficulty[] = ["basic", "medium", "advanced"];

export const SECTION_TARGETS: Record<QuestionSection, { coding: number; nonCoding: number }> = {
  definitions: { coding: 8, nonCoding: 10 },
  scenarios: { coding: 15, nonCoding: 20 },
  coding: { coding: 3, nonCoding: 0 }, // unreachable placeholder — non-coding plans drop the section
};

export class QuestionBankEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionBankEmptyError";
  }
}

/** A bank question as fetched for one section (the full pool is kept for coverage repair). */
export interface PoolQuestion { id: string; section: QuestionSection; difficulty: QuestionDifficulty; prompt: string; skill: string | null }

/** Remainder front-loads onto the easiest bands. */
export function splitAcrossDifficulties(total: number): number[] {
  const base = Math.floor(total / 3);
  const remainder = total % 3;
  return DIFFICULTY_ORDER.map((_, i) => base + (i < remainder ? 1 : 0));
}

/** Without replacement. Math.random() is fine here (access keys use the CSPRNG). */
export function pickRandomN<T>(items: T[], n: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

export function sectionsFor(hasCoding: boolean): QuestionSection[] {
  return SECTION_ORDER.filter((s) => (hasCoding ? SECTION_TARGETS[s].coding : SECTION_TARGETS[s].nonCoding) > 0);
}

/** Draws one section's questions, ordered basic → medium → advanced, index 1-based and contiguous. */
export function drawSection(section: QuestionSection, pool: PoolQuestion[], target: number): SectionPlan {
  const picked: InterviewQuestion[] = [];
  const perBand = splitAcrossDifficulties(target);
  DIFFICULTY_ORDER.forEach((difficulty, i) => {
    // A short bucket simply contributes fewer questions — not an error.
    for (const q of pickRandomN(pool.filter((p) => p.difficulty === difficulty), perBand[i])) {
      picked.push({ id: q.id, section, index: picked.length + 1, prompt: q.prompt, skill: q.skill });
    }
  });
  return { section, totalQuestions: picked.length, questions: picked };
}

/**
 * Single-pass greedy repair: every skill present anywhere in the bank should appear at
 * least once in the plan. Swaps in place (count and index never change), one swap per
 * uncovered skill, and a skill that can't be swapped in stays uncovered — deliberately,
 * no backtracking.
 */
export function repairSkillCoverage(plan: SectionPlan[], pools: Map<QuestionSection, PoolQuestion[]>): SectionPlan[] {
  const bankSkills: string[] = [];
  for (const section of SECTION_ORDER) {
    for (const q of pools.get(section) ?? []) if (q.skill && !bankSkills.includes(q.skill)) bankSkills.push(q.skill);
  }

  const skillCount = () => {
    const counts = new Map<string, number>();
    for (const sp of plan) for (const q of sp.questions) if (q.skill) counts.set(q.skill, (counts.get(q.skill) ?? 0) + 1);
    return counts;
  };

  for (const skill of bankSkills) {
    if (skillCount().has(skill)) continue;
    const pickedIds = new Set(plan.flatMap((sp) => sp.questions.map((q) => q.id)));
    for (const sp of plan) {
      if (sp.questions.length === 0) continue;
      const candidate = (pools.get(sp.section) ?? []).find((q) => q.skill === skill && !pickedIds.has(q.id));
      if (!candidate) continue;
      const counts = skillCount();
      let evictAt = sp.questions.findIndex((q) => q.skill !== null && (counts.get(q.skill) ?? 0) >= 2);
      if (evictAt < 0) evictAt = sp.questions.length - 1;
      const evicted = sp.questions[evictAt];
      sp.questions[evictAt] = { id: candidate.id, section: sp.section, index: evicted.index, prompt: candidate.prompt, skill: candidate.skill };
      break;
    }
  }
  return plan;
}

async function fetchPool(section: QuestionSection, jdRef: string | null, cluster: string): Promise<PoolQuestion[]> {
  const query = jdRef
    ? questionBankCol().where("jdRef", "==", jdRef).where("section", "==", section)
    : questionBankCol().where("jdRef", "==", null).where("cluster", "==", cluster).where("section", "==", section);
  const snap = await query.get();
  return snap.docs.map((d) => {
    const q = d.data();
    return { id: d.id, section, difficulty: q.difficulty, prompt: q.question, skill: q.skill ?? null };
  });
}

export async function buildPlan(profile: CandidateProfile): Promise<SectionPlan[]> {
  const sections = sectionsFor(profile.hasCoding);
  const pools = new Map<QuestionSection, PoolQuestion[]>();
  await Promise.all(sections.map(async (s) => pools.set(s, await fetchPool(s, profile.jdRef, profile.cluster))));

  const drawn = sections.map((section) => {
    const target = profile.hasCoding ? SECTION_TARGETS[section].coding : SECTION_TARGETS[section].nonCoding;
    return drawSection(section, pools.get(section) ?? [], target);
  });
  const plan = repairSkillCoverage(drawn, pools).filter((sp) => sp.questions.length > 0);

  if (plan.length === 0) {
    throw new QuestionBankEmptyError(profile.jdRef
      ? `No questions have been generated yet for this candidate's JD (${profile.jdRef}).`
      : `No generic questions have been generated yet for the "${profile.cluster}" cluster.`);
  }
  return plan;
}
