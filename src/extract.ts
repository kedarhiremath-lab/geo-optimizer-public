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
  const ratio = bodyWords > 0 ? extractedWords / bodyWords : 1;

  // Headings + links from the ORIGINAL (uncloned) doc, scoped to the article if found.
  const articleRoot =
    doc.querySelector("article") || doc.querySelector("main") || doc.body;
  const headings = Array.from(articleRoot?.querySelectorAll("h1,h2,h3") ?? [])
    .map((h) => h.textContent?.trim() ?? "")
    .filter(Boolean);
  const links = Array.from(articleRoot?.querySelectorAll("a[href]") ?? [])
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith("http"));

  if (extractedWords < EXTRACTION_THRESHOLDS.minExtractedWords) {
    throw new ExtractionError(
      `Extracted article too short for ${page.url}: ${extractedWords} words ` +
        `(need >= ${EXTRACTION_THRESHOLDS.minExtractedWords}). Extraction likely failed.`,
    );
  }
  if (ratio < EXTRACTION_THRESHOLDS.catastrophicRatio) {
    throw new ExtractionError(
      `Extraction recovered almost nothing for ${page.url}: ${extractedWords}/${bodyWords} words ` +
        `(${(ratio * 100).toFixed(1)}%, below catastrophic floor ${EXTRACTION_THRESHOLDS.catastrophicRatio * 100}%).`,
    );
  }
  if (headings.length < EXTRACTION_THRESHOLDS.minHeadings) {
    throw new ExtractionError(
      `Only ${headings.length} headings found in ${page.url} ` +
        `(need >= ${EXTRACTION_THRESHOLDS.minHeadings}). Structure likely lost.`,
    );
  }

  // Build a markdown-ish content string with headings marked, for the LLM.
  // Chrome (audio widget, read-time, byline date, share/subscribe) is stripped
  // so it pollutes neither the rewrite nor the fact-preservation guardrail.
  const content = buildMarkdownish(articleRoot);
  // Derive the plain text from the cleaned content so text + content agree and
  // both are chrome-free (parsed.textContent still carries the chrome).
  const text = content.replace(/^#{1,3}\s+/gm, "").replace(/^- /gm, "").trim();

  return {
    url: page.url,
    title: parsed.title?.trim() || meta.title || "Untitled",
    text,
    content,
    headings: headings.filter((h) => !isChrome(h)),
    links: Array.from(new Set(links)),
    existingJsonLd,
    meta,
    byline: parsed.byline?.trim() || undefined,
    publishedTime: parsed.publishedTime?.trim() || undefined,
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

/** Flatten an element into headings (## ) + paragraphs so the LLM sees structure. */
function buildMarkdownish(root: Element | null): string {
  if (!root) return "";
  const out: string[] = [];
  root.querySelectorAll("h1,h2,h3,p,li").forEach((el) => {
    const t = el.textContent?.trim();
    if (!t || isChrome(t)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "h1") out.push(`# ${t}`);
    else if (tag === "h2") out.push(`## ${t}`);
    else if (tag === "h3") out.push(`### ${t}`);
    else if (tag === "li") out.push(`- ${t}`);
    else out.push(t);
  });
  return out.join("\n\n");
}
