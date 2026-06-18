// Frozen prompt set + checklist (single source of truth, from the design doc).
// Config-driven so the engine generalizes to other posts/sites later (M3).

import type { OptimizerConfig } from "./types.js";

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
