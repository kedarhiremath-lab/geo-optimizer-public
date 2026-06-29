// Skills-interview traceability — answers feedback #2 (CEO skill integration).
//
// For every interview lens (the CEO "Thesis & Differentiation" lens included),
// this records: the context the author supplied, and whether that context landed
// in the optimized article. It makes the rewrite auditable: what guidance was
// used, what it became, and what was left out. Deterministic — no LLM call.

import { INTERVIEW_LENSES, type InterviewAnswers } from "./interview.js";
import type { InterviewTraceItem, InterviewTraceLens } from "./types.js";

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "is", "are", "in", "on", "with",
  "that", "this", "your", "you", "it", "as", "be", "by", "at", "from", "into", "what",
  "how", "do", "i", "we", "our", "their", "they", "should", "would", "could", "more",
]);

function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/** Share of the answer's content words that appear in the optimized article. */
function overlapRatio(haystack: string, answer: string): number {
  const words = contentWords(answer);
  if (!words.length) return 0;
  const hay = haystack.toLowerCase();
  const uniq = [...new Set(words)];
  const hits = uniq.filter((w) => hay.includes(w)).length;
  return hits / uniq.length;
}

// Some answers describe DIRECTION (what to cut, where readers drop off, tone,
// reading level, constraints) — these steer the rewrite but can't be verified by
// text presence, so we label them "directional" rather than guessing yes/no.
const DIRECTIONAL_IDS = new Set([
  "ceo_cut",
  "design_order",
  "design_first",
  "dx_dropoff",
  "dx_level",
  "dx_payoff",
  "spec_constraints",
]);

/**
 * Build the per-lens traceability from the author's answers and the optimized
 * article text. Lenses the author didn't answer are returned with used=false so
 * the UI can show "this lens was not used this run".
 */
export function traceInterview(answers: InterviewAnswers | undefined, optimizedText: string): InterviewTraceLens[] {
  const a = answers ?? {};
  return INTERVIEW_LENSES.map((lens) => {
    const items: InterviewTraceItem[] = lens.questions
      .map((q): InterviewTraceItem | null => {
        const answer = (a[q.id] ?? "").trim();
        if (!answer) return null;
        if (DIRECTIONAL_IDS.has(q.id)) {
          return {
            q: q.q,
            answer,
            applied: "directional",
            note: "Editorial direction — steered the rewrite; not verifiable by text presence.",
          };
        }
        const r = overlapRatio(optimizedText, answer);
        const applied = r >= 0.6 ? "yes" : r >= 0.3 ? "partial" : "no";
        const note =
          applied === "yes"
            ? "Key terms from your answer appear in the optimized article."
            : applied === "partial"
              ? "Partially reflected — some key terms appear; consider strengthening."
              : "Not detected in the output — add it manually or re-run with this emphasized.";
        return { q: q.q, answer, applied, note };
      })
      .filter((x): x is InterviewTraceItem => x !== null);
    return { skill: lens.skill, label: lens.label, intent: lens.intent, used: items.length > 0, items };
  });
}
