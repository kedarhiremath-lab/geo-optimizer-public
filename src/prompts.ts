// LLM prompt templates. Kept separate so prompt changes are reviewable and
// eval-able (a prompt tweak that degrades output is a silent regression — the
// eval harness in eval/run.ts guards against it).

import type { Article, FixItem, OptimizerConfig } from "./types.js";

/**
 * Rewrite prompt. The fact-preservation constraint is the reputational
 * guardrail (eng review #2): the model MUST NOT introduce any claim, statistic,
 * or citation that is not present in the source. This is on a commercial page.
 */
export function rewritePrompt(article: Article, config: OptimizerConfig, fixList: FixItem[]): string {
  const fixes = fixList.map((f, i) => `${i + 1}. ${f.label}: ${f.recommendation}`).join("\n");
  return [
    "You are a GEO/SEO content optimizer for a commercial robotics company.",
    "Rewrite the article below to improve how it ranks in search engines AND how AI assistants",
    "(ChatGPT, Claude, Gemini, Perplexity) cite it.",
    "",
    "HARD CONSTRAINTS — violating any of these is a failure:",
    "1. DO NOT invent or add any fact, statistic, number, date, quote, or citation that is not",
    "   already present in the source. You may rephrase and restructure; you may NOT fabricate.",
    "2. If the source lacks a stat the optimization would want, leave a bracketed placeholder",
    "   like [ADD STAT: source needed] instead of inventing one.",
    "3. Preserve the author's claims and meaning. Do not change what the company asserts.",
    "",
    "OPTIMIZATION TARGETS:",
    `- Open with a 2-4 sentence answer-first summary addressing: "${config.primaryQueries[0]}".`,
    `- Use these target queries verbatim as section headings (##) where they fit: ${config.primaryQueries
      .map((q: string) => `"${q}"`)
      .join(", ")}.`,
    `- Name these entities explicitly near relevant claims: ${config.entities.join(", ")}.`,
    "- Keep concrete numbers already in the source; surface them as citable stats.",
    "",
    "PRIORITIZED FIXES TO APPLY:",
    fixes || "(none — content already strong; focus on structure)",
    "",
    "Output ONLY the rewritten article in Markdown (headings, paragraphs, lists). No commentary.",
    "",
    "---",
    "SOURCE ARTICLE:",
    article.content,
  ].join("\n");
}

/**
 * Claim-extraction prompt for the fact-preservation guardrail. We extract
 * atomic factual claims (statistics, named facts) so claimDiff can compare
 * source vs rewrite and flag anything the rewrite added.
 */
export function claimExtractionPrompt(text: string): string {
  return [
    "Extract every ATOMIC FACTUAL CLAIM from the text below: statistics, numbers, dates,",
    "named capabilities, comparisons, and specific assertions of fact. Ignore opinions,",
    "transitions, and generic marketing language.",
    "",
    "Output a JSON array of short claim strings, one per claim. Example:",
    '["Trossen SDK supports ROS 2", "deployment takes 6 weeks", "10x faster than X"]',
    "Output ONLY the JSON array, nothing else.",
    "",
    "---",
    "TEXT:",
    text,
  ].join("\n");
}
