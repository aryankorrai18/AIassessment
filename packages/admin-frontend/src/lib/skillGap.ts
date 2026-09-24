import type { ResultRow } from "./types";

const LEVEL_VALUE: Record<string, number> = { "Not Awarded": 0, L1: 1, L2: 2, L3: 3 };

export interface SkillGapSummaryRow {
  jd: string;
  skill: string;
  expectedLevel: string;
  met: number;
  total: number;
  pctMet: number;
  avgDemonstrated: number;
}

/** One attempt per (candidate, JD): the most recent one that has a scored skill gap. */
export function latestScoredAttempts(rows: ResultRow[]): ResultRow[] {
  const latest = new Map<string, ResultRow>();
  for (const r of rows) {
    if (r.reportStatus !== "COMPLETED" || !r.jdTitle || r.skillGap.length === 0) continue;
    const key = `${r.email}::${r.jdTitle}`;
    const prev = latest.get(key);
    if (!prev || (r.completedAt ?? 0) > (prev.completedAt ?? 0)) latest.set(key, r);
  }
  return [...latest.values()];
}

/** Per JD + skill. "Not Assessed" rows are excluded entirely — a timing artifact, not a real gap. Weakest first. */
export function summarizeSkillGaps(rows: ResultRow[]): SkillGapSummaryRow[] {
  const acc = new Map<string, SkillGapSummaryRow & { sum: number }>();
  for (const r of latestScoredAttempts(rows)) {
    for (const g of r.skillGap) {
      if (g.demonstratedLevel === "Not Assessed") continue;
      const key = `${r.jdTitle}::${g.skill}`;
      const cur = acc.get(key) ?? { jd: r.jdTitle!, skill: g.skill, expectedLevel: g.expectedLevel, met: 0, total: 0, pctMet: 0, avgDemonstrated: 0, sum: 0 };
      cur.total++;
      if (g.met) cur.met++;
      cur.sum += LEVEL_VALUE[g.demonstratedLevel] ?? 0;
      acc.set(key, cur);
    }
  }
  return [...acc.values()]
    .map(({ sum, ...r }) => ({ ...r, pctMet: Math.round((r.met / r.total) * 100), avgDemonstrated: sum / r.total }))
    .sort((a, b) => a.pctMet - b.pctMet || a.avgDemonstrated - b.avgDemonstrated);
}
