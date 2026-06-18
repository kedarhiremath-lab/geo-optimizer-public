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
function isSupported(rewriteClaim: string, sourceClaims: string[]): boolean {
  const rt = tokens(rewriteClaim);
  if (rt.size === 0) return true;
  for (const sc of sourceClaims) {
    const st = tokens(sc);
    let overlap = 0;
    for (const t of rt) if (st.has(t)) overlap++;
    if (overlap / rt.size >= 0.7) return true;
  }
  return false;
}

const PLACEHOLDER = /\[ADD [^\]]*\]/i;

export async function claimDiff(
  provider: LlmProvider,
  sourceText: string,
  rewriteText: string,
): Promise<ClaimDiffResult> {
  const [sourceRaw, rewriteRaw] = await Promise.all([
    provider.complete(claimExtractionPrompt(sourceText)),
    provider.complete(claimExtractionPrompt(rewriteText)),
  ]);
  const sourceClaims = parseClaims(sourceRaw);
  const rewriteClaims = parseClaims(rewriteRaw);

  const added = rewriteClaims.filter(
    (c) => !PLACEHOLDER.test(c) && !isSupported(c, sourceClaims),
  );

  return { added, passed: added.length === 0 };
}

// Exposed for unit testing the deterministic matcher without an LLM call.
export const _internal = { parseClaims, isSupported, tokens };
