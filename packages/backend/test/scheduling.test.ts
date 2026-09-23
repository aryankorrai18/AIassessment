import { describe, expect, it, vi } from "vitest";
import { generateAccessKey } from "../src/lib/accessKey";

// The candidates router imports Firestore at module load; stub it so pure helpers can be tested offline.
vi.mock("../src/config/firebase", () => ({ db: {}, firestoreMode: "test" }));
const { highestInterviewStatus, topSkills } = await import("../src/routes/admin/candidates");

describe("generateAccessKey", () => {
  it("is 12 chars from the 32-char alphabet with no I, O, 0 or 1", () => {
    for (let i = 0; i < 500; i++) expect(generateAccessKey()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  });

  it("uses the whole alphabet and does not repeat", () => {
    const keys = Array.from({ length: 2000 }, generateAccessKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys.join("")).size).toBe(32);
  });
});

describe("highestInterviewStatus", () => {
  it("ranks ACTIVE > PENDING > COMPLETED > NO_SHOW > EXPIRED", () => {
    expect(highestInterviewStatus(["COMPLETED", "PENDING"])).toBe("PENDING");
    expect(highestInterviewStatus(["NO_SHOW", "EXPIRED"])).toBe("NO_SHOW");
    expect(highestInterviewStatus(["PENDING", "ACTIVE", "COMPLETED"])).toBe("ACTIVE");
    expect(highestInterviewStatus(["COMPLETED", "NO_SHOW"])).toBe("COMPLETED");
    expect(highestInterviewStatus(["EXPIRED"])).toBe("EXPIRED");
  });
  it("is null for a candidate with no interviews", () => {
    expect(highestInterviewStatus([])).toBeNull();
  });
});

describe("topSkills", () => {
  it("caps a matched candidate's skills to the top 5 by weight, descending", () => {
    const skills = [
      { skill: "A", expectedLevel: "L1" as const, weight: 3 },
      { skill: "B", expectedLevel: "L3" as const, weight: 10 },
      { skill: "C", expectedLevel: "L2" as const, weight: 6 },
      { skill: "D", expectedLevel: "L2" as const, weight: 7 },
      { skill: "E", expectedLevel: "L1" as const, weight: 2 },
      { skill: "F", expectedLevel: "L3" as const, weight: 9 },
    ];
    expect(topSkills(skills)).toEqual(["B", "F", "D", "C", "A"]);
  });
});
