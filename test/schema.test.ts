import { describe, it, expect } from "vitest";
import { buildSchemas } from "../src/schema.js";
import type { Article, OptimizedContent } from "../src/types.js";

function article(over: Partial<Article>): Article {
  return {
    url: "https://www.trossenrobotics.com/post/x",
    title: "The Physical AI Deployment Blueprint",
    text: "body", content: "body", headings: ["a", "b", "c"], links: [],
    existingJsonLd: [], meta: {}, publishedTime: "2025-01-01T00:00:00Z", byline: "Marc Dostie",
    ...over,
  };
}
function content(over: Partial<OptimizedContent>): OptimizedContent {
  return {
    shortVersion: ["step"], whoThisIsFor: ["ops leaders"], articleMarkdown: "## h\n\ntext",
    faq: [{ q: "How?", a: "Like this." }],
    metadata: { headline: "h", title: "t", metaDescription: "d", slug: "s", tags: ["robotics"], socialCopy: "c", imageAltText: [] },
    assetRecommendations: [],
    ...over,
  };
}

describe("buildSchemas", () => {
  it("emits the full set: Article, Organization, Person, Breadcrumb, FAQPage", () => {
    const { schemas, articleValid } = buildSchemas(article({}), content({}));
    const types = schemas.map((s) => s["@type"]);
    expect(types).toContain("TechArticle");
    expect(types).toContain("Organization");
    expect(types).toContain("Person"); // has byline
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("FAQPage");
    expect(articleValid).toBe(true);
  });

  it("uses the optimized headline for the Article schema headline", () => {
    const { schemas } = buildSchemas(
      article({}),
      content({ metadata: { headline: "How does ROS 2 power robot learning?", title: "t", metaDescription: "d", slug: "s", tags: [], socialCopy: "c", imageAltText: [] } }),
    );
    const art = schemas.find((s) => s["@type"] === "TechArticle") as any;
    expect(art.headline).toBe("How does ROS 2 power robot learning?");
  });

  it("falls back to the article title when no headline is set", () => {
    const { schemas } = buildSchemas(
      article({ title: "Original Title" }),
      content({ metadata: { headline: "", title: "t", metaDescription: "d", slug: "s", tags: [], socialCopy: "c", imageAltText: [] } }),
    );
    const art = schemas.find((s) => s["@type"] === "TechArticle") as any;
    expect(art.headline).toBe("Original Title");
  });

  it("FAQPage mirrors the generated FAQ", () => {
    const { schemas } = buildSchemas(article({}), content({ faq: [{ q: "Q1?", a: "A1." }] }));
    const faqPage = schemas.find((s) => s["@type"] === "FAQPage") as any;
    expect(faqPage.mainEntity[0].name).toBe("Q1?");
    expect(faqPage.mainEntity[0].acceptedAnswer.text).toBe("A1.");
  });

  it("omits Person + notes when there is no byline", () => {
    const { schemas, notes } = buildSchemas(article({ byline: undefined }), content({}));
    expect(schemas.map((s) => s["@type"])).not.toContain("Person");
    expect(notes.join(" ")).toMatch(/byline/i);
  });

  it("flags missing datePublished instead of guessing", () => {
    const { articleValid, notes } = buildSchemas(article({ publishedTime: undefined }), content({}));
    expect(articleValid).toBe(false);
    expect(notes.join(" ")).toMatch(/datePublished/);
  });

  it("flags a conflict with existing Wix Article/BlogPosting JSON-LD", () => {
    const { notes } = buildSchemas(article({ existingJsonLd: [{ "@type": "BlogPosting" }] }), content({}));
    expect(notes.join(" ")).toMatch(/already has/i);
  });
});
