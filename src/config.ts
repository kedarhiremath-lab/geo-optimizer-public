// Frozen prompt set + checklist (single source of truth, from the design doc).
// Config-driven so the engine generalizes to other posts/sites later (M3).

import type { Article, OptimizerConfig } from "./types.js";

/** Default config tuned for the Trossen "Physical AI Deployment Blueprint" post. */
export const TROSSEN_BLUEPRINT_CONFIG: OptimizerConfig = {
  entities: ["Trossen Robotics", "Trossen SDK"],
  primaryQueries: [
    "how do I move a robotics pilot to production",
    "physical AI deployment",
    "how do I commercialize a robotics or physical AI application",
  ],
  secondaryQueries: [
    "robotics deployment challenges",
    "pilot to production robotics",
    "robot training data infrastructure",
    "physical AI data collection",
    "scaling robotics deployments",
    "commercial robotics deployment",
  ],
  geoPanel: [
    "How do I move a robotics pilot into commercial deployment?",
    "What infrastructure is required for Physical AI?",
    "What companies help with robot training data collection?",
    "What are the biggest challenges scaling Physical AI?",
    "How do I commercialize a robotics application?",
  ],
};

/**
 * Build a PER-ARTICLE config. The primary/target queries are derived from THIS
 * article's own title and headings instead of the fixed blueprint queries — so an
 * off-topic query (e.g. "how do I move a robotics pilot to production") never
 * bleeds into an unrelated post. This fixes both the off-topic FAQ/headings the
 * model was generating AND the score (the rubric was checking for a query the
 * article never set out to answer). Brand entities and the GEO panel stay fixed.
 */
export function deriveConfig(article: Article, base: OptimizerConfig = TROSSEN_BLUEPRINT_CONFIG): OptimizerConfig {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  // Core topic from the title: drop a trailing subtitle (after : – — |) and any
  // announce-y prefix, leaving the real subject (e.g. "Trossen Docs MCP Server").
  const titleCore = clean(
    (article.title || "")
      .split(/[:–—|]/)[0]
      .replace(/^(introducing|introduction to|meet|announcing|a guide to)\s+/i, "")
      .replace(/^(the|a|an)\s+/i, ""),
  );
  // Secondary target topics: the article's own substantive headings (2–9 words).
  const headingQueries = (article.headings || [])
    .map(clean)
    .filter((h) => {
      const n = h.split(/\s+/).length;
      return n >= 2 && n <= 9 && h.length <= 80;
    });

  const seen = new Set<string>();
  const primaryQueries = [titleCore, ...headingQueries]
    .filter((q) => q && q.length >= 3)
    .filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3);

  return { ...base, primaryQueries: primaryQueries.length ? primaryQueries : base.primaryQueries };
}

// Extraction fail-loud thresholds (from eng review).
//
// NOTE: the original "extracted >= 60% of full body text" ratio is wrong for
// CMS pages like Wix, where nav/footer/related-posts/comments dominate
// body.textContent — a correctly-extracted article is often only ~30% of it.
// So we guard on (a) an ABSOLUTE article floor (did we get a real article?)
// and (b) a CATASTROPHIC ratio floor (Readability returned almost nothing),
// plus headings preserved. This catches real extraction failure without
// false-failing on chrome-heavy pages.
export const EXTRACTION_THRESHOLDS = {
  minExtractedWords: 250, // a real article has at least this much body
  catastrophicRatio: 0.05, // < 5% of body text means extraction basically failed
  minHeadings: 3,
};
