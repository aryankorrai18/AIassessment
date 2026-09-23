import fs from "node:fs";
import path from "node:path";

const PRD = fs.readFileSync(path.resolve(__dirname, "../../../PRD.md"), "utf-8").replace(/\r\n/g, "\n");

/** Returns the Nth fenced code block (0-based) found after `heading` in PRD.md. */
export function prdCodeBlock(heading: string, nth = 0): string {
  const start = PRD.indexOf(heading);
  if (start < 0) throw new Error(`Heading not found in PRD: ${heading}`);
  const blocks = [...PRD.slice(start).matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)];
  return blocks[nth][1];
}

export const squash = (s: string) => s.replace(/\s+/g, " ").trim();
