// Parse the structured rewrite JSON into OptimizedContent, and compose the full
// publishable article from its parts. Robust to the model wrapping JSON in
// fences or returning partial objects (we fill safe defaults).

import type { OptimizedContent, FaqItem, Metadata } from "./types.js";

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  // Find the outermost object.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function asMetadata(v: unknown): Metadata {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: typeof o.title === "string" ? o.title : "",
    metaDescription: typeof o.metaDescription === "string" ? o.metaDescription : "",
    slug: typeof o.slug === "string" ? o.slug : "",
    tags: asStringArray(o.tags),
    socialCopy: typeof o.socialCopy === "string" ? o.socialCopy : "",
    imageAltText: asStringArray(o.imageAltText),
  };
}

function asFaq(v: unknown): FaqItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { q: typeof o.q === "string" ? o.q : "", a: typeof o.a === "string" ? o.a : "" };
    })
    .filter((f) => f.q.trim() && f.a.trim());
}

export class ContentParseError extends Error {}

/** Parse the model's JSON output into a validated OptimizedContent. */
export function parseOptimizedContent(raw: string): OptimizedContent {
  let obj: Record<string, unknown>;
  try {
    obj = extractJson(raw) as Record<string, unknown>;
  } catch (e) {
    throw new ContentParseError(`Could not parse optimizer JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const articleMarkdown = typeof obj.articleMarkdown === "string" ? obj.articleMarkdown.trim() : "";
  if (!articleMarkdown) throw new ContentParseError("Optimizer returned no articleMarkdown.");
  return {
    shortVersion: asStringArray(obj.shortVersion),
    whoThisIsFor: asStringArray(obj.whoThisIsFor),
    articleMarkdown,
    faq: asFaq(obj.faq),
    metadata: asMetadata(obj.metadata),
    assetRecommendations: asStringArray(obj.assetRecommendations),
  };
}

/**
 * Assemble the full publishable article (Markdown) from the structured parts —
 * used for scoring, the fact-preservation claim-diff, and the "copy everything"
 * action in the UI.
 */
export function composeArticle(content: OptimizedContent, title: string): string {
  const out: string[] = [];
  if (title) out.push(`# ${title}`);
  if (content.shortVersion.length) {
    out.push("## The Short Version");
    out.push(content.shortVersion.map((s) => `- ${s}`).join("\n"));
  }
  if (content.whoThisIsFor.length) {
    out.push("## Who this is for");
    out.push(content.whoThisIsFor.map((s) => `- ${s}`).join("\n"));
  }
  out.push(content.articleMarkdown);
  if (content.faq.length) {
    out.push("## Frequently Asked Questions");
    out.push(content.faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n"));
  }
  return out.join("\n\n");
}
