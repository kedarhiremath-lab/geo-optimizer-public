import { describe, it, expect } from "vitest";
import { parseOptimizedContent, composeArticle, ContentParseError } from "../src/content.js";

const good = JSON.stringify({
  shortVersion: ["Pick a narrow task", "Define success metrics"],
  whoThisIsFor: ["Ops leaders", "R&D teams"],
  articleMarkdown: "## How do I move a robotics pilot to production\n\nStart narrow.",
  faq: [{ q: "When is a demo ready?", a: "When it does useful work." }, { q: "", a: "drop me" }],
  metadata: { title: "T", metaDescription: "D", slug: "s", tags: ["a", "b"], socialCopy: "S", imageAltText: [] },
  assetRecommendations: ["Convert the scorecard to an HTML table"],
});

describe("parseOptimizedContent", () => {
  it("parses a clean JSON object", () => {
    const c = parseOptimizedContent(good);
    expect(c.shortVersion.length).toBe(2);
    expect(c.whoThisIsFor).toContain("Ops leaders");
    expect(c.faq.length).toBe(1); // the empty-q entry is dropped
    expect(c.metadata.title).toBe("T");
    expect(c.assetRecommendations.length).toBe(1);
  });

  it("tolerates ```json fences", () => {
    const c = parseOptimizedContent("```json\n" + good + "\n```");
    expect(c.metadata.slug).toBe("s");
  });

  it("throws when articleMarkdown is missing", () => {
    expect(() => parseOptimizedContent(JSON.stringify({ shortVersion: [] }))).toThrow(ContentParseError);
  });

  it("throws on non-JSON", () => {
    expect(() => parseOptimizedContent("not json at all")).toThrow(ContentParseError);
  });
});

describe("composeArticle", () => {
  it("assembles title + short version + audience + body + FAQ", () => {
    const c = parseOptimizedContent(good);
    const full = composeArticle(c, "My Title");
    expect(full).toContain("# My Title");
    expect(full).toContain("## The Short Version");
    expect(full).toContain("## Who this is for");
    expect(full).toContain("## Frequently Asked Questions");
    expect(full).toContain("When is a demo ready?");
  });
});
