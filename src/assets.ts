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

const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Word-wrap text into <= maxChars lines. */
function wrapText(text: string, maxChars: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

const KW_STOP = new Set([
  "about", "above", "after", "again", "their", "there", "these", "those", "which", "while",
  "would", "could", "should", "where", "every", "into", "from", "with", "that", "this",
  "your", "what", "when", "they", "them", "than", "then", "shift", "diagram", "figure",
  "shows", "showing", "illustrating", "illustrates", "section", "article", "robotics",
]);

/** Up to 3 short keyword labels derived from the figure's alt + caption. */
function figureKeywords(s: ImageSuggestion): string[] {
  const words = `${s.alt} ${s.caption}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !KW_STOP.has(w));
  return [...new Set(words)].slice(0, 3);
}

/**
 * Render a clean, self-contained inline SVG figure derived from the section
 * subtitle + caption. Real, visible, and machine-readable (it carries <title>,
 * <desc>, and aria-label that search engines and AI parse) — no image API.
 */
export function figureSvg(s: ImageSuggestion): string {
  const W = 820;
  const H = 460;
  const PAD = 60;
  const titleLines = wrapText(s.section || s.caption, 30).slice(0, 2);
  const capLines = wrapText(s.caption, 66).slice(0, 2);
  const kws = figureKeywords(s);
  const nodes = (kws.length >= 2 ? kws : ["01", "02", "03"]).slice(0, 3);

  const n = nodes.length;
  const gap = 26;
  const nodeW = (W - 2 * PAD - (n - 1) * gap) / n;
  const nodeY = 300;
  const nodeH = 92;
  const nodeSvg = nodes
    .map((label, i) => {
      const x = PAD + i * (nodeW + gap);
      const cx = x + nodeW / 2;
      const short = label.length > 16 ? label.slice(0, 15) + "…" : label;
      const conn =
        i < n - 1
          ? `<line x1="${(x + nodeW).toFixed(0)}" y1="${nodeY + nodeH / 2}" x2="${(x + nodeW + gap).toFixed(0)}" y2="${nodeY + nodeH / 2}" stroke="#33405a" stroke-width="2"/>`
          : "";
      return (
        `<rect x="${x.toFixed(0)}" y="${nodeY}" width="${nodeW.toFixed(0)}" height="${nodeH}" rx="12" fill="#16203a" stroke="#2b3a5e"/>` +
        `<text x="${cx.toFixed(0)}" y="${nodeY + nodeH / 2 + 6}" text-anchor="middle" fill="#cdd6e6" font-size="17" font-weight="600" font-family="system-ui,Segoe UI,Arial">${escHtml(cap1(short))}</text>` +
        conn
      );
    })
    .join("");

  const titleSvg = titleLines
    .map((l, i) => `<text x="${PAD}" y="${130 + i * 44}" fill="#eef2f8" font-size="34" font-weight="700" font-family="system-ui,Segoe UI,Arial">${escHtml(l)}</text>`)
    .join("");
  const capY = 130 + titleLines.length * 44 + 8;
  const capSvg = capLines
    .map((l, i) => `<text x="${PAD}" y="${capY + i * 26}" fill="#9aa6bb" font-size="17" font-family="system-ui,Segoe UI,Arial">${escHtml(l)}</text>`)
    .join("");

  return [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escAttr(s.alt)}" style="width:100%;height:auto;display:block;border-radius:14px">`,
    `<title>${escHtml(s.caption)}</title>`,
    `<desc>${escHtml(s.alt)}</desc>`,
    `<rect width="${W}" height="${H}" fill="#0e1422"/>`,
    `<rect width="${W}" height="6" fill="#4f8cff"/>`,
    `<text x="${PAD}" y="66" fill="#7c89a3" font-size="13" letter-spacing="2" font-family="system-ui,Segoe UI,Arial">FIGURE</text>`,
    titleSvg,
    capSvg,
    nodeSvg,
    `</svg>`,
  ].join("\n");
}

/** A machine-readable HTML figure: real AI image if present, else inline SVG. */
export function figureBlock(s: ImageSuggestion): string {
  const visual = s.image
    ? `  <img src="${escAttr(s.image)}" alt="${escAttr(s.alt)}" style="max-width:100%;height:auto" />`
    : s.svg || figureSvg(s);
  return ["<figure>", visual, `  <figcaption>${escHtml(s.caption)}</figcaption>`, "</figure>"].join("\n");
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
