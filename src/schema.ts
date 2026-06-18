// T7 — Generate + validate Article/TechArticle JSON-LD, dedup vs Wix's existing.
//
// NOT FAQPage: deprecated as a rich result (May 2026) and restricted to
// gov/health sites (eng review [Layer 1] correction). Commercial robotics ->
// Article / TechArticle.
//
// We generate deterministically from the extracted Article (no LLM guessing of
// dates/authors — eng review #6). Required fields are validated; if the page
// already carries an Article JSON-LD (Wix injects its own), we flag the conflict
// rather than emit a second, competing block.

import type { Article } from "./types.js";

export interface JsonLdOutput {
  jsonLd: Record<string, unknown>;
  valid: boolean;
  notes: string[];
}

const REQUIRED = ["@context", "@type", "headline", "author", "datePublished"];

export function buildJsonLd(article: Article): JsonLdOutput {
  const notes: string[] = [];

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title.slice(0, 110), // Google truncates headlines >110 chars
    url: article.url,
    author: article.byline
      ? { "@type": "Organization", name: article.byline }
      : { "@type": "Organization", name: "Trossen Robotics" },
    publisher: {
      "@type": "Organization",
      name: "Trossen Robotics",
      url: "https://www.trossenrobotics.com",
    },
  };

  if (article.publishedTime) {
    jsonLd.datePublished = article.publishedTime;
  } else {
    notes.push("datePublished missing from source — fill before publishing (do not guess).");
  }
  if (article.meta.description) jsonLd.description = article.meta.description;

  // Validate required fields.
  const missing = REQUIRED.filter((k) => !(k in jsonLd));
  const valid = missing.length === 0;
  if (!valid) notes.push(`Missing required JSON-LD fields: ${missing.join(", ")}.`);
  if (article.title.length > 110) notes.push("Headline truncated to 110 chars for Google.");

  // Dedup vs existing on-page JSON-LD (Wix often injects Article/BlogPosting).
  const existingArticleTypes = article.existingJsonLd
    .map((b) => readType(b))
    .filter((t): t is string => !!t)
    .filter((t) => /article|blogposting/i.test(t));
  if (existingArticleTypes.length > 0) {
    notes.push(
      `Page already has ${existingArticleTypes.join(", ")} JSON-LD (likely Wix). ` +
        "Replace/merge rather than adding a second Article block to avoid conflicting structured data.",
    );
  }

  return { jsonLd, valid, notes };
}

function readType(block: unknown): string | undefined {
  if (block && typeof block === "object" && "@type" in block) {
    const t = (block as Record<string, unknown>)["@type"];
    if (typeof t === "string") return t;
    if (Array.isArray(t)) return t.join(",");
  }
  return undefined;
}
