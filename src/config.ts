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

/** Extraction fail-loud thresholds (from eng review). */
export const EXTRACTION_THRESHOLDS = {
  minBodyWordRatio: 0.6, // extracted text >= 60% of visible body word count
  minHeadings: 3,
};
