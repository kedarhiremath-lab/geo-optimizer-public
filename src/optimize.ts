// Pipeline orchestrator: ties together fetch -> extract -> score -> rewrite ->
// claim-diff guardrail -> JSON-LD. This is the reusable engine (validated on the
// Blueprint post for M1, but config-driven so it generalizes).

import { fetchRendered, type FetchOptions } from "./fetch.js";
import { extractArticle } from "./extract.js";
import { scoreOriginal, buildFixList } from "./score.js";
import { completeLong } from "./llm.js";
import { rewritePrompt } from "./prompts.js";
import { claimDiff } from "./claimDiff.js";
import { buildJsonLd } from "./schema.js";
import { TROSSEN_BLUEPRINT_CONFIG } from "./config.js";
import type { LlmProvider, OptimizeResult, OptimizerConfig } from "./types.js";

export interface OptimizeOptions extends FetchOptions {
  config?: OptimizerConfig;
}

export async function optimize(
  url: string,
  provider: LlmProvider,
  opts: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const config = opts.config ?? TROSSEN_BLUEPRINT_CONFIG;

  const page = await fetchRendered(url, opts);
  const article = extractArticle(page);

  const scored = scoreOriginal(article, config);
  const fixList = buildFixList(scored);

  const rewrittenDraft = (
    await completeLong(provider, rewritePrompt(article, config, fixList), article.content)
  ).trim();

  const diff = await claimDiff(provider, article.text, rewrittenDraft);
  const { jsonLd, valid, notes } = buildJsonLd(article);

  return {
    url,
    baselineScore: scored.baselineScore,
    fixList,
    rewrittenDraft,
    jsonLd,
    jsonLdValid: valid,
    jsonLdNotes: notes,
    claimDiff: diff,
    safe: diff.passed && valid,
  };
}
