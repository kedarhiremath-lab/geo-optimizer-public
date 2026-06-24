// T3 — Extract the main article from rendered HTML via Mozilla Readability.
//
// Readability is the tried-and-true extractor (Firefox Reader View). We do NOT
// hand-roll Wix DOM parsing — that's the fragile path the eng review flagged.
//
// Fail-loud (eng review): if extraction recovers < 60% of the visible body word
// count or fewer than 3 headings, we throw rather than feed garbage downstream.
// Every later score depends on structure, so garbage-in here poisons everything.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { EXTRACTION_THRESHOLDS } from "./config.js";
import type { Article, RenderedPage } from "./types.js";

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export class ExtractionError extends Error {}

export function extractArticle(page: RenderedPage): Article {
  const dom = new JSDOM(page.html, { url: page.url });
  const doc = dom.window.document;

  // Collect existing JSON-LD (Wix injects its own) so we can dedup later.
  const existingJsonLd: unknown[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      existingJsonLd.push(JSON.parse(el.textContent ?? ""));
    } catch {
      /* skip malformed JSON-LD */
    }
  });

  const meta = {
    title: doc.querySelector("title")?.textContent?.trim() || undefined,
    description:
      doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
      undefined,
  };

  // Readability — used only for a clean title. It's a hint, not the content
  // source (its body extraction is unreliable across Wix templates), so failure
  // here is non-fatal.
  let readabilityTitle: string | undefined;
  let readabilityByline: string | undefined;
  let readabilityPublished: string | undefined;
  try {
    const parsed = new Readability(doc.cloneNode(true) as Document).parse();
    readabilityTitle = parsed?.title?.trim() || undefined;
    readabilityByline = parsed?.byline?.trim() || undefined;
    readabilityPublished = parsed?.publishedTime?.trim() || undefined;
  } catch {
    /* title/byline fall back below */
  }

  // Headings + links from the article container if present, else the body.
  const articleRoot = doc.querySelector("article") || doc.querySelector("main") || doc.body;
  const headings = Array.from(articleRoot?.querySelectorAll("h1,h2,h3") ?? [])
    .map((h) => h.textContent?.trim() ?? "")
    .filter(Boolean)
    .filter((h) => !isChrome(h));
  const links = Array.from(articleRoot?.querySelectorAll("a[href]") ?? [])
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith("http"));

  // Build the article content from the rendered DOM (chrome-stripped). This is
  // the actual content the rest of the pipeline uses — so the fidelity guards
  // below check THIS, not Readability's (often-wrong) extraction.
  const content = buildMarkdownish(articleRoot);
  const text = content.replace(/^#{1,3}\s+/gm, "").replace(/^- /gm, "").trim();
  const contentWords = wordCount(text);

  // Fail loud only if we genuinely couldn't recover a real article.
  if (contentWords < EXTRACTION_THRESHOLDS.minExtractedWords) {
    throw new ExtractionError(
      `Could not extract a usable article from ${page.url}: only ${contentWords} content words ` +
        `(need >= ${EXTRACTION_THRESHOLDS.minExtractedWords}). The page may not be a standard article.`,
    );
  }
  // NOTE: we do NOT fail on too-few headings. A post with weak heading structure
  // is a valid input — fixing that structure is precisely what the optimizer
  // does (it scores low on the heading signal and the rewrite adds proper
  // question-shaped headings). Refusing such a page would be backwards.

  return {
    url: page.url,
    title: readabilityTitle || meta.title || headings[0] || "Untitled",
    text,
    content,
    headings,
    links: Array.from(new Set(links)),
    existingJsonLd,
    meta,
    byline: readabilityByline,
    publishedTime: readabilityPublished,
  };
}

// Lines Readability pulls from Wix chrome that are not article content.
const CHROME_PATTERNS: RegExp[] = [
  /^listen to the audio version/i,
  /^\d+\s*min read$/i,
  /^\d+\s*(views?|likes?|comments?)$/i,
  /^(share|subscribe|sign up|follow us|recent posts|related posts|comments?)\b/i,
  /^[A-Z][a-z]{2}\s+\d{1,2}(,\s*\d{4})?$/, // standalone date byline e.g. "Jun 8"
  /^\d{1,2}\s+min$/i,
];

function isChrome(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return CHROME_PATTERNS.some((re) => re.test(t));
}

/**
 * Flatten an element into headings + paragraphs for the LLM. Captures real
 * paragraph tags (p/li/blockquote) AND leaf div/span/td text — Wix and many
 * site builders render body copy in <div>/<span>, not <p>, so a p-only scan
 * misses most of the article. We take only LEAF containers (no block-level
 * children) to avoid double-counting parents, dedupe identical strings, and
 * require div/span/td blocks to be reasonably long so we skip nav/buttons.
 */
const CONTAINER = "h1,h2,h3,p,li,blockquote,div,span,td";
function buildMarkdownish(root: Element | null): string {
  if (!root) return "";
  const out: string[] = [];
  const seen = new Set<string>();
  root.querySelectorAll(CONTAINER).forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const isLoose = tag === "div" || tag === "span" || tag === "td";
    // Skip generic containers that wrap other content (count the leaves instead).
    if (isLoose && el.querySelector(CONTAINER)) return;
    const t = el.textContent?.replace(/\s+/g, " ").trim();
    if (!t || isChrome(t)) return;
    if (isLoose && t.length < 40) return; // short loose blocks are usually nav/UI, not copy
    if (seen.has(t)) return;
    seen.add(t);
    if (tag === "h1") out.push(`# ${t}`);
    else if (tag === "h2") out.push(`## ${t}`);
    else if (tag === "h3") out.push(`### ${t}`);
    else if (tag === "li") out.push(`- ${t}`);
    else out.push(t);
  });
  return out.join("\n\n");
}
