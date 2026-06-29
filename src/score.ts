// T4 — Score the ORIGINAL post against the GEO/SEO checklist.
//
// The fix-list is the ranked gap between the original and the target (eng
// review #5: you can't prioritize fixes without first measuring the before-state).
// Scoring is deterministic (no LLM) so it's cheap, testable, and stable.

import type { Article, ChecklistFinding, FixItem, OptimizerConfig, ScoredArticle, ScoreSignal, ScoreExplanation } from "./types.js";

/** Loose containment check, case-insensitive, whitespace-normalized. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreOriginal(article: Article, config: OptimizerConfig): ScoredArticle {
  const findings: ChecklistFinding[] = [];
  const firstScreen = article.text.slice(0, 800); // ~answer-first region
  const headingsNorm = article.headings.map(normalize);

  // 1. Answer-first TL;DR near the top — does the opening directly answer a primary query topic?
  const opensWithAnswer =
    /^(to |the |a |in short|tl;dr|summary|moving|deploying|commercializing)/i.test(
      article.text.trimStart().slice(0, 40),
    ) && config.primaryQueries.some((q: string) => topicOverlap(firstScreen, q));
  findings.push({
    id: "tldr",
    label: "Answer-first TL;DR in the opening",
    score: opensWithAnswer ? 2 : topicOverlap(firstScreen, config.primaryQueries[0]) ? 1 : 0,
    evidence: firstScreen.slice(0, 120) + "…",
    weight: 5,
  });

  // 2. Question-shaped H2s matching primary queries.
  const matchedQueries = config.primaryQueries.filter((q: string) =>
    headingsNorm.some((h) => topicOverlap(h, q)),
  );
  findings.push({
    id: "question-headings",
    label: "Headings phrased as target queries",
    score: matchedQueries.length >= 2 ? 2 : matchedQueries.length === 1 ? 1 : 0,
    evidence: `${matchedQueries.length}/${config.primaryQueries.length} primary queries appear in headings`,
    weight: 5,
  });

  // 3. Explicit entity naming.
  const namedEntities = config.entities.filter((e: string) => contains(article.text, e));
  findings.push({
    id: "entities",
    label: "Explicit entity naming (brand + product)",
    score: namedEntities.length === config.entities.length ? 2 : namedEntities.length > 0 ? 1 : 0,
    evidence: `named: ${namedEntities.join(", ") || "none"}`,
    weight: 4,
  });

  // 4. Citable stats (numbers/percentages present as evidence).
  const stats = countStats(article.text);
  findings.push({
    id: "stats",
    label: "Citable stats / concrete numbers",
    score: stats.length >= 3 ? 2 : stats.length >= 1 ? 1 : 0,
    evidence: `${stats.length} stat-like mentions`,
    weight: 3,
  });

  // 5. Internal + external links.
  const internal = article.links.filter((l) => contains(l, "trossenrobotics.com"));
  const external = article.links.filter((l) => !contains(l, "trossenrobotics.com"));
  findings.push({
    id: "links",
    label: "Internal + external links",
    score: internal.length >= 1 && external.length >= 1 ? 2 : article.links.length >= 1 ? 1 : 0,
    evidence: `${internal.length} internal, ${external.length} external`,
    weight: 2,
  });

  // 6. Meta title + description.
  const hasTitle = !!article.meta.title;
  const hasDesc = !!article.meta.description;
  findings.push({
    id: "meta",
    label: "Meta title + description present",
    score: hasTitle && hasDesc ? 2 : hasTitle || hasDesc ? 1 : 0,
    evidence: `title:${hasTitle ? "yes" : "no"} description:${hasDesc ? "yes" : "no"}`,
    weight: 2,
  });

  // findings drive the fix-list; the SCORE uses the richer granular rubric below
  // (same rubric for baseline and optimized, so the before->after delta is honest).
  const baselineScore = scoreGranular(article, config, {});

  return { article, findings, baselineScore };
}

/** Count citable stats — numbers with a unit/context that reads as evidence. */
export function countStats(text: string): string[] {
  const re = /\b\d+(?:[.,]\d+)?\s?(?:%|percent|x|million|billion|k\b|hours?|days?|weeks?|months?|years?|minutes?|seconds?|questions?|steps?|categories|categor(?:y|ies)|stages?|phases?|levels?|points?|teams?|robots?|tasks?)\b/gi;
  return text.match(re) ?? [];
}

/** Signals that aren't derivable from the article markdown alone (set for the optimized result). */
export interface ScoreExtras {
  faqCount?: number;
  schemaCount?: number;
  whoCount?: number;
  shortCount?: number;
}

/**
 * Compute the per-signal GEO/SEO breakdown. This is the single source of truth
 * for the score: scoreGranular sums it, and explainScore narrates it. Every
 * signal is a concrete, on-page SEO/GEO structure (NOT an LLM opinion).
 */
export function scoreSignals(article: Article, config: OptimizerConfig, extras: ScoreExtras): ScoreSignal[] {
  const text = article.text;
  const firstScreen = text.slice(0, 800);
  const headingsNorm = article.headings.map(normalize);

  const leadOk =
    /^(to |the |a |in short|tl;dr|short version|summary|moving|deploying|commercializing)/i.test(text.trimStart().slice(0, 40)) &&
    config.primaryQueries.some((q) => topicOverlap(firstScreen, q));
  const matched = config.primaryQueries.filter((q) => headingsNorm.some((h) => topicOverlap(h, q)));
  const named = config.entities.filter((e) => contains(text, e));
  const stats = countStats(text).length;
  const internal = article.links.filter((l) => contains(l, "trossenrobotics.com")).length;
  const external = article.links.filter((l) => !contains(l, "trossenrobotics.com")).length;
  const hasTable = /\n\|.*\|.*\n\|[\s:-]*\|/.test(article.content);
  const faq = extras.faqCount ?? 0;
  const schema = extras.schemaCount ?? 0;
  const who = (extras.whoCount ?? 0) >= 1;
  const short = (extras.shortCount ?? 0) >= 1;
  const metaPts = article.meta.title && article.meta.description ? 6 : article.meta.title || article.meta.description ? 3 : 0;

  return [
    { id: "lead", label: "Answer-first lead", earned: leadOk ? 11 : 0, max: 11, note: leadOk ? "opens with a direct answer" : "no answer-first opening" },
    { id: "headings", label: "Question-shaped headings", earned: Math.min(matched.length, 3) * 6, max: 18, note: `${matched.length} target ${matched.length === 1 ? "query" : "queries"} appear as headings` },
    { id: "entities", label: "Entity naming (brand + product)", earned: Math.min(named.length, 2) * 5, max: 10, note: `named: ${named.join(", ") || "none"}` },
    { id: "stats", label: "Citable stats / numbers", earned: Math.min(stats, 6) * 2, max: 12, note: `${stats} stat-like mentions` },
    { id: "internal", label: "Internal links", earned: Math.min(internal, 2) * 4, max: 8, note: `${internal} Trossen link${internal === 1 ? "" : "s"}` },
    { id: "external", label: "External links", earned: Math.min(external, 2) * 4, max: 8, note: `${external} outbound reference${external === 1 ? "" : "s"}` },
    { id: "meta", label: "Meta title + description", earned: metaPts, max: 6, note: metaPts === 6 ? "both present" : metaPts === 3 ? "one present" : "missing" },
    { id: "table", label: "Comparison table", earned: hasTable ? 5 : 0, max: 5, note: hasTable ? "present" : "none" },
    { id: "faq", label: "FAQ Q&A pairs", earned: Math.min(faq, 5) * 2, max: 10, note: `${faq} FAQ entr${faq === 1 ? "y" : "ies"}` },
    { id: "schema", label: "Structured data (JSON-LD)", earned: Math.min(schema, 6), max: 6, note: `${schema} schema block${schema === 1 ? "" : "s"}` },
    { id: "who", label: "'Who this is for' block", earned: who ? 5 : 0, max: 5, note: who ? "present" : "none" },
    { id: "short", label: "Short Version / TL;DR", earned: short ? 4 : 0, max: 4, note: short ? "present" : "none" },
  ];
}

/**
 * The granular GEO/SEO rubric (0-100, capped). Structural signals (lead, all
 * query headings, entities, links, meta, FAQ, schema, who, short version) form a
 * floor; count-based signals (extra stats / links / FAQ / schema) add the rest,
 * so a fully-structured article lands in the 90s and varies with richness.
 */
export function scoreGranular(article: Article, config: OptimizerConfig, extras: ScoreExtras): number {
  const pts = scoreSignals(article, config, extras).reduce((n, s) => n + s.earned, 0);
  return Math.min(100, Math.round(pts));
}

/** How to close the gap on each signal (shown in the score explainer). */
const SIGNAL_HOWTO: Record<string, string> = {
  lead: "Open with a 2-4 sentence direct answer to the primary query (the engine adds this).",
  headings: "Cover each target query as a section the article actually answers.",
  entities: "Name 'Trossen Robotics' and 'Trossen SDK' explicitly near relevant claims.",
  stats: "Surface more concrete numbers already in the source — this is the biggest source-limited lever.",
  internal: "Add links to other trossenrobotics.com pages.",
  external: "Cite 1-2 authoritative outbound sources already referenced in the text.",
  meta: "Provide a query-aligned title tag + 150-160 char meta description.",
  table: "Add a comparison/summary table where the content lists distinct options.",
  faq: "Add 3-5 grounded FAQ Q&A pairs.",
  schema: "Generate the JSON-LD set (Article, FAQPage, Organization, …).",
  who: "Add a short 'Who this is for' audience block.",
  short: "Add a 'Short Version' / TL;DR list.",
};

/**
 * Explain a score: the per-signal breakdown, what's driving it (maxed signals),
 * and the highest-leverage remaining gains (biggest point gaps + how to close).
 */
export function explainScore(article: Article, config: OptimizerConfig, extras: ScoreExtras): ScoreExplanation {
  const signals = scoreSignals(article, config, extras);
  const total = Math.min(100, Math.round(signals.reduce((n, s) => n + s.earned, 0)));
  const drivers = signals
    .filter((s) => s.earned > 0)
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 5)
    .map((s) => ({ label: s.label, earned: s.earned, max: s.max }));
  const topImprovements = signals
    .filter((s) => s.earned < s.max)
    .sort((a, b) => b.max - b.earned - (a.max - a.earned))
    .slice(0, 4)
    .map((s) => ({ label: s.label, gain: s.max - s.earned, how: SIGNAL_HOWTO[s.id] ?? `Improve: ${s.label}` }));
  // Signals whose ceiling depends on how rich the SOURCE article is.
  const sourceLimited = signals
    .filter((s) => ["stats", "external", "internal"].includes(s.id) && s.earned < s.max)
    .map((s) => s.label);
  return { total, signals, drivers, topImprovements, sourceLimited };
}

/**
 * Build an Article from the rewritten Markdown draft so it can be scored on the
 * same checklist as the original — this is what produces the "after" GEO score.
 * Meta (title/description) is carried from the original because those are page
 * tags, not part of the body rewrite, so the comparison stays apples-to-apples.
 */
export function articleFromMarkdown(md: string, base: Article): Article {
  const headings = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
  const text = md
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  const mdLinks = [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  const bare = md.match(/https?:\/\/[^\s)]+/g) ?? [];
  const links = Array.from(new Set([...mdLinks, ...bare]));
  return { ...base, text, content: md, headings, links };
}

/** Score a plain markdown draft (no structured extras) — used in tests. */
export function scoreDraft(markdown: string, base: Article, config: OptimizerConfig): number {
  return scoreGranular(articleFromMarkdown(markdown, base), config, {});
}

/**
 * Score the full optimized result, crediting the structured pieces (FAQ, schema,
 * audience, short version) that the rich rubric rewards. `base.meta` should carry
 * the GENERATED metadata so the meta signal reflects the optimization.
 */
export function scoreOptimized(
  composedArticle: string,
  base: Article,
  config: OptimizerConfig,
  extras: ScoreExtras,
): number {
  return scoreGranular(articleFromMarkdown(composedArticle, base), config, extras);
}

/** Rank findings into a prioritized fix-list: weak/absent first, weighted by impact. */
export function buildFixList(scored: ScoredArticle): FixItem[] {
  return scored.findings
    .filter((f) => f.score < 2)
    .map((f) => ({
      id: f.id,
      label: f.label,
      recommendation: RECS[f.id] ?? `Improve: ${f.label}`,
      priority: f.weight * (2 - f.score),
    }))
    .sort((a, b) => b.priority - a.priority);
}

const RECS: Record<string, string> = {
  tldr: "Open with a 2-4 sentence direct answer to the primary query before any preamble.",
  "question-headings": "Rephrase section headings as the exact target questions users ask.",
  entities: "Name 'Trossen Robotics' and 'Trossen SDK' explicitly near relevant claims, not 'we/our'.",
  stats: "Add 2-3 concrete, citable numbers already supported by the source material.",
  links: "Add at least one internal Trossen link and one authoritative external reference.",
  meta: "Set a query-aligned meta title and a 150-160 char meta description.",
};

/** Topic overlap: share of needle's content words present in haystack. */
export function topicOverlap(haystack: string, needle: string): boolean {
  const stop = new Set(["how", "do", "i", "a", "to", "the", "or", "of", "for", "is", "what", "in"]);
  const words = normalize(needle)
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w));
  if (words.length === 0) return false;
  const hits = words.filter((w) => haystack.toLowerCase().includes(w)).length;
  return hits / words.length >= 0.6;
}
