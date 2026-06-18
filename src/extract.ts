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

  // Visible body word count (rough) before Readability strips chrome — used as
  // the denominator for the fidelity check.
  const bodyText = doc.body?.textContent ?? "";
  const bodyWords = wordCount(bodyText);

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

  // Readability mutates the doc; clone first so our heading/link scan sees the original.
  const readabilityDoc = doc.cloneNode(true) as Document;
  const parsed = new Readability(readabilityDoc).parse();
  if (!parsed || !parsed.textContent) {
    throw new ExtractionError(`Readability could not extract an article from ${page.url}`);
  }

  const extractedWords = wordCount(parsed.textContent);
  const ratio = bodyWords > 0 ? extractedWords / bodyWords : 0;

  // Headings + links from the ORIGINAL (uncloned) doc, scoped to the article if found.
  const articleRoot =
    doc.querySelector("article") || doc.querySelector("main") || doc.body;
  const headings = Array.from(articleRoot?.querySelectorAll("h1,h2,h3") ?? [])
    .map((h) => h.textContent?.trim() ?? "")
    .filter(Boolean);
  const links = Array.from(articleRoot?.querySelectorAll("a[href]") ?? [])
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith("http"));

  if (ratio < EXTRACTION_THRESHOLDS.minBodyWordRatio) {
    throw new ExtractionError(
      `Extraction fidelity too low for ${page.url}: recovered ${extractedWords}/${bodyWords} words ` +
        `(${(ratio * 100).toFixed(0)}%, need >= ${EXTRACTION_THRESHOLDS.minBodyWordRatio * 100}%).`,
    );
  }
  if (headings.length < EXTRACTION_THRESHOLDS.minHeadings) {
    throw new ExtractionError(
      `Only ${headings.length} headings found in ${page.url} ` +
        `(need >= ${EXTRACTION_THRESHOLDS.minHeadings}). Structure likely lost.`,
    );
  }

  // Build a markdown-ish content string with headings marked, for the LLM.
  const content = buildMarkdownish(articleRoot);

  return {
    url: page.url,
    title: parsed.title?.trim() || meta.title || "Untitled",
    text: parsed.textContent.trim(),
    content,
    headings,
    links: Array.from(new Set(links)),
    existingJsonLd,
    meta,
    byline: parsed.byline?.trim() || undefined,
    publishedTime: parsed.publishedTime?.trim() || undefined,
  };
}

/** Flatten an element into headings (## ) + paragraphs so the LLM sees structure. */
function buildMarkdownish(root: Element | null): string {
  if (!root) return "";
  const out: string[] = [];
  root.querySelectorAll("h1,h2,h3,p,li").forEach((el) => {
    const t = el.textContent?.trim();
    if (!t) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "h1") out.push(`# ${t}`);
    else if (tag === "h2") out.push(`## ${t}`);
    else if (tag === "h3") out.push(`### ${t}`);
    else if (tag === "li") out.push(`- ${t}`);
    else out.push(t);
  });
  return out.join("\n\n");
}
