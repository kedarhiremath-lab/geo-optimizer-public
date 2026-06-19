// Pipeline orchestrator: ties together fetch -> extract -> score -> rewrite ->
// claim-diff guardrail -> JSON-LD. This is the reusable engine (validated on the
// Blueprint post for M1, but config-driven so it generalizes).

import { fetchRendered, type FetchOptions } from "./fetch.js";
import { extractArticle } from "./extract.js";
import { scoreOriginal, buildFixList, scoreDraft } from "./score.js";
import { completeLong } from "./llm.js";
import { rewritePrompt } from "./prompts.js";
import { claimDiff } from "./claimDiff.js";
import { buildJsonLd } from "./schema.js";
import { TROSSEN_BLUEPRINT_CONFIG } from "./config.js";
import type { LlmProvider, OptimizeResult, OptimizerConfig } from "./types.js";
import type { InterviewAnswers } from "./interview.js";

export interface OptimizeOptions extends FetchOptions {
  config?: OptimizerConfig;
  /** Answers from the skills interview, woven into the rewrite as editorial direction. */
  answers?: InterviewAnswers;
}

export interface AnalyzeResult {
  url: string;
  title: string;
  baselineScore: number;
  fixList: ReturnType<typeof buildFixList>;
}

/**
 * Step 1 (no LLM, no quota): fetch + extract + score the original. Used by the
 * UI to show the baseline and the skills interview before the author commits a
 * rewrite call.
 */
export async function analyze(url: string, opts: OptimizeOptions = {}): Promise<AnalyzeResult> {
  const config = opts.config ?? TROSSEN_BLUEPRINT_CONFIG;
  const page = await fetchRendered(url, opts);
  const article = extractArticle(page);
  const scored = scoreOriginal(article, config);
  return { url, title: article.title, baselineScore: scored.baselineScore, fixList: buildFixList(scored) };
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
    await completeLong(provider, rewritePrompt(article, config, fixList, opts.answers), article.content)
  ).trim();

  const diff = await claimDiff(provider, article.text, rewrittenDraft);
  const { jsonLd, valid, notes } = buildJsonLd(article);
  const optimizedScore = scoreDraft(rewrittenDraft, article, config);

  return {
    url,
    baselineScore: scored.baselineScore,
    optimizedScore,
    fixList,
    rewrittenDraft,
    jsonLd,
    jsonLdValid: valid,
    jsonLdNotes: notes,
    claimDiff: diff,
    safe: diff.passed && valid,
  };
}
