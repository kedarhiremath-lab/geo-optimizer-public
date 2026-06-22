// LLM prompt templates. Kept separate so prompt changes are reviewable and
// eval-able (a prompt tweak that degrades output is a silent regression — the
// eval harness in eval/run.ts guards against it).

import type { Article, FixItem, OptimizerConfig } from "./types.js";
import { formatAnswers, type InterviewAnswers } from "./interview.js";

/**
 * Rewrite prompt. The fact-preservation constraint is the reputational
 * guardrail (eng review #2): the model MUST NOT introduce any claim, statistic,
 * or citation that is not present in the source. This is on a commercial page.
 *
 * If the author answered the skills interview, their direction is woven in as
 * the highest-priority editorial guidance (subordinate only to fact-preservation).
 */
export function rewritePrompt(
  article: Article,
  config: OptimizerConfig,
  fixList: FixItem[],
  answers?: InterviewAnswers,
): string {
  const fixes = fixList.map((f, i) => `${i + 1}. ${f.label}: ${f.recommendation}`).join("\n");
  const direction = answers ? formatAnswers(answers) : "";
  return structuredRewritePrompt(article, config, fixes, direction);
}

/**
 * Phase 1 structured rewrite. Returns JSON (the provider is called in JSON mode)
 * with the full optimization output: an actionable Short Version, a "Who this is
 * for" block, the optimized body (with comparison tables + answer blocks where
 * useful), an FAQ, SEO/GEO metadata, and asset recommendations.
 */
function structuredRewritePrompt(article: Article, config: OptimizerConfig, fixes: string, direction: string): string {
  return [
    "You are a GEO/SEO optimization engine for a commercial robotics company. You",
    "do not just lightly edit — you restructure content to be more scannable,",
    "evidence-rich, and extractable by AI answer engines, while preserving meaning.",
    "",
    "HARD CONSTRAINTS — violating any is a failure:",
    "1. DO NOT invent or add any fact, statistic, number, date, quote, or citation",
    "   not present in the source. Rephrase/restructure freely; never fabricate.",
    "2. If the source lacks a stat the optimization wants, use a placeholder like",
    "   [ADD STAT: source needed] — never invent one.",
    "3. Preserve the company's claims and meaning.",
    "",
    "Return ONLY a JSON object with EXACTLY these fields:",
    "{",
    '  "shortVersion": [string],   // 5-7 concrete, actionable steps a reader can act on. NOT a generic summary. Imperative voice.',
    '  "whoThisIsFor": [string],   // 3-6 short audience descriptors (roles/teams this article serves)',
    '  "articleMarkdown": string,  // the optimized BODY in Markdown: question-shaped ## headings matching the target queries, short paragraphs, and AT LEAST ONE comparison table (Markdown table) where the content supports it (e.g. a Demo vs. Minimum Viable Deployment vs. Production table). Use answer blocks. Do NOT include the short version, who-this-is-for, or FAQ here — those are separate fields.',
    '  "faq": [{"q": string, "a": string}],  // 5-7 FAQ entries answering the real questions readers ask, grounded in the article',
    '  "metadata": {',
    '     "title": string,           // <title>, query-aligned, <= 60 chars',
    '     "metaDescription": string, // 150-160 chars',
    '     "slug": string,            // lowercase-hyphenated url slug',
    '     "tags": [string],          // 4-8 topical tags',
    '     "socialCopy": string,      // 1-2 sentence social/preview copy',
    '     "imageAltText": [string]   // suggested alt text for key images (empty array if none)',
    "  },",
    '  "assetRecommendations": [string]  // recommendations to convert important visuals into machine-readable HTML tables, and downloadable lead-gen assets where appropriate',
    "}",
    "",
    "OPTIMIZATION TARGETS:",
    `- Primary query to answer first: "${config.primaryQueries[0]}".`,
    `- Use these target queries verbatim as ## headings where they fit: ${config.primaryQueries
      .map((q: string) => `"${q}"`)
      .join(", ")}.`,
    `- Name these entities explicitly near relevant claims: ${config.entities.join(", ")}.`,
    "- Surface concrete numbers already in the source as citable stats.",
    "",
    "PRIORITIZED FIXES TO APPLY:",
    fixes || "(none — content already strong; focus on structure and extractability)",
    "",
    direction
      ? "AUTHOR'S EDITORIAL DIRECTION (highest priority after the hard constraints —\nhonor these about audience, thesis, structure, requirements):\n" + direction
      : "",
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
