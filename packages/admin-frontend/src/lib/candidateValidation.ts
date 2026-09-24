// Client-side validation for candidate import — runs entirely in the browser before anything is sent.

export interface ImportRow {
  rowIndex: number;
  email: string; // the candidate record ID
  name: string;
  refId: string;
  skillCluster: string;
  tier: string;
  jdReference: string;
}

export interface ValidatedRow extends ImportRow {
  errors: string[];
  warnings: string[];
}

export const REQUIRED_COLUMNS = ["Name", "Email", "Skill Cluster", "Tier", "JD Reference"];
export const OPTIONAL_COLUMNS = ["Reference ID"];

// Headers from the earlier "employee" template are still accepted.
const COLUMN_ALIASES: Record<string, string[]> = {
  Name: ["Name", "Emp Name", "Candidate Name"],
  Email: ["Email", "Emp Email", "Candidate Email"],
  "Reference ID": ["Reference ID", "Emp ID", "Employee ID", "Candidate ID"],
  "Skill Cluster": ["Skill Cluster"],
  Tier: ["Tier"],
  "JD Reference": ["JD Reference"],
};

const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const normalizeCluster = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which required columns a sheet's headers are missing (aliases count). */
export function missingColumns(headers: string[]): string[] {
  const have = new Set(headers.map((h) => h.trim().toLowerCase()));
  return REQUIRED_COLUMNS.filter((c) => !COLUMN_ALIASES[c].some((a) => have.has(a.toLowerCase())));
}

export function rowFromSheet(rowNumber: number, v: Record<string, string>): ImportRow {
  const get = (column: string) => {
    for (const alias of COLUMN_ALIASES[column]) {
      const key = Object.keys(v).find((k) => k.trim().toLowerCase() === alias.toLowerCase());
      if (key && (v[key] ?? "").trim()) return v[key].trim();
    }
    return "";
  };
  return {
    rowIndex: rowNumber,
    email: get("Email").toLowerCase(),
    name: get("Name"),
    refId: get("Reference ID"),
    skillCluster: get("Skill Cluster"),
    tier: get("Tier"),
    jdReference: get("JD Reference"),
  };
}

export function validateRows(rows: ImportRow[], jdTitles: string[], knownClusters: string[]): ValidatedRow[] {
  const firstRowForEmail = new Map<string, number>();
  const titlesLower = jdTitles.map((t) => t.toLowerCase());
  // Every spelling of each normalized cluster seen (in the file and on existing JDs).
  const spellings = new Map<string, Set<string>>();
  for (const c of [...knownClusters, ...rows.map((r) => r.skillCluster)]) {
    if (!c) continue;
    const key = normalizeCluster(c);
    if (!spellings.has(key)) spellings.set(key, new Set());
    spellings.get(key)!.add(c);
  }

  return rows.map((r) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!r.name) errors.push("Name is required");
    if (!r.email) errors.push("Email is required");
    else if (!EMAIL_RE.test(r.email)) errors.push("Email doesn't look valid");
    if (!r.skillCluster) errors.push("Skill Cluster is required");

    if (r.email) {
      const first = firstRowForEmail.get(r.email);
      if (first !== undefined) errors.push(`Duplicate email — already used on row ${first}`);
      else firstRowForEmail.set(r.email, r.rowIndex);
    }

    if (r.skillCluster) {
      const variants = [...(spellings.get(normalizeCluster(r.skillCluster)) ?? [])].filter((s) => s !== r.skillCluster);
      if (variants.length) warnings.push(`Near-duplicate cluster spelling: "${r.skillCluster}" vs "${variants.join('", "')}"`);
    }
    if (!r.tier) warnings.push("Tier missing — will default to tier 4");
    else if (!["1", "2", "3", "4"].includes(r.tier)) warnings.push(`Tier "${r.tier}" isn't 1–4`);

    if (!r.jdReference) {
      warnings.push("No JD Reference — candidate will be cluster-only, no JD-specific questions");
    } else if (!titlesLower.includes(r.jdReference.toLowerCase())) {
      const ref = r.jdReference.toLowerCase();
      const near = jdTitles.find((t) => t.toLowerCase().includes(ref) || ref.includes(t.toLowerCase()));
      warnings.push(near
        ? `JD Reference "${r.jdReference}" doesn't exactly match a JD — did you mean "${near}"? As written it will be cluster-only.`
        : `JD Reference "${r.jdReference}" matches no JD — candidate will be cluster-only`);
    }

    return { ...r, errors, warnings };
  });
}
