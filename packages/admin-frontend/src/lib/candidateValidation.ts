// Client-side validation for candidate import — runs entirely in the browser before anything is sent.

export interface ImportRow {
  rowIndex: number;
  empId: string;
  empName: string;
  empEmail: string;
  skillCluster: string;
  tier: string;
  jdReference: string;
}

export interface ValidatedRow extends ImportRow {
  errors: string[];
  warnings: string[];
}

export const REQUIRED_COLUMNS = ["Emp ID", "Emp Name", "Emp Email", "Skill Cluster", "Tier", "JD Reference"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeCluster = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function rowFromSheet(rowNumber: number, v: Record<string, string>): ImportRow {
  const get = (name: string) => {
    const key = Object.keys(v).find((k) => k.trim().toLowerCase() === name.toLowerCase());
    return key ? (v[key] ?? "").trim() : "";
  };
  return {
    rowIndex: rowNumber,
    empId: get("Emp ID"),
    empName: get("Emp Name"),
    empEmail: get("Emp Email"),
    skillCluster: get("Skill Cluster"),
    tier: get("Tier"),
    jdReference: get("JD Reference"),
  };
}

export function validateRows(rows: ImportRow[], jdTitles: string[], knownClusters: string[]): ValidatedRow[] {
  const firstRowForId = new Map<string, number>();
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

    if (!r.empId) errors.push("Emp ID is required");
    else if (r.empId.includes("/")) errors.push('Emp ID must not contain a "/" character');
    if (!r.empName) errors.push("Emp Name is required");
    if (!r.empEmail) errors.push("Emp Email is required");
    else if (!EMAIL_RE.test(r.empEmail)) errors.push("Emp Email doesn't look valid");
    if (!r.skillCluster) errors.push("Skill Cluster is required");

    if (r.empId) {
      const id = r.empId.toUpperCase(); // stored uppercase server-side
      const first = firstRowForId.get(id);
      if (first !== undefined) errors.push(`Duplicate Emp ID — already used on row ${first}`);
      else firstRowForId.set(id, r.rowIndex);
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
