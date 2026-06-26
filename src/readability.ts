// Editorial Preservation Mode — deterministic readability metrics.
//
// These measure how easy an article is to read/skim/extract, with NO LLM call,
// so they're cheap, stable, and testable. The same functions score the original
// and the optimized body, so the before->after delta is honest.

import type { ReadabilityMetrics } from "./types.js";

/** Strip markdown to plain prose for measurement (drop headings markers, list
 * bullets, table pipes, link syntax, bold/italic). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, "") // numbered bullets
    .replace(/^\s*\|.*\|\s*$/gm, " ") // table rows
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> text
    .replace(/[*_`>]/g, "") // emphasis / quote markers
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text: string): string[] {
  return stripMarkdown(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Body paragraphs only — excludes heading lines and pure list/table blocks. */
export function splitParagraphs(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (/^#{1,6}\s+/.test(p)) return false; // heading
      if (/^\s*\|.*\|/.test(p)) return false; // table
      // a block that's ONLY list items counts as a paragraph-equivalent for density,
      // but we exclude it from prose-paragraph length stats.
      const lines = p.split("\n");
      const listLines = lines.filter((l) => /^\s*([-*+]|\d+\.)\s+/.test(l)).length;
      return listLines < lines.length; // keep if it has at least some prose
    });
}

export function words(text: string): string[] {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Heuristic syllable count (good enough for Flesch). */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch Reading Ease (0-100+, higher = easier). */
export function fleschReadingEase(text: string): number {
  const sents = splitSentences(text);
  const ws = words(text);
  if (!sents.length || !ws.length) return 100;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const ease = 206.835 - 1.015 * (ws.length / sents.length) - 84.6 * (syl / ws.length);
  return Math.round(ease * 10) / 10;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Reading friction (0-100, LOWER is easier). Inverse of Flesch ease. */
export function readingFriction(text: string): number {
  return Math.round(clamp(100 - fleschReadingEase(text)));
}

/**
 * Cognitive load (0-100, LOWER is easier). A blend of long-sentence pressure,
 * long-word density, and paragraph density — what makes a page feel intimidating.
 */
export function cognitiveLoad(md: string): number {
  const ws = words(md);
  const sents = splitSentences(md);
  if (!ws.length || !sents.length) return 0;
  const avgSentLen = ws.length / sents.length; // words/sentence
  const longWordPct = ws.filter((w) => w.length >= 7).length / ws.length; // 0-1
  const density = paragraphDensityPct(md) / 100; // 0-1
  // Map each to ~0-100 pressure, weight, blend.
  const sentPressure = clamp((avgSentLen - 12) * 5); // 12 wpc ~0, 32 wpc ~100
  const wordPressure = clamp(longWordPct * 220); // ~45% long words ~100
  const load = sentPressure * 0.45 + wordPressure * 0.3 + density * 100 * 0.25;
  return Math.round(clamp(load));
}

/** Estimated reading time in minutes (200 wpm), one decimal. */
export function readingTimeMin(text: string): number {
  const n = words(text).length;
  return Math.max(0.1, Math.round((n / 200) * 10) / 10);
}

/** Average words per prose paragraph. */
export function avgParagraphLength(md: string): number {
  const paras = splitParagraphs(md);
  if (!paras.length) return 0;
  const total = paras.reduce((n, p) => n + words(p).length, 0);
  return Math.round(total / paras.length);
}

/** % of prose paragraphs that are "dense" (> 80 words) — the intimidating ones. */
export function paragraphDensityPct(md: string): number {
  const paras = splitParagraphs(md);
  if (!paras.length) return 0;
  const dense = paras.filter((p) => words(p).length > 80).length;
  return Math.round((dense / paras.length) * 100);
}

export function computeReadability(md: string): ReadabilityMetrics {
  return {
    readingFriction: readingFriction(md),
    cognitiveLoad: cognitiveLoad(md),
    readingTimeMin: readingTimeMin(md),
    avgParagraphLength: avgParagraphLength(md),
    paragraphDensityPct: paragraphDensityPct(md),
  };
}
