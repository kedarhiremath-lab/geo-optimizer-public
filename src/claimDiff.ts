// T6 — Fact-preservation guardrail (eng review #2, top reputational risk).
//
// We extract atomic factual claims from the source and from the rewrite, then
// flag any claim the rewrite added that the source doesn't support. An added
// factual claim = FAIL (the optimizer must not invent stats on a commercial page).
//
// Claim extraction uses the LLM; matching is deterministic so the gate itself
// is testable. Placeholders the rewrite prompt is allowed to emit
// (e.g. "[ADD STAT: ...]") are explicitly NOT treated as added facts.

import type { ClaimDiffResult, LlmProvider } from "./types.js";
import { claimExtractionPrompt } from "./prompts.js";

function parseClaims(raw: string): string[] {
  // Model may wrap the array in code fences or prose; extract the JSON array.
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9%. ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Content-word token set for loose claim matching. */
function tokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

/** A rewrite claim is "supported" if a source claim shares >= 70% of its tokens. */
/**
 * A rewrite claim is "supported" when most of its content words appear in the
 * SOURCE TEXT itself. Matching against the raw source (not a lossy re-extraction
 * of source claims) is what keeps false positives down: a claim that's faithfully
 * carried over will have its content words present in the source.
 */
function isSupportedByText(rewriteClaim: string, sourceTokenSet: Set<string>): boolean {
  const rt = tokens(rewriteClaim);
  if (rt.size === 0) return true;
  let overlap = 0;
  for (const t of rt) if (sourceTokenSet.has(t)) overlap++;
  // 0.8: a genuinely new fact introduces multiple content words absent from the
  // source; a rephrased existing claim shares almost all of its words.
  return overlap / rt.size >= 0.8;
}

const PLACEHOLDER = /\[ADD [^\]]*\]/i;
// Page chrome Readability sometimes leaks in (Wix meta). Not article claims.
const CHROME = /^\s*(\d+\s*min read|jun|jan|feb|mar|apr|may|jul|aug|sep|oct|nov|dec)\b/i;

export async function claimDiff(
  provider: LlmProvider,
  sourceText: string,
  rewriteText: string,
): Promise<ClaimDiffResult> {
  // Only extract claims from the REWRITE; check each against the source text.
  // (One LLM call instead of two, and far fewer false positives.)
  const rewriteRaw = await provider.complete(claimExtractionPrompt(rewriteText));
  const rewriteClaims = parseClaims(rewriteRaw);
  const sourceTokenSet = tokens(sourceText);

  const added = rewriteClaims.filter(
    (c) => !PLACEHOLDER.test(c) && !CHROME.test(c) && !isSupportedByText(c, sourceTokenSet),
  );

  return { added, passed: added.length === 0 };
}

// Exposed for unit testing the deterministic matcher without an LLM call.
export const _internal = { parseClaims, isSupportedByText, tokens };
