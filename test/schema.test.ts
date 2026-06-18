import { describe, it, expect } from "vitest";
import { buildJsonLd } from "../src/schema.js";
import type { Article } from "../src/types.js";

function article(over: Partial<Article>): Article {
  return {
    url: "https://www.trossenrobotics.com/post/x",
    title: "The Physical AI Deployment Blueprint",
    text: "body",
    content: "body",
    headings: ["a", "b", "c"],
    links: [],
    existingJsonLd: [],
    meta: {},
    publishedTime: "2025-01-01T00:00:00Z",
    byline: "Trossen Robotics",
    ...over,
  };
}

describe("buildJsonLd", () => {
  it("emits valid TechArticle (not FAQPage) with required fields", () => {
    const { jsonLd, valid } = buildJsonLd(article({}));
    expect(jsonLd["@type"]).toBe("TechArticle");
    expect(valid).toBe(true);
    expect(jsonLd).toHaveProperty("headline");
    expect(jsonLd).toHaveProperty("datePublished");
  });

  it("marks invalid + notes when datePublished is missing (no guessing)", () => {
    const { valid, notes } = buildJsonLd(article({ publishedTime: undefined }));
    expect(valid).toBe(false);
    expect(notes.join(" ")).toMatch(/datePublished/);
  });

  it("flags a conflict when the page already has Article/BlogPosting JSON-LD (Wix)", () => {
    const { notes } = buildJsonLd(article({ existingJsonLd: [{ "@type": "BlogPosting" }] }));
    expect(notes.join(" ")).toMatch(/already has/i);
  });
});
