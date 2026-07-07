// LLM prompt templates. Kept separate so prompt changes are reviewable and
// eval-able (a prompt tweak that degrades output is a silent regression — the
// eval harness in eval/run.ts guards against it).

import type { Article, FixItem, OptimizerConfig } from "./types.js";
import { formatAnswers, INTERVIEW_LENSES, type InterviewAnswers } from "./interview.js";
import { learningsBlock } from "./learnings.js";

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
    `- Cover these topics; where a section maps to one, you MAY shape its heading toward the query (a natural, honest question is ideal for GEO): ${config.primaryQueries.map((q: string) => `"${q}"`).join(", ")}. The engine still adds a heading for any topic left uncovered.`,
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
    "• OPTIMIZE SUBHEADINGS FOR GEO — this is encouraged, not forbidden. You MAY",
    "  rewrite a section heading to be clearer, more specific, and aligned with how",
    "  people actually search — including phrasing it as a QUESTION when that reads",
    "  naturally and helps AI answer engines surface the section. But: keep it in",
    "  the author's voice, keep it honest to the section's real content, and NEVER",
    "  keyword-stuff (no clumsy prefixes like 'ROS 2 for Robot Learning: …' bolted",
    "  onto an existing heading). Keep a **bold line** bold and an ## heading an ##",
    "  heading. Do NOT drop, silently merge away, or reorder the author's sections —",
    "  every original section must still be present; you may improve its heading, not",
    "  remove its content. Do NOT add an H1/title in the body — the headline is",
    "  generated separately.",
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
    "",
    "STRUCTURE TO ADD WHEN IT GENUINELY HELPS (real restructuring, not just light edits —",
    "this makes the page more evidence-rich and extractable by AI engines, in the author's words):",
    "A. ANSWER BLOCK: under a section that answers a key question, lead with a 1-2 sentence",
    "   DIRECT answer (bold it), then the author's existing explanation beneath it.",
    "B. COMPARISON: where the article weighs options, approaches, or before/after states,",
    "   add a small Markdown comparison TABLE (or a tightly structured comparison block)",
    "   using ONLY the author's own facts and wording — no invented rows or numbers.",
    "C. SCANNABLE LISTS: convert a dense in-prose enumeration (\"first… second… third…\")",
    "   into a bullet or numbered list, keeping the exact wording.",
    "D. Keep every such addition grounded in content already present — restructure and",
    "   surface what the author wrote; never fabricate to fill a table or list.",
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
    learningsBlock(),
    "",
    "---",
    "SOURCE ARTICLE (preserve this author's voice and wording):",
    article.content,
  ].join("\n");
}

/**
 * Pre-fill the skills interview (feedback #3): draft a concise suggested answer
 * for every interview question, grounded only in the article, so the user edits
 * instead of writing from scratch. Returns JSON {questionId: answer}.
 */
export function interviewSuggestionsPrompt(article: Article): string {
  const lines = INTERVIEW_LENSES.flatMap((l) => l.questions.map((q) => `- ${q.id}: ${q.q}`));
  return [
    "Pre-fill a short editorial interview about the SOURCE ARTICLE below. For each",
    "question id, draft a concise, specific suggested answer (ONE sentence, <= 160",
    "characters) grounded ONLY in the article. These are starting points the user edits —",
    "be concrete and useful, never generic. Do not invent facts not in the article.",
    "",
    "QUESTIONS (id: question):",
    ...lines,
    "",
    "Return ONLY a JSON object mapping each id to its suggested answer string. No prose, no markdown.",
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
    '     "headline": string,        // the VISIBLE H1 for the article. Optimize it for GEO + clarity: specific, compelling, aligned to the primary query — a natural question is welcome when it fits. Keep the author\'s voice and the core subject; do NOT keyword-stuff. <= 70 chars. This becomes the visible title, so make it strong.',
    '     "title": string,           // SEO <title> tag (can differ from the headline), query-aligned, <= 60 chars',
    '     "metaDescription": string, // 150-160 chars',
    '     "slug": string,            // lowercase-hyphenated url slug',
    '     "tags": [string],          // 4-8 topical tags',
    '     "socialCopy": string,      // 1-2 sentence social/preview copy',
    '     "imageAltText": [string]   // alt text for key images (empty array if none)',
    "  },",
    '  "assetRecommendations": [string],  // convert important visuals to machine-readable HTML tables; downloadable lead-gen assets where appropriate',
    '  "imageSuggestions": [{"section": string, "kind": "image"|"graph", "alt": string, "caption": string, "prompt": string}]',
    "      // 2-4 figures that would help this article. section = an EXACT source heading.",
    "      // kind = 'image' (a photorealistic PHOTO — use this for almost everything) or 'graph'",
    "      //   (a real DATA CHART — ONLY when the section has concrete comparable numbers).",
    "      // alt = concrete machine-readable alt text. caption = a short visible caption; put any",
    "      //   labels or part names HERE (in the caption) — NEVER inside the image.",
    "      // prompt = a vivid, detailed prompt for a REALISTIC PHOTOGRAPH of a real robotics-lab",
    "      //   scene (true materials, natural lighting, real depth of field). CRITICAL: the scene",
    "      //   must contain NO text, words, titles, labels, logos, wordmarks, or readable screens —",
    "      //   image models render all text as garbled nonsense, so describe a purely visual photo.",
    "      //   If a robotic arm appears, describe a matte-black 3D-printed carbon-fiber research arm",
    "      //   with triangular truss/lattice cut-outs, black servo joints, and a black parallel",
    "      //   gripper on a linear rail on a maple workbench — with NO logo or brand text on it.",
    "      // Tie each to a real section and its content; never generic stock-photo ideas.",
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
