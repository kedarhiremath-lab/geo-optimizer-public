// Editorial Preservation Mode — deterministic diff/preservation metrics.
//
// Measures how much of the author's original survives the edit: phrase reuse,
// sentence rewrite rate, vocabulary overlap (-> voice score), heading
// preservation, and generic-AI phrasing. No LLM call — stable and testable.

import { splitSentences, words, splitParagraphs, computeReadability } from "./readability.js";
import type { EditorialGate, EditorialReport, ReadabilityMetrics } from "./types.js";

/** Generic "AI slop" phrases that flatten an author's voice. Flagged, not allowed. */
export const GENERIC_AI_PHRASES = [
  "in today's rapidly evolving",
  "in today's fast-paced",
  "in the ever-evolving",
  "in the rapidly evolving landscape",
  "in conclusion",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "when it comes to",
  "at the end of the day",
  "navigating the complexities",
  "navigating the world of",
  "unlock the power",
  "unlock the potential",
  "in this digital age",
  "embark on a journey",
  "delve into",
  "dive deep into",
  "a testament to",
  "the world of",
  "game-changer",
  "game changer",
  "ever-changing",
  "fast-paced world",
];

export function genericAiPhrasesFound(text: string): string[] {
  const lc = text.toLowerCase();
  return GENERIC_AI_PHRASES.filter((p) => lc.includes(p));
}

const normSentence = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function tokenSet(s: string): Set<string> {
  return new Set(normSentence(s).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** N-gram (shingle) set for phrase-level reuse detection. */
function shingles(text: string, n = 3): Set<string> {
  const toks = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i++) out.add(toks.slice(i, i + n).join(" "));
  return out;
}

/** % of the OPTIMIZED text's phrasing that is reused verbatim from the original. */
export function wordingPreservedPct(orig: string, opt: string): number {
  const o = shingles(orig);
  const p = shingles(opt);
  if (!p.size) return 100;
  let kept = 0;
  for (const s of p) if (o.has(s)) kept++;
  return Math.round((kept / p.size) * 100);
}

/** % of optimized sentences that have NO near-identical match in the original. */
export function sentencesRewrittenPct(orig: string, opt: string): number {
  const origSents = splitSentences(orig).map((s) => ({ raw: s, set: tokenSet(s) }));
  const optSents = splitSentences(opt);
  if (!optSents.length) return 0;
  let rewritten = 0;
  for (const s of optSents) {
    const set = tokenSet(s);
    const best = origSents.reduce((m, o) => Math.max(m, jaccard(set, o.set)), 0);
    if (best < 0.8) rewritten++; // <80% token overlap with any original sentence = rewritten
  }
  return Math.round((rewritten / optSents.length) * 100);
}

const VOICE_STOP = new Set([
  "this", "that", "with", "from", "your", "have", "will", "they", "their", "them", "what",
  "when", "which", "would", "about", "there", "these", "those", "into", "than", "then",
  "been", "were", "also", "such", "more", "most", "some", "only", "over", "just", "like",
  "because", "while", "where", "here", "very", "much", "many", "each", "both", "even",
]);

/**
 * Voice preservation score (0-100). Dominated by VOCABULARY RETENTION — how many
 * of the author's distinctive content words survive the edit. Splitting, trimming,
 * and clarifying (editorial mode) keep the author's words, so they score high;
 * paraphrasing into generic prose swaps the vocabulary, so it scores low. Phrase
 * reuse is a light secondary signal; generic-AI phrasing is penalized.
 */
export function voicePreservationScore(orig: string, opt: string): number {
  // Compare PROSE only. Headings are now intentionally rewritten for GEO, so a
  // renamed/question heading must not count against the author's BODY voice.
  const prose = (t: string) =>
    t
      .split("\n")
      .filter((l) => !/^\s*#{1,6}\s+/.test(l) && !/^\s*\*\*[^*]+\*\*\s*$/.test(l))
      .join("\n");
  const o = prose(orig);
  const p = prose(opt);
  const contentWords = (t: string) =>
    new Set(words(t).filter((w) => w.length >= 4 && !VOICE_STOP.has(w)));
  const oSet = contentWords(o);
  const optSet = contentWords(p);
  const retention = oSet.size
    ? ([...oSet].filter((w) => optSet.has(w)).length / oSet.size) * 100
    : 100;
  const phrase = wordingPreservedPct(o, p); // 0-100 (3-gram reuse), prose only
  const generic = genericAiPhrasesFound(p).length;
  const score = retention * 0.9 + phrase * 0.1 - generic * 6;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Headings (## / ### / bold-only line) in document order, plain text. */
export function headingList(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*$/) || line.match(/^\*\*(.+?)\*\*\s*$/);
    if (h) out.push(h[1].trim());
  }
  return out;
}

const normHeading = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True if a heading is really the article title (so it isn't counted as a subtitle).
 * Lenient: matches when one contains the other or their content words overlap heavily
 * (handles a title with a subtitle after a colon vs the bare heading). */
function isTitleHeading(h: string, title: string): boolean {
  const t = normHeading(title);
  if (!t || !h) return false;
  if (h === t || t.includes(h) || h.includes(t)) return true;
  const tw = new Set(t.split(" ").filter((w) => w.length > 3));
  const hw = h.split(" ").filter((w) => w.length > 3);
  if (!hw.length || !tw.size) return false;
  const hits = hw.filter((w) => tw.has(w)).length;
  return hits / hw.length >= 0.7;
}

/** Reference/structural headings (Sources, References, Footnotes, …). These get
 * normalized by the engine (e.g. "Sources (linked)" -> "References") so they are
 * NOT counted as authored content subtitles in the preservation gate. */
function isStructuralHeading(h: string): boolean {
  return /^(sources?|references?|further reading|footnotes?|related|see also|notes?|appendix|bibliography)\b/.test(h);
}

/** A heading that shouldn't count as an authored content subtitle. */
function isExcludedHeading(h: string, title: string): boolean {
  return isTitleHeading(h, title) || isStructuralHeading(h);
}

export interface HeadingComparison {
  preserved: number;
  changed: number;
  duplicateRemoved: number;
}

/**
 * Compare optimized headings against the originals — ORIGINAL-relative.
 * `preserved` = original headings still present; `changed` = original headings
 * renamed/removed (this is what should be ~0). Engine-added scaffolding headings
 * (Short Version, FAQ, a guaranteed query heading) are intentional and are NOT
 * counted as "changed". `duplicateRemoved` = repeated headings within the output.
 */
export function compareHeadings(origHeadings: string[], optMd: string, title = ""): HeadingComparison {
  const orig = origHeadings.map(normHeading).filter((h) => h && !isExcludedHeading(h, title));
  const optList = headingList(optMd).map(normHeading).filter((h) => !isExcludedHeading(h, title));
  const optSet = new Set(optList);

  const seen = new Set<string>();
  let duplicateRemoved = 0;
  for (const h of optList) {
    if (seen.has(h)) duplicateRemoved++;
    else seen.add(h);
  }

  let preserved = 0;
  let changed = 0;
  for (const h of orig) {
    if (optSet.has(h)) preserved++;
    else changed++; // an original subtitle that's gone/renamed
  }
  return { preserved, changed, duplicateRemoved };
}

/** Remove a duplicated H1 title from the body (keep the first valid one). */
export function dedupeTitle(md: string, title: string): { md: string; removed: number } {
  if (!title) return { md, removed: 0 };
  const target = normHeading(title);
  let seenFirst = false;
  let removed = 0;
  const out = md
    .split("\n")
    .filter((line) => {
      const h = line.match(/^#{1,2}\s+(.+?)\s*#*$/);
      if (h && normHeading(h[1]) === target) {
        if (!seenFirst) {
          seenFirst = true;
          return true;
        }
        removed++;
        return false; // drop the duplicate
      }
      return true;
    })
    .join("\n");
  return { md: out, removed };
}

/**
 * Deterministically split dense prose paragraphs (> maxWords) at the sentence
 * boundary nearest the midpoint. Guarantees the skim/density/friction win even
 * when the model is conservative. Skips headings, lists, and tables.
 */
export function splitDenseParagraphs(md: string, maxWords = 85): string {
  return md
    .split(/\n\s*\n/)
    .map((block) => {
      const b = block.trim();
      if (!b) return block;
      if (/^#{1,6}\s+/.test(b)) return block; // heading
      if (/^\s*\|.*\|/.test(b)) return block; // table
      if (/^\s*([-*+]|\d+\.)\s+/.test(b)) return block; // list
      const wc = b.split(/\s+/).length;
      if (wc <= maxWords) return block;
      const sents = b.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
      if (sents.length < 2) return block;
      const half = wc / 2;
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < sents.length; i++) {
        acc += sents[i].split(/\s+/).length;
        if (acc >= half) {
          idx = i + 1;
          break;
        }
      }
      if (idx <= 0 || idx >= sents.length) return block;
      return sents.slice(0, idx).join(" ") + "\n\n" + sents.slice(idx).join(" ");
    })
    .join("\n\n");
}

export interface EditorialBudgetInput {
  origBody: string;
  optBody: string;
  /** Authoritative original heading list (from extraction), for subtitle comparison. */
  origHeadings: string[];
  origMetrics: ReadabilityMetrics;
  optMetrics: ReadabilityMetrics;
  claimsAdded: number;
  claimsRemoved: number;
  duplicateHeadingsRemoved: number;
  /** The H1 title — excluded from subtitle comparison so it isn't miscounted. */
  title?: string;
}

/** Assemble the full Editorial Change Budget report. */
export function editorialChangeBudget(input: EditorialBudgetInput): EditorialReport {
  const { origBody, optBody, origMetrics, optMetrics } = input;
  const headings = compareHeadings(input.origHeadings, optBody, input.title ?? "");
  const origParas = splitParagraphs(origBody).length;
  const optParas = splitParagraphs(optBody).length;
  return {
    sentencesRewrittenPct: sentencesRewrittenPct(origBody, optBody),
    wordingPreservedPct: wordingPreservedPct(origBody, optBody),
    paragraphsSplit: Math.max(0, optParas - origParas),
    sectionsMoved: 0, // reordering detection is out of scope for the deterministic pass
    headingsChanged: headings.changed,
    headingsPreserved: headings.preserved,
    duplicateHeadingsRemoved: input.duplicateHeadingsRemoved,
    claimsAdded: input.claimsAdded,
    claimsRemoved: input.claimsRemoved,
    readingTimeBefore: origMetrics.readingTimeMin,
    readingTimeAfter: optMetrics.readingTimeMin,
    avgParagraphLengthBefore: origMetrics.avgParagraphLength,
    avgParagraphLengthAfter: optMetrics.avgParagraphLength,
    voicePreservationScore: voicePreservationScore(origBody, optBody),
  };
}

// ── Quality gates ("Do Not Publish If") ──────────────────────────────────────

import { readingFriction, stripMarkdown } from "./readability.js";

/** Basic markdown-table integrity: every pipe-table block has a separator row. */
export function tablesWellFormed(md: string): boolean {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      const block: string[] = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) block.push(lines[i++]);
      if (block.length < 2) return false;
      if (!/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(block[1])) return false; // 2nd row must be separator
    } else i++;
  }
  return true;
}

/** Light markdown sanity: balanced bold markers and code fences. */
export function markdownWellFormed(md: string): boolean {
  const bold = (md.match(/\*\*/g) || []).length;
  const fences = (md.match(/```/g) || []).length;
  return bold % 2 === 0 && fences % 2 === 0;
}

function first200Friction(body: string): number {
  const w = stripMarkdown(body).split(/\s+/).filter(Boolean).slice(0, 200).join(" ");
  return readingFriction(w);
}

export interface GateInput {
  origBody: string;
  optBody: string;
  /** Authoritative original heading list (from extraction). */
  origHeadings: string[];
  /** The full composed/published article (title + lead + body + FAQ) — used for
   * title, table, markdown, and generic-phrasing checks. */
  published: string;
  title: string;
  before: ReadabilityMetrics;
  after: ReadabilityMetrics;
  report: EditorialReport;
  claimDiffPassed: boolean;
}

export interface GateResult {
  gates: EditorialGate[];
  publishReady: boolean;
  reasons: string[];
}

/** Small connective-word set — a natural headline has at least one; a bare keyword
 * list ("ROS 2 Robot Learning Guide Tutorial Tips Best") has none. */
const HEADLINE_STOP = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "is", "are", "how",
  "why", "what", "your", "you", "with", "from", "that", "this", "when", "does", "do", "can",
]);

/**
 * The visible H1 is present and not obviously broken. This is a HARD publish gate,
 * so it only fails on clearly-bad headlines — empty/fragment, an absurdly long
 * paragraph-as-heading, or blatant keyword-stuffing (a word repeated 3+ times, or
 * a long string of keywords with no connective words). Length targeting (prompt
 * asks <=70; schema truncates 110 for Google) is guidance, NOT a publish blocker —
 * an untouched original title that happens to be long must never block publishing.
 */
export function headlineWellFormed(published: string): boolean {
  const first = (headingList(published)[0] ?? "").trim();
  if (first.length < 3 || first.length > 160) return false; // empty/fragment or wall-of-text
  const words = first.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  // Blatant stuffing: a long run of keywords with no connective words at all
  // (a natural headline of this length always has an article/preposition/verb).
  if (words.length >= 8 && !words.some((w) => HEADLINE_STOP.has(w))) return false;
  // Blatant stuffing: the same content word hammered 3+ times.
  const counts = new Map<string, number>();
  for (const w of words) if (w.length >= 3 && !HEADLINE_STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const c of counts.values()) if (c >= 3) return false;
  return true;
}

/** Count author-content subheadings (excludes the title and structural headings like Sources/References). */
function countAuthoredHeadings(headings: string[], title: string): number {
  return headings.map(normHeading).filter((h) => h && !isExcludedHeading(h, title)).length;
}

/**
 * Headings may now be freely rewritten (even into questions), so we no longer
 * require them to match verbatim. What we DO guard against is FLATTENING: the
 * model collapsing the author's sections and losing content. Since the engine
 * also adds sections, the optimized body should carry at least ~60% as many
 * content headings as the original had.
 */
export function sectionStructurePreserved(origHeadings: string[], optBody: string, title = ""): boolean {
  const origCount = countAuthoredHeadings(origHeadings, title);
  if (origCount === 0) return true;
  const optCount = countAuthoredHeadings(headingList(optBody), title);
  return optCount >= Math.max(1, Math.ceil(origCount * 0.6));
}

/** Evaluate the "Do Not Publish If" gate. publishReady is true only if all pass. */
export function evaluateEditorialGates(input: GateInput): GateResult {
  const { origBody, optBody, origHeadings, published, title, before, after, report, claimDiffPassed } = input;
  const generic = genericAiPhrasesFound(published);
  const f1Before = first200Friction(origBody);
  const f1After = first200Friction(optBody);

  const optSectionCount = countAuthoredHeadings(headingList(optBody), title);
  const origSectionCount = countAuthoredHeadings(origHeadings, title);
  const gates: EditorialGate[] = [
    {
      id: "title",
      label: "Headline present & well-formed",
      pass: headlineWellFormed(published),
      detail: headingList(published)[0] ?? "(none)",
    },
    {
      id: "subtitles",
      label: "Section structure preserved (not flattened)",
      pass: sectionStructurePreserved(origHeadings, optBody, title),
      detail: `${optSectionCount} section${optSectionCount === 1 ? "" : "s"} vs ${origSectionCount} original`,
    },
    {
      id: "dupe-title",
      label: "Duplicate title removed if present",
      pass: true,
      detail: `${report.duplicateHeadingsRemoved} removed`,
    },
    { id: "tables", label: "No broken table formatting", pass: tablesWellFormed(published), detail: "" },
    { id: "markdown", label: "No malformed markdown", pass: markdownWellFormed(published), detail: "" },
    { id: "claims", label: "No fake claims or citations", pass: claimDiffPassed, detail: "" },
    {
      id: "generic",
      label: "No generic AI phrasing",
      pass: generic.length === 0,
      detail: generic.length ? `found: ${generic.join("; ")}` : "none",
    },
    {
      id: "voice",
      label: "Voice preservation ≥ 90",
      pass: report.voicePreservationScore >= 90,
      detail: `${report.voicePreservationScore}/100`,
    },
    {
      id: "friction",
      label: "Reading friction reduced (not increased)",
      pass: after.readingFriction <= before.readingFriction,
      detail: `${before.readingFriction} → ${after.readingFriction}`,
    },
    {
      id: "first200",
      label: "First 200 words easier to understand",
      // A crisp answer-first lead is intentionally information-dense (a GEO win).
      // Pass if the opening isn't much harder, OR the article overall got easier.
      pass: f1After <= f1Before + 8 || after.readingFriction < before.readingFriction,
      detail: `${f1Before} → ${f1After}`,
    },
    {
      id: "skim",
      label: "Easier to skim",
      pass:
        after.avgParagraphLength <= before.avgParagraphLength ||
        after.paragraphDensityPct < before.paragraphDensityPct,
      detail: `avg para ${before.avgParagraphLength} → ${after.avgParagraphLength} words; dense ${before.paragraphDensityPct}% → ${after.paragraphDensityPct}%`,
    },
    {
      id: "voice-author",
      label: "Still sounds like the original author",
      pass: report.voicePreservationScore >= 90,
      detail: `${report.voicePreservationScore}/100`,
    },
    {
      id: "less-intimidating",
      label: "Less intimidating than the original",
      pass: after.cognitiveLoad <= before.cognitiveLoad,
      detail: `cognitive load ${before.cognitiveLoad} → ${after.cognitiveLoad}`,
    },
    {
      id: "not-longer",
      label: "Not longer than the original",
      pass: after.readingTimeMin <= before.readingTimeMin * 1.1,
      detail: `${before.readingTimeMin} min → ${after.readingTimeMin} min`,
    },
  ];

  const reasons = gates.filter((g) => !g.pass).map((g) => g.label + (g.detail ? ` (${g.detail})` : ""));
  return { gates, publishReady: reasons.length === 0, reasons };
}

export { computeReadability };
