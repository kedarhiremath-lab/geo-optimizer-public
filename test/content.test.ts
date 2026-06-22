import { describe, it, expect } from "vitest";
import { parseOptimizedMeta, assembleContent, composeArticle, ContentParseError } from "../src/content.js";

const goodMeta = JSON.stringify({
  shortVersion: ["Pick a narrow task", "Define success metrics"],
  whoThisIsFor: ["Ops leaders", "R&D teams"],
  faq: [{ q: "When is a demo ready?", a: "When it does useful work." }, { q: "", a: "drop me" }],
  metadata: { title: "T", metaDescription: "D", slug: "s", tags: ["a", "b"], socialCopy: "S", imageAltText: [] },
  assetRecommendations: ["Convert the scorecard to an HTML table"],
});

describe("parseOptimizedMeta", () => {
  it("parses the structured fields", () => {
    const m = parseOptimizedMeta(goodMeta);
    expect(m.shortVersion.length).toBe(2);
    expect(m.whoThisIsFor).toContain("Ops leaders");
    expect(m.faq.length).toBe(1); // empty-q entry dropped
    expect(m.metadata.title).toBe("T");
    expect(m.assetRecommendations.length).toBe(1);
  });

  it("tolerates ```json fences", () => {
    expect(parseOptimizedMeta("```json\n" + goodMeta + "\n```").metadata.slug).toBe("s");
  });

  it("throws on non-JSON", () => {
    expect(() => parseOptimizedMeta("not json at all")).toThrow(ContentParseError);
  });

  it("fills safe defaults for missing fields", () => {
    const m = parseOptimizedMeta(JSON.stringify({ shortVersion: ["x"] }));
    expect(m.faq).toEqual([]);
    expect(m.metadata.title).toBe("");
  });
});

describe("assembleContent + composeArticle", () => {
  it("combines body + meta and assembles the full article", () => {
    const meta = parseOptimizedMeta(goodMeta);
    const content = assembleContent("## How do I move a robotics pilot to production\n\nStart narrow.", meta);
    expect(content.articleMarkdown).toContain("Start narrow");
    const full = composeArticle(content, "My Title");
    expect(full).toContain("# My Title");
    expect(full).toContain("## The Short Version");
    expect(full).toContain("## Who this is for");
    expect(full).toContain("## Frequently Asked Questions");
    expect(full).toContain("When is a demo ready?");
  });
});
