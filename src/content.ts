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

/** Everything in OptimizedContent except the article body (which is a separate call). */
export type OptimizedMeta = Omit<OptimizedContent, "articleMarkdown">;

/** Parse the small structured-meta JSON (call 2). The article body is parsed separately. */
export function parseOptimizedMeta(raw: string): OptimizedMeta {
  let obj: Record<string, unknown>;
  try {
    obj = extractJson(raw) as Record<string, unknown>;
  } catch (e) {
    throw new ContentParseError(`Could not parse optimizer metadata JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    shortVersion: asStringArray(obj.shortVersion),
    whoThisIsFor: asStringArray(obj.whoThisIsFor),
    faq: asFaq(obj.faq),
    metadata: asMetadata(obj.metadata),
    assetRecommendations: asStringArray(obj.assetRecommendations),
  };
}

/** Combine the separately-generated article body with the structured meta. */
export function assembleContent(articleMarkdown: string, meta: OptimizedMeta): OptimizedContent {
  return { ...meta, articleMarkdown: articleMarkdown.trim() };
}

/**
 * Assemble the full publishable article (Markdown) from the structured parts —
 * used for scoring, the fact-preservation claim-diff, and the "copy everything"
 * action in the UI.
 */
export function composeArticle(content: OptimizedContent, title: string, leadQuery?: string): string {
  const out: string[] = [];
  // Answer-first lead FIRST (before the title) so the scored text opens with a
  // direct answer to the primary query — this is the "answer-first TL;DR" signal.
  if (leadQuery && content.shortVersion.length) {
    const topic = leadQuery.replace(/^how\s+(do\s+i|can\s+i|to)\s+/i, "").trim();
    const step = content.shortVersion[0].replace(/^[A-Z]/, (c) => c.toLowerCase());
    out.push(`To ${topic}, ${step}`);
  }
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
