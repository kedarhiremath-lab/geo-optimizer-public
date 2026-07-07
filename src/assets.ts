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
import { topicOverlap } from "./score.js";

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

// Dark, on-brand palettes. The "Re-generate" button cycles a seed, which picks a
// palette (and, for the graph, varies the bars) so each take looks different.
interface Palette {
  bg: string;
  panel: string;
  accent: string;
  ink: string;
  muted: string;
  stroke: string;
}
const PALETTES: Palette[] = [
  { bg: "#0e1422", panel: "#16203a", accent: "#4f8cff", ink: "#eef2f8", muted: "#9aa6bb", stroke: "#2b3a5e" },
  { bg: "#0d1a14", panel: "#14271d", accent: "#2ec28a", ink: "#eaf5ee", muted: "#93b3a2", stroke: "#265041" },
  { bg: "#160f1f", panel: "#241733", accent: "#b06cff", ink: "#f2ecfa", muted: "#a99bbd", stroke: "#3d2b5e" },
  { bg: "#1a1410", panel: "#2a1f14", accent: "#f6a83c", ink: "#faf1e6", muted: "#bda98f", stroke: "#5e452b" },
];

const FONT = "system-ui,Segoe UI,Arial";

/** Deterministic 0..1 from two ints (so a given seed always renders the same). */
function rnd(a: number, b: number): number {
  const x = Math.sin((a + 1) * 12.9898 + (b + 1) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** GRAPHIC body: a step / component diagram — labelled nodes joined by connectors. */
function graphicBody(s: ImageSuggestion, pal: Palette, W: number, PAD: number, top: number): string {
  const kws = figureKeywords(s);
  const nodes = (kws.length >= 2 ? kws : ["Input", "Process", "Output"]).slice(0, 3);
  const n = nodes.length;
  const gap = 28;
  const nodeW = (W - 2 * PAD - (n - 1) * gap) / n;
  const nodeH = 100;
  const nodeY = Math.max(top + 24, 240);
  return nodes
    .map((label, i) => {
      const x = PAD + i * (nodeW + gap);
      const cx = x + nodeW / 2;
      const short = cap1(label.length > 16 ? label.slice(0, 15) + "…" : label);
      const conn =
        i < n - 1
          ? `<line x1="${(x + nodeW).toFixed(0)}" y1="${nodeY + nodeH / 2}" x2="${(x + nodeW + gap).toFixed(0)}" y2="${nodeY + nodeH / 2}" stroke="${pal.accent}" stroke-width="2"/>`
          : "";
      return (
        `<rect x="${x.toFixed(0)}" y="${nodeY}" width="${nodeW.toFixed(0)}" height="${nodeH}" rx="12" fill="${pal.panel}" stroke="${pal.stroke}"/>` +
        `<circle cx="${(x + 24).toFixed(0)}" cy="${nodeY + 24}" r="7" fill="${pal.accent}"/>` +
        `<text x="${cx.toFixed(0)}" y="${nodeY + nodeH / 2 + 16}" text-anchor="middle" fill="${pal.ink}" font-size="18" font-weight="600" font-family="${FONT}">${escHtml(short)}</text>` +
        conn
      );
    })
    .join("");
}

/** GRAPH body: a labelled bar chart. Bar heights vary with the seed. */
function graphBody(s: ImageSuggestion, pal: Palette, seed: number, W: number, H: number, PAD: number): string {
  const kws = figureKeywords(s);
  const labels = (kws.length >= 2 ? kws : ["Baseline", "Improved", "Best"]).slice(0, 4);
  const n = labels.length;
  const axisX = PAD + 6;
  const baseY = H - 70;
  const chartTop = 200;
  const chartH = baseY - chartTop;
  const gap = 26;
  const barW = (W - PAD - axisX - 14 - (n - 1) * gap) / n;
  let out =
    `<line x1="${axisX}" y1="${chartTop - 12}" x2="${axisX}" y2="${baseY}" stroke="${pal.stroke}" stroke-width="2"/>` +
    `<line x1="${axisX}" y1="${baseY}" x2="${W - PAD}" y2="${baseY}" stroke="${pal.stroke}" stroke-width="2"/>`;
  for (let g = 1; g <= 3; g++) {
    const gy = (baseY - (chartH * g) / 4).toFixed(0);
    out += `<line x1="${axisX}" y1="${gy}" x2="${W - PAD}" y2="${gy}" stroke="${pal.stroke}" stroke-width="1" opacity="0.4"/>`;
  }
  labels.forEach((label, i) => {
    const frac = 0.35 + rnd(seed, i) * 0.6;
    const bh = chartH * Math.min(frac, 0.98);
    const x = axisX + 16 + i * (barW + gap);
    const y = baseY - bh;
    const short = cap1(label.length > 10 ? label.slice(0, 9) + "…" : label);
    out +=
      `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${barW.toFixed(0)}" height="${bh.toFixed(0)}" rx="6" fill="${pal.accent}" opacity="0.9"/>` +
      `<text x="${(x + barW / 2).toFixed(0)}" y="${(y - 8).toFixed(0)}" text-anchor="middle" fill="${pal.ink}" font-size="15" font-weight="700" font-family="${FONT}">${Math.round(frac * 100)}</text>` +
      `<text x="${(x + barW / 2).toFixed(0)}" y="${baseY + 24}" text-anchor="middle" fill="${pal.muted}" font-size="14" font-family="${FONT}">${escHtml(short)}</text>`;
  });
  return out;
}

/** IMAGE body: a framed panel with a clean, stylized robotic-arm glyph. */
function imageBody(pal: Palette, W: number, H: number, PAD: number, top: number): string {
  const px = PAD;
  const py = Math.max(top + 12, 176);
  const pw = W - 2 * PAD;
  const ph = H - 40 - py;
  const panel = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="14" fill="${pal.panel}" opacity="0.55" stroke="${pal.stroke}"/>`;
  const cx = W / 2;
  const gy = H - 74;
  const link = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${pal.accent}" stroke-width="16" stroke-linecap="round"/>`;
  const joint = (x: number, y: number) =>
    `<circle cx="${x}" cy="${y}" r="13" fill="${pal.bg}" stroke="${pal.accent}" stroke-width="4"/>`;
  const arm =
    `<rect x="${cx - 64}" y="${gy}" width="128" height="16" rx="5" fill="${pal.ink}" opacity="0.85"/>` +
    link(cx, gy, cx - 70, gy - 120) +
    link(cx - 70, gy - 120, cx + 60, gy - 165) +
    joint(cx, gy) +
    joint(cx - 70, gy - 120) +
    joint(cx + 60, gy - 165) +
    `<rect x="${cx + 92}" y="${gy - 196}" width="10" height="26" rx="3" fill="${pal.accent}"/>` +
    `<rect x="${cx + 92}" y="${gy - 166}" width="10" height="26" rx="3" fill="${pal.accent}"/>` +
    `<rect x="${cx + 108}" y="${gy - 184}" width="26" height="26" rx="4" fill="${pal.ink}" opacity="0.9"/>`;
  return panel + arm;
}

/**
 * Render a clean, self-contained inline SVG figure derived from the section
 * subtitle + caption — as one of three formats (image | graphic | graph) per
 * s.kind. Real, visible, and machine-readable (it carries <title>, <desc>, and
 * aria-label that search engines and AI parse) — no image API, no cost. `seed`
 * varies the palette (and the graph's bars) so "Re-generate" yields a fresh take.
 */
export function figureSvg(s: ImageSuggestion, seed = 0): string {
  const W = 820;
  const H = 460;
  const PAD = 56;
  const pal = PALETTES[((seed % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const kind = s.kind === "graph" ? "graph" : s.kind === "graphic" ? "graphic" : "image";
  const kindLabel = kind === "graph" ? "GRAPH" : kind === "graphic" ? "GRAPHIC" : "IMAGE";
  const titleLines = wrapText(s.section || s.caption, 34).slice(0, 2);
  const titleSvg = titleLines
    .map((l, i) => `<text x="${PAD}" y="${104 + i * 40}" fill="${pal.ink}" font-size="30" font-weight="700" font-family="${FONT}">${escHtml(l)}</text>`)
    .join("");
  const bodyTop = 104 + titleLines.length * 40 + 6;

  let body: string;
  if (kind === "graph") body = graphBody(s, pal, seed, W, H, PAD);
  else if (kind === "graphic") body = graphicBody(s, pal, W, PAD, bodyTop);
  else body = imageBody(pal, W, H, PAD, bodyTop);

  const capLine = wrapText(s.caption, 80).slice(0, 1)[0] || "";
  return [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escAttr(s.alt)}" style="width:100%;height:auto;display:block;border-radius:14px">`,
    `<title>${escHtml(s.caption)}</title>`,
    `<desc>${escHtml(s.alt)}</desc>`,
    `<rect width="${W}" height="${H}" fill="${pal.bg}"/>`,
    `<rect width="${W}" height="6" fill="${pal.accent}"/>`,
    `<text x="${PAD}" y="60" fill="${pal.accent}" font-size="13" letter-spacing="3" font-weight="700" font-family="${FONT}">${kindLabel}</text>`,
    titleSvg,
    body,
    `<text x="${PAD}" y="${H - 24}" fill="${pal.muted}" font-size="15" font-family="${FONT}">${escHtml(capLine)}</text>`,
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

/** Engine-scaffolding headings that aren't real author sections — figures should
 * never anchor to these. */
const SCAFFOLD_HEADINGS = new Set([
  "the short version", "who this is for", "frequently asked questions", "faq",
  "sources", "references", "downloads", "deployment readiness at a glance",
]);

/**
 * The article's real content-section headings (##/###) in document order, excluding
 * the H1 title and engine scaffolding (Short Version, FAQ, Sources, …). Use this to
 * anchor figures to the sections the reader actually sees — which, now that headings
 * are GEO-rewritten, are NOT the original extracted headings.
 */
export function contentHeadingTexts(md: string): string[] {
  return headingsOf(md)
    .map((h) => h.text)
    .filter((t) => !SCAFFOLD_HEADINGS.has(normH(t)));
}

/**
 * Pick up to `max` figures for the FIRST `withinFirst` content sections, anchoring
 * each to a REAL current heading (headings may have been rewritten for GEO). For
 * each target section we reuse a model suggestion about that topic when one exists,
 * otherwise synthesize one — and in both cases set `.section` to the actual heading
 * so the figure's title and its insertion point match the rewritten body.
 */
export function pickFigures(
  suggestions: ImageSuggestion[],
  headings: string[],
  max = 2,
  withinFirst = 4,
): ImageSuggestion[] {
  const targets = headings.slice(0, withinFirst);
  const out: ImageSuggestion[] = [];
  const usedSug = new Set<number>();
  for (const section of targets) {
    if (out.length >= max) break;
    let pick: ImageSuggestion | null = null;
    for (let i = 0; i < suggestions.length; i++) {
      if (usedSug.has(i)) continue;
      const s = suggestions[i];
      const ref = s.section || s.alt;
      if (ref && topicOverlap(section, ref)) {
        pick = s;
        usedSug.add(i);
        break;
      }
    }
    out.push(
      pick
        ? { ...pick, section } // anchor the model's figure to the real heading text
        : {
            section,
            alt: `Diagram illustrating "${section}".`,
            caption: section,
            prompt: `A clean, professional editorial diagram for a robotics article section titled "${section}". Minimal, technical, on-brand; no text-heavy clutter.`,
          },
    );
  }
  return out;
}

/**
 * Insert figures right after their matching section heading. Because pickFigures
 * anchors each figure's `.section` to a real current heading, the match is exact;
 * if a heading somehow isn't found we append the figure at the end rather than
 * dumping it under the first heading.
 */
export function insertFigures(md: string, figures: ImageSuggestion[]): string {
  if (!figures.length) return md;
  const heads = headingsOf(md);
  let out = md;
  for (const fig of figures) {
    const target = heads.find((h) => normH(h.text) === normH(fig.section));
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
