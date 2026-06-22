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
const HARD_CONSTRAINTS = [
  "HARD CONSTRAINTS — violating any is a failure:",
  "1. DO NOT invent or add any fact, statistic, number, date, quote, or citation",
  "   not present in the source. Rephrase/restructure freely; never fabricate.",
  "2. If the source lacks a stat the optimization wants, use a placeholder like",
  "   [ADD STAT: source needed] — never invent one.",
  "3. Preserve the company's claims and meaning.",
];

function targetsBlock(config: OptimizerConfig): string {
  return [
    "OPTIMIZATION TARGETS:",
    `- Primary query to answer first: "${config.primaryQueries[0]}".`,
    `- Use these target queries verbatim as ## headings where they fit: ${config.primaryQueries
      .map((q: string) => `"${q}"`)
      .join(", ")}.`,
    `- Name these entities explicitly near relevant claims: ${config.entities.join(", ")}.`,
    "- Surface concrete numbers already in the source as citable stats.",
  ].join("\n");
}

function directionBlock(answers?: InterviewAnswers): string {
  const direction = answers ? formatAnswers(answers) : "";
  return direction
    ? "AUTHOR'S EDITORIAL DIRECTION (highest priority after the hard constraints —\nhonor these about audience, thesis, structure, requirements):\n" + direction
    : "";
}

/**
 * Call 1 — the optimized article BODY as plain Markdown (no JSON). Generating
 * free-text markdown outside of JSON avoids the escaping failures that broke a
 * single combined JSON call. Restructures for scannability + extractability,
 * with question-shaped headings and comparison tables where useful.
 */
export function articleBodyPrompt(
  article: Article,
  config: OptimizerConfig,
  fixList: FixItem[],
  answers?: InterviewAnswers,
): string {
  const fixes = fixList.map((f, i) => `${i + 1}. ${f.label}: ${f.recommendation}`).join("\n");
  const internal = article.links.filter((l) => /trossenrobotics\.com/i.test(l)).slice(0, 4);
  const external = article.links.filter((l) => !/trossenrobotics\.com/i.test(l)).slice(0, 6);
  const linkBlock =
    article.links.length > 0
      ? [
          "LINKS AVAILABLE FROM THE SOURCE (use real ones only — do NOT invent URLs):",
          internal.length ? `- Internal (Trossen): ${internal.join(", ")}` : "- Internal: (none found — link to https://www.trossenrobotics.com where natural)",
          external.length ? `- External: ${external.join(", ")}` : "- External: (none found)",
        ].join("\n")
      : "LINKS: none in source — link to https://www.trossenrobotics.com and cite any source named in the text.";
  return [
    "You are a GEO/SEO optimization engine for a commercial robotics company. You",
    "restructure content to be scannable, evidence-rich, and extractable by AI",
    "answer engines, while preserving meaning. This is a real rewrite, not a light edit.",
    "",
    ...HARD_CONSTRAINTS,
    "",
    "Write the optimized article BODY in Markdown. To score well it MUST hit ALL of these:",
    "1. Open with a direct, answer-first paragraph (2-4 sentences) that answers the primary",
    "   query in the first lines — before any background.",
    "2. Use EACH primary target query verbatim as a question-shaped ## heading.",
    "3. Name the entities (Trossen Robotics, Trossen SDK) explicitly near relevant claims,",
    "   not 'we/our' — multiple times across the article.",
    "4. Surface AT LEAST 3 concrete, citable numbers that are ALREADY in the source.",
    "5. Include AT LEAST ONE internal Trossen link AND ONE external authoritative link, as",
    "   inline Markdown links, using the real URLs listed below (never invent URLs).",
    "6. Include at least one comparison table (Markdown table), e.g. 'Demo vs. Minimum Viable",
    "   Deployment vs. Production'.",
    "7. Short, scannable paragraphs and answer blocks.",
    "Do NOT include a title H1, a short-version list, a 'who this is for' block, or an FAQ —",
    "those are generated separately. Body only. Output ONLY the Markdown body, no commentary.",
    "",
    linkBlock,
    "",
    targetsBlock(config),
    "",
    "PRIORITIZED FIXES TO APPLY:",
    fixes || "(none — content already strong; focus on structure and extractability)",
    "",
    directionBlock(answers),
    "",
    "---",
    "SOURCE ARTICLE:",
    article.content,
  ].join("\n");
}

/**
 * Call 2 — the small structured fields as JSON (Short Version, audience, FAQ,
 * metadata, asset recs). Small JSON with short string values is reliable; the
 * big free-text article is generated separately by articleBodyPrompt.
 */
export function structuredMetaPrompt(
  article: Article,
  config: OptimizerConfig,
  answers?: InterviewAnswers,
): string {
  return [
    "You are a GEO/SEO optimization engine for a commercial robotics company.",
    "From the source article below, produce the supporting optimization assets.",
    "",
    ...HARD_CONSTRAINTS,
    "",
    "Return ONLY a JSON object with EXACTLY these fields (keep every string short;",
    "no markdown, no newlines inside string values):",
    "{",
    '  "shortVersion": [string],   // 5-7 concrete, actionable steps. Imperative voice. NOT a generic summary.',
    '  "whoThisIsFor": [string],   // 3-6 short audience descriptors (roles/teams)',
    '  "faq": [{"q": string, "a": string}],  // 5-7 FAQ entries, answers grounded in the article (1-3 sentences each)',
    '  "metadata": {',
    '     "title": string,           // <title>, query-aligned, <= 60 chars',
    '     "metaDescription": string, // 150-160 chars',
    '     "slug": string,            // lowercase-hyphenated url slug',
    '     "tags": [string],          // 4-8 topical tags',
    '     "socialCopy": string,      // 1-2 sentence social/preview copy',
    '     "imageAltText": [string]   // alt text for key images (empty array if none)',
    "  },",
    '  "assetRecommendations": [string]  // convert important visuals to machine-readable HTML tables; downloadable lead-gen assets where appropriate',
    "}",
    "",
    targetsBlock(config),
    "",
    directionBlock(answers),
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
