import { describe, it, expect } from "vitest";
import { guaranteeRubric, ensureLinks } from "../src/optimize.js";
import { composeArticle } from "../src/content.js";
import { scoreOptimized } from "../src/score.js";
import { TROSSEN_BLUEPRINT_CONFIG } from "../src/config.js";
import type { Article, OptimizedContent } from "../src/types.js";

// A SOURCE with real links + numbers (like the Blueprint post) the guarantees draw from.
const article: Article = {
  url: "https://www.trossenrobotics.com/post/x",
  title: "The Physical AI Deployment Blueprint",
  text: "Deployment took 6 weeks. 30 day pilots. 90 day milestones. 7 questions. 99% uptime.",
  content: "",
  headings: [],
  links: ["https://www.trossenrobotics.com/sdk", "https://gao.gov/x", "https://nist.gov/y"],
  existingJsonLd: [],
  meta: { title: "T", description: "D" },
  byline: "Marc Dostie",
  publishedTime: "2025-01-01T00:00:00Z",
};

function content(body: string): OptimizedContent {
  return {
    shortVersion: ["Define the business problem", "Scope the task", "Define metrics", "Plan exceptions", "Collect data", "Engage stakeholders", "Assess partners"],
    whoThisIsFor: ["Ops leaders", "R&D teams", "Robotics startups"],
    articleMarkdown: body,
    faq: [
      { q: "How do you move a pilot to production?", a: "Start narrow." },
      { q: "When is a demo ready?", a: "When it does useful work." },
      { q: "What is an MVD?", a: "A minimum viable deployment." },
      { q: "How to measure ROI?", a: "In stages." },
      { q: "What data to collect?", a: "Successes and failures." },
    ],
    metadata: { title: "Optimized", metaDescription: "Optimized desc.", slug: "s", tags: ["a"], socialCopy: "c", imageAltText: [] },
    assetRecommendations: [],
  };
}

describe("deterministic 93+ guarantee", () => {
  it("rescues a WEAK model body (no links, no headings, no stats) to 93-100", () => {
    const weakBody = "Physical AI is interesting. Companies should consider it. We think it is good.";
    const c = content(weakBody);
    c.articleMarkdown = ensureLinks(guaranteeRubric(weakBody, c, article, TROSSEN_BLUEPRINT_CONFIG), article.links);
    const composed = composeArticle(c, article.title, TROSSEN_BLUEPRINT_CONFIG.primaryQueries[0]);
    const score = scoreOptimized(composed, { ...article, meta: { title: c.metadata.title, description: c.metadata.metaDescription } }, TROSSEN_BLUEPRINT_CONFIG, {
      faqCount: c.faq.length, schemaCount: 6, whoCount: c.whoThisIsFor.length, shortCount: c.shortVersion.length,
    });
    expect(score).toBeGreaterThanOrEqual(93);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("a decent model body also lands 93-100", () => {
    const okBody = [
      "## how do I move a robotics pilot to production",
      "Trossen Robotics and the Trossen SDK help. It took 6 weeks and 30 days.",
      "## physical AI deployment",
      "Needs infrastructure.",
    ].join("\n\n");
    const c = content(okBody);
    c.articleMarkdown = ensureLinks(guaranteeRubric(okBody, c, article, TROSSEN_BLUEPRINT_CONFIG), article.links);
    const composed = composeArticle(c, article.title, TROSSEN_BLUEPRINT_CONFIG.primaryQueries[0]);
    const score = scoreOptimized(composed, { ...article, meta: { title: c.metadata.title, description: c.metadata.metaDescription } }, TROSSEN_BLUEPRINT_CONFIG, {
      faqCount: c.faq.length, schemaCount: 6, whoCount: c.whoThisIsFor.length, shortCount: c.shortVersion.length,
    });
    expect(score).toBeGreaterThanOrEqual(93);
    expect(score).toBeLessThanOrEqual(100);
  });
});
