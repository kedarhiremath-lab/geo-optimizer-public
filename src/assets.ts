// Visual + downloadable-asset handling (feedback #1, #3).
//
// - When the source article has NO images, we generate machine-readable figure
//   placeholders for 2 of the first-four sections: a real <figure> with alt text
//   and a <figcaption>, plus a ready-to-use generation prompt (surfaced in the UI).
//   Search engines and AI parse alt + figcaption, so these are GEO assets even
//   before a designer renders the actual pixels.
// - Downloadable assets in the source (PDFs, decks, etc.) are preserved into the
//   rewrite so nothing gated/linked is lost.

import type { ImageSuggestion } from "./types.js";

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;");
const normH = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A machine-readable HTML figure: parseable alt text + visible caption. */
export function figureBlock(s: ImageSuggestion): string {
  return [
    "<figure>",
    `  <img src="image-to-generate" alt="${escAttr(s.alt)}" />`,
    `  <figcaption>${escHtml(s.caption)}</figcaption>`,
    "</figure>",
  ].join("\n");
}

/** Section headings (## / ### / bold line) in document order, plain text. */
function headingsOf(md: string): { line: string; text: string }[] {
  const out: { line: string; text: string }[] = [];
  for (const line of md.split("\n")) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*$/) || line.match(/^\*\*(.+?)\*\*\s*$/);
    if (h) out.push({ line, text: h[1].trim() });
  }
  return out;
}

/** Pick up to `max` suggestions that map to one of the FIRST `withinFirst` sections. */
export function pickFigures(
  suggestions: ImageSuggestion[],
  headings: string[],
  max = 2,
  withinFirst = 4,
): ImageSuggestion[] {
  const firstHeads = headings.slice(0, withinFirst).map(normH);
  const matched = suggestions.filter((s) => firstHeads.some((h) => h && normH(s.section) && (h.includes(normH(s.section)) || normH(s.section).includes(h))));
  const chosen = (matched.length ? matched : suggestions).slice(0, max);
  // If the model gave fewer than `max`, synthesize from the first sections so we
  // always offer at least two machine-readable figures (the ask: "generate 2").
  const used = [...chosen];
  for (let i = 0; used.length < max && i < headings.slice(0, withinFirst).length; i++) {
    const section = headings[i];
    if (used.some((u) => normH(u.section) === normH(section))) continue;
    used.push({
      section,
      alt: `Diagram illustrating "${section}".`,
      caption: section,
      prompt: `A clean, professional editorial diagram for a robotics article section titled "${section}". Minimal, technical, on-brand; no text-heavy clutter.`,
    });
  }
  return used.slice(0, max);
}

/**
 * Insert figures into the article after their matching section heading (or after
 * the first body heading if no match). Returns the augmented markdown + which
 * suggestions were placed.
 */
export function insertFigures(md: string, figures: ImageSuggestion[]): string {
  if (!figures.length) return md;
  const heads = headingsOf(md);
  let out = md;
  for (const fig of figures) {
    const target = heads.find((h) => normH(h.text) === normH(fig.section)) || heads[0];
    if (!target) {
      out += "\n\n" + figureBlock(fig);
      continue;
    }
    // Insert the figure right after the heading line (before that section's body).
    out = out.replace(target.line, target.line + "\n\n" + figureBlock(fig));
  }
  return out;
}

/** Host (domain) of a URL, for human-readable link text. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Preserve the source article's external citations (the "Sources (linked)"
 * section). The rewrite otherwise only floors links at ~2; a citation-heavy
 * article would lose most of its sources. We dedupe (ignoring tracking params)
 * and append a full Sources section — honoring "preserve everything below
 * Sources" and strengthening outbound-citation GEO signals. Skipped if the
 * article already carries a References/Sources section.
 */
export function ensureSourcesSection(md: string, externalLinks: string[], min = 5): string {
  if (externalLinks.length < min) return md;
  if (/^##\s+(sources|references)\b/im.test(md)) return md;
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const l of externalLinks) {
    const base = l.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    clean.push(base);
  }
  if (clean.length < min) return md;
  const rows = clean.map((u) => `- [${hostOf(u)}](${u})`).join("\n");
  return `${md}\n\n## Sources\n\n_Citations preserved from the original article._\n\n${rows}`;
}

/** Preserve source downloadable assets: append a Downloads section if any of the
 * links aren't already present in the article. Returns augmented markdown. */
export function ensureDownloadsSection(md: string, downloads: string[]): string {
  if (!downloads.length) return md;
  const missing = downloads.filter((d) => !md.includes(d));
  if (!missing.length) return md;
  const rows = missing
    .map((d) => {
      const name = decodeURIComponent(d.split("/").pop() || d).replace(/\.[a-z0-9]+(\?.*)?$/i, "").replace(/[-_]+/g, " ").trim();
      return `- [${name || "Download"}](${d})`;
    })
    .join("\n");
  return `${md}\n\n## Downloads\n\n_Downloadable assets from the original article, preserved here._\n\n${rows}`;
}
