// Pipeline orchestrator: ties together fetch -> extract -> score -> rewrite ->
// claim-diff guardrail -> JSON-LD. This is the reusable engine (validated on the
// Blueprint post for M1, but config-driven so it generalizes).

import { fetchRendered, type FetchOptions } from "./fetch.js";
import { extractArticle } from "./extract.js";
import { scoreOriginal, buildFixList, scoreDraft } from "./score.js";
import { articleBodyPrompt, structuredMetaPrompt } from "./prompts.js";
import { claimDiff } from "./claimDiff.js";
import { buildSchemas } from "./schema.js";
import { parseOptimizedMeta, assembleContent, composeArticle } from "./content.js";
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

/** Strip a leading/trailing ```markdown or ``` fence if the model wrapped the body. */
function stripCodeFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/);
  return (m ? m[1] : t).trim();
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

  // Two calls (reliability): the article BODY as plain Markdown, then the small
  // structured fields as JSON. Embedding the big article in JSON intermittently
  // broke parsing (unescaped quotes/newlines), so we keep them separate.
  const bodyRaw = await provider.complete(articleBodyPrompt(article, config, fixList, opts.answers));
  const articleBody = stripCodeFences(bodyRaw);
  const metaRaw = await provider.complete(structuredMetaPrompt(article, config, opts.answers), { json: true });
  const content = assembleContent(articleBody, parseOptimizedMeta(metaRaw));

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
