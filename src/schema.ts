// Generate the JSON-LD schema set (#12): Article/TechArticle, Organization,
// Person (author), BreadcrumbList (from URL path), ImageObject (if images),
// FAQPage (from the generated FAQ). Deterministic — no LLM guessing of dates or
// authors; values come from the extracted article and the generated content.
//
// NOT FAQPage-as-rich-result abuse: FAQPage here is the legitimate Q&A schema
// matching a real on-page FAQ section, which is what AI engines parse.

import type { Article, OptimizedContent } from "./types.js";

export interface SchemaResult {
  schemas: Record<string, unknown>[];
  notes: string[];
  /** True if the core Article schema has its required fields. */
  articleValid: boolean;
}

const ARTICLE_REQUIRED = ["@context", "@type", "headline", "author", "datePublished"];

const ORG: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Trossen Robotics",
  url: "https://www.trossenrobotics.com",
};

function breadcrumb(url: string): Record<string, unknown> | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const items = [{ name: "Home", path: "" }, ...parts.map((p) => ({ name: prettify(p), path: p }))];
    let acc = u.origin;
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map((it, i) => {
        acc = it.path ? `${acc}/${it.path}` : acc;
        return { "@type": "ListItem", position: i + 1, name: it.name, item: acc };
      }),
    };
  } catch {
    return null;
  }
}

function prettify(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}

export function buildSchemas(article: Article, content: OptimizedContent): SchemaResult {
  const notes: string[] = [];
  const schemas: Record<string, unknown>[] = [];

  // 1. Article / TechArticle
  const article_: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title.slice(0, 110),
    url: article.url,
    author: article.byline
      ? { "@type": "Person", name: article.byline }
      : { "@type": "Organization", name: "Trossen Robotics" },
    publisher: ORG,
  };
  if (content.metadata.metaDescription) article_.description = content.metadata.metaDescription;
  if (article.publishedTime) article_.datePublished = article.publishedTime;
  else notes.push("datePublished missing from source — fill before publishing (do not guess).");
  if (content.metadata.tags.length) article_.keywords = content.metadata.tags.join(", ");
  const missing = ARTICLE_REQUIRED.filter((k) => !(k in article_));
  const articleValid = missing.length === 0;
  if (!articleValid) notes.push(`Article schema missing: ${missing.join(", ")}.`);
  if (article.title.length > 110) notes.push("Headline truncated to 110 chars for Google.");
  schemas.push(article_);

  // 2. Organization
  schemas.push(ORG);

  // 3. Person (only if we know the author)
  if (article.byline) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "Person",
      name: article.byline,
      worksFor: { "@type": "Organization", name: "Trossen Robotics" },
    });
  } else {
    notes.push("No byline found — Person schema omitted (add an author to enable it).");
  }

  // 4. BreadcrumbList
  const bc = breadcrumb(article.url);
  if (bc) schemas.push(bc);

  // 5. ImageObject — only when alt text was suggested (i.e. images exist worth marking up)
  if (content.metadata.imageAltText.length) {
    content.metadata.imageAltText.forEach((alt) =>
      schemas.push({ "@context": "https://schema.org", "@type": "ImageObject", caption: alt }),
    );
    notes.push("ImageObject entries are stubs — add the real image URLs before publishing.");
  }

  // 6. FAQPage — from the generated FAQ (legitimate: matches an on-page FAQ section)
  if (content.faq.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  // Dedup note vs Wix's existing schema.
  const existingTypes = article.existingJsonLd
    .map((b) => (b && typeof b === "object" && "@type" in b ? String((b as Record<string, unknown>)["@type"]) : ""))
    .filter((t) => /article|blogposting/i.test(t));
  if (existingTypes.length) {
    notes.push(`Page already has ${existingTypes.join(", ")} JSON-LD (likely Wix) — replace it, don't add a second Article block.`);
  }

  return { schemas, notes, articleValid };
}
