import { describe, it, expect } from "vitest";
import { deriveConfig } from "../src/config.js";
import type { Article } from "../src/types.js";

function article(partial: Partial<Article>): Article {
  return {
    url: "https://example.com",
    title: "",
    text: "",
    content: "",
    headings: [],
    links: [],
    existingJsonLd: [],
    meta: {},
    ...partial,
  };
}

describe("deriveConfig", () => {
  it("derives the primary query from THIS article's title, not the hardcoded blueprint query", () => {
    const cfg = deriveConfig(
      article({
        title: "Introducing the Trossen Docs MCP Server",
        headings: ["What the MCP Server does", "Supported tools and workflows"],
      }),
    );
    // Announce prefix stripped, real subject surfaced.
    expect(cfg.primaryQueries[0]).toBe("Trossen Docs MCP Server");
    // The off-topic blueprint query must NOT bleed in.
    expect(cfg.primaryQueries.join(" | ").toLowerCase()).not.toContain("robotics pilot to production");
    // Brand entities are still preserved from the base config.
    expect(cfg.entities).toContain("Trossen Robotics");
  });

  it("drops a trailing subtitle after a colon/dash", () => {
    const cfg = deriveConfig(
      article({ title: "Navigating the New Era of AI and Robotics: From Prototypes to Deployment" }),
    );
    expect(cfg.primaryQueries[0]).toBe("Navigating the New Era of AI and Robotics");
  });

  it("falls back to the base queries when the article has no usable title/headings", () => {
    const cfg = deriveConfig(article({ title: "", headings: [] }));
    expect(cfg.primaryQueries.length).toBeGreaterThan(0); // base blueprint queries
  });
});
