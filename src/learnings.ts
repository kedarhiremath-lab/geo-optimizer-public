// Feedback #7 — "learn from your edits": a persistent HOUSE STYLE profile.
//
// The app accumulates durable Trossen preferences (tone rules, standard CTAs,
// target keywords, things to avoid) from the user's own inputs and corrections,
// and injects them into every future rewrite. This is real, low-cost learning:
// the optimizer gets smarter at Trossen's voice over time — no model training.
//
// NOTE: stored on disk (cache/learnings.json). On an ephemeral host (Render free
// tier) this resets on restart; durable persistence needs a persistent disk/DB,
// which ties to the hosting decision.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "cache");
const FILE = join(DIR, "learnings.json");
const MAX = 60;

export function getLearnings(): string[] {
  try {
    if (!existsSync(FILE)) return [];
    const v = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(list: string[]): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(list.slice(-MAX), null, 2));
  } catch {
    /* best-effort; non-fatal */
  }
}

/** Add lessons (deduped, case-insensitive). Returns the updated list. */
export function addLearnings(items: string[]): string[] {
  const cur = getLearnings();
  const seen = new Set(cur.map((s) => s.toLowerCase().trim()));
  for (const it of items) {
    const t = (it || "").trim();
    if (t && t.length <= 280 && !seen.has(t.toLowerCase())) {
      cur.push(t);
      seen.add(t.toLowerCase());
    }
  }
  save(cur);
  return cur;
}

export function clearLearnings(): void {
  save([]);
}

/** The prompt block injected into every rewrite so learnings are applied. */
export function learningsBlock(): string {
  const l = getLearnings();
  if (!l.length) return "";
  return (
    "LEARNED HOUSE STYLE — apply these Trossen preferences (from past edits) unless\n" +
    "the article's own facts/voice contradict them:\n" +
    l.map((x) => `- ${x}`).join("\n")
  );
}
