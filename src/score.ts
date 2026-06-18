// T4 — Score the ORIGINAL post against the GEO/SEO checklist.
//
// The fix-list is the ranked gap between the original and the target (eng
// review #5: you can't prioritize fixes without first measuring the before-state).
// Scoring is deterministic (no LLM) so it's cheap, testable, and stable.

import type { Article, ChecklistFinding, FixItem, OptimizerConfig, ScoredArticle } from "./types.js";

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
  const stats = article.text.match(/\b\d+(\.\d+)?\s?(%|percent|x|million|billion|hours?|days?)\b/gi) ?? [];
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

  const maxPossible = findings.reduce((s, f) => s + f.weight * 2, 0);
  const earned = findings.reduce((s, f) => s + f.weight * f.score, 0);
  const baselineScore = Math.round((earned / maxPossible) * 100);

  return { article, findings, baselineScore };
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

/** Score the optimized draft (0-100) so the UI can show baseline -> optimized. */
export function scoreDraft(markdown: string, base: Article, config: OptimizerConfig): number {
  return scoreOriginal(articleFromMarkdown(markdown, base), config).baselineScore;
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
function topicOverlap(haystack: string, needle: string): boolean {
  const stop = new Set(["how", "do", "i", "a", "to", "the", "or", "of", "for", "is", "what", "in"]);
  const words = normalize(needle)
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w));
  if (words.length === 0) return false;
  const hits = words.filter((w) => haystack.toLowerCase().includes(w)).length;
  return hits / words.length >= 0.6;
}
