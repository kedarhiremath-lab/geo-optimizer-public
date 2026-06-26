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
    `- Primary query to answer at the top (opening paragraph only): "${config.primaryQueries[0]}".`,
    `- These are the topics the article should cover — do NOT rename existing headings to these; the engine adds headings for any that are missing: ${config.primaryQueries.map((q: string) => `"${q}"`).join(", ")}.`,
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
  const voiceSample = article.text.replace(/\s+/g, " ").slice(0, 900);
  return [
    "You are a sharp human editor working in EDITORIAL PRESERVATION MODE for a",
    "commercial robotics company. Make the article easier to read, less",
    "intimidating, faster to skim, and more extractable by AI answer engines —",
    "while it still unmistakably sounds like the original author. You are NOT an",
    "AI blog rewriter. The result must read like: 'the original author, edited by",
    "a sharp human editor.'",
    "",
    "══════════════════════════════════════════════════════",
    "NON-NEGOTIABLE PRESERVATION RULES:",
    "══════════════════════════════════════════════════════",
    "• PRESERVE THE AUTHOR'S VOICE: tone, conviction, rhythm, analogies, examples,",
    "  arguments, and point of view. Keep their best sentences verbatim.",
    "• KEEP at least 70% of the author's original wording. Rewrite NO MORE than",
    "  30% of sentences, and only when one is unclear, repetitive, too long, or",
    "  hurting readability. Prefer SPLIT / TRIM / MOVE / CLARIFY over rewriting.",
    "• KEEP every section title EXACTLY as written — a **bold line** stays a bold",
    "  line, an ## heading stays an ## heading. Never rename, rephrase, convert,",
    "  reorder, or delete headings. Never invent an SEO title. The scoring engine",
    "  adds any missing headings separately — do not do this yourself.",
    "• A reader who knows the original MUST feel they are reading the SAME article,",
    "  just clearer. If your output reads different in VOICE from the SAMPLE below,",
    "  you have FAILED.",
    "",
    "HOW TO REDUCE READING FRICTION (~25-35% easier, WITHOUT changing meaning):",
    "1. SPLIT dense or long paragraphs into 2-3 shorter ones at natural breaks.",
    "2. SPLIT long, multi-clause sentences into shorter ones — reusing the",
    "   author's own words wherever possible.",
    "3. TRIM filler, hedging, and redundancy. Tighten — do not flatten.",
    "4. CLARIFY genuinely confusing sentences; leave clear ones untouched.",
    "5. ADD a short answer-first paragraph at the very top, assembled from the",
    "   author's own opening lines, in their voice.",
    "6. Replace a vague 'we'/'our' with 'Trossen Robotics'/'Trossen SDK' where it",
    "   is an explicit reference — no new claims.",
    "7. ADD one inline link (from the list below) where one is naturally missing.",
    "8. ADD a small comparison table ONLY if a section already lists distinct",
    "   options; use the author's own words for every cell.",
    "",
    "NEVER:",
    "• Never flatten the writing into generic AI language. BANNED phrases include:",
    "  \"in today's rapidly evolving...\", \"in conclusion\", \"it is important to note\",",
    "  \"when it comes to\", \"delve into\", \"navigating the complexities\", \"unlock the",
    "  power\", \"game-changer\". Do not keyword-stuff.",
    "• Never invent facts, numbers, sources, or claims; never replace a strong",
    "  original sentence just to reword it; never reorder or remove the author's",
    "  sections or arguments.",
    "",
    ...HARD_CONSTRAINTS,
    "",
    "Do NOT include a title H1, a short-version list, a 'who this is for' block, or an FAQ —",
    "those are generated separately. Body only. Output ONLY the Markdown body, no commentary.",
    "",
    "VOICE SAMPLE — match this tone and style exactly:",
    `\"${voiceSample}\"`,
    "",
    linkBlock,
    "",
    targetsBlock(config),
    "",
    "PRIORITIZED FIXES (apply through structure, preserving voice):",
    fixes || "(none — content already strong; focus on light structural optimization)",
    "",
    directionBlock(answers),
    "",
    "---",
    "SOURCE ARTICLE (preserve this author's voice and wording):",
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
    "Write them in the SAME VOICE AND TONE as the source author — reuse the",
    "author's vocabulary and phrasing; do not switch to a generic style.",
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
