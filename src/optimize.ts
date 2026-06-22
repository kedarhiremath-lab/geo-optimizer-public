// Pipeline orchestrator: ties together fetch -> extract -> score -> rewrite ->
// claim-diff guardrail -> JSON-LD. This is the reusable engine (validated on the
// Blueprint post for M1, but config-driven so it generalizes).

import { fetchRendered, type FetchOptions } from "./fetch.js";
import { extractArticle } from "./extract.js";
import { scoreOriginal, buildFixList, scoreDraft } from "./score.js";
import { rewritePrompt } from "./prompts.js";
import { claimDiff } from "./claimDiff.js";
import { buildSchemas } from "./schema.js";
import { parseOptimizedContent, composeArticle } from "./content.js";
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

  // Structured rewrite (single JSON call): produces short version, audience,
  // optimized body with tables, FAQ, metadata, and asset recommendations.
  const raw = await provider.complete(rewritePrompt(article, config, fixList, opts.answers), { json: true });
  const content = parseOptimizedContent(raw);

  // The full publishable article (for scoring, fact-check, and copy).
  const fullArticle = composeArticle(content, article.title);

  const diff = await claimDiff(provider, article.text, fullArticle);
  const { schemas, notes, articleValid } = buildSchemas(article, content);
  const optimizedScore = scoreDraft(fullArticle, article, config);

  return {
    url,
    baselineScore: scored.baselineScore,
    optimizedScore,
    fixList,
    rewrittenDraft: fullArticle,
    content,
    schemas,
    schemaNotes: notes,
    claimDiff: diff,
    safe: diff.passed && articleValid,
  };
}
