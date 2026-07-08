// Stage C — Convert the optimizer's markdown output into a Wix Ricos Document.
//
// Wix Blog stores a post body as "richContent": a Ricos document, which is a
// structured node tree ({ nodes: [...] }) rather than HTML. This converter takes
// the SAME markdown the UI's "Copy for Wix" button renders (result.rewrittenDraft)
// and produces the equivalent Ricos node tree, so an automated draft write matches
// what a human would paste into the Wix editor.
//
// Grammar handled (mirrors mdToHtml() in src/ui/server.ts):
//   #/##/### headings, blank-line-separated paragraphs, - / * bullets,
//   1. ordered lists, | ... | tables with a |---| separator row,
//   inline **bold** and [text](url) links.
//
// Raw-HTML blocks (generated <figure>/<svg> figures, often base64 images) are NOT
// embedded: base64 images would blow the 400 KB draft-size cap and Ricos wants
// uploaded media nodes, not inline data URIs. They are collected and returned in
// `skippedHtmlBlocks` so the caller can report "insert these figures manually" —
// matching the current manual flow (Download PNG → Insert → Image in Wix).

export type Decoration =
  | { type: "BOLD"; fontWeightValue: 700 }
  | { type: "ITALIC"; italicData: true }
  | { type: "LINK"; linkData: { link: { url: string; target: "BLANK" } } };

export interface RicosNode {
  type: string;
  id: string;
  nodes?: RicosNode[];
  textData?: { text: string; decorations: Decoration[] };
  headingData?: { level: number; textStyle: { textAlignment: string } };
  paragraphData?: Record<string, unknown>;
  tableData?: unknown;
  tableCellData?: unknown;
  [k: string]: unknown;
}

export interface RicosDocument {
  nodes: RicosNode[];
  metadata?: { version: number; createdTimestamp?: string; updatedTimestamp?: string };
}

export interface MarkdownToRicosResult {
  richContent: RicosDocument;
  /** Raw HTML blocks (figures/SVG) found in the markdown but not embedded. */
  skippedHtmlBlocks: string[];
}

export interface RicosOptions {
  /** Prefix for generated node ids (keeps ids unique + tests deterministic). */
  idPrefix?: string;
}

// ── id generation ────────────────────────────────────────────────────────────
// Ricos requires a unique id on every non-TEXT node. Deterministic counter (no
// Math.random) so the same markdown always yields the same document — friendly to
// snapshot tests and idempotent re-runs.
function makeIdGen(prefix: string) {
  let n = 0;
  return () => `${prefix}${(n++).toString(36)}`;
}

// ── inline parsing: **bold** and [text](url) -> TEXT nodes with decorations ────
const LINK_RE = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

function textNode(text: string, decorations: Decoration[]): RicosNode {
  return { type: "TEXT", id: "", textData: { text, decorations } };
}

/** Split a plain string into TEXT nodes, splitting out **bold** runs. */
function splitBold(text: string, base: Decoration[]): RicosNode[] {
  const out: RicosNode[] = [];
  let last = 0;
  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(text))) {
    if (m.index > last) out.push(textNode(text.slice(last, m.index), base));
    out.push(textNode(m[1], [...base, { type: "BOLD", fontWeightValue: 700 }]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(textNode(text.slice(last), base));
  return out.filter((n) => (n.textData?.text ?? "") !== "");
}

/**
 * Convert an inline markdown string into an array of Ricos TEXT nodes, applying
 * BOLD and LINK decorations. Links are extracted first (a link's visible text may
 * itself contain **bold**), then bold runs within the remaining plain text.
 */
export function parseInline(text: string): RicosNode[] {
  const out: RicosNode[] = [];
  let last = 0;
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    if (m.index > last) out.push(...splitBold(text.slice(last, m.index), []));
    const linkDeco: Decoration = { type: "LINK", linkData: { link: { url: m[2], target: "BLANK" } } };
    out.push(...splitBold(m[1], [linkDeco]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...splitBold(text.slice(last), []));
  // A paragraph with no text still needs an (empty) node array; caller handles [].
  return out;
}

// ── block parsing ──────────────────────────────────────────────────────────
const H_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const ORDERED_RE = /^\d+\.\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|/;

function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Convert the optimizer's markdown body into a Ricos document.
 */
export function markdownToRicos(markdown: string, opts: RicosOptions = {}): MarkdownToRicosResult {
  const id = makeIdGen(opts.idPrefix ?? "n");
  const nodes: RicosNode[] = [];
  const skippedHtmlBlocks: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let para: string[] = [];
  let list: { type: "BULLETED_LIST" | "ORDERED_LIST"; items: RicosNode[] } | null = null;

  const paragraphNode = (text: string): RicosNode => {
    const inline = parseInline(text);
    return { type: "PARAGRAPH", id: id(), nodes: inline, paragraphData: {} };
  };
  const flushPara = () => {
    if (para.length) {
      nodes.push(paragraphNode(para.join(" ")));
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      nodes.push({ type: list.type, id: id(), nodes: list.items });
      list = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  const listItem = (text: string): RicosNode => ({
    type: "LIST_ITEM",
    id: id(),
    nodes: [{ type: "PARAGRAPH", id: id(), nodes: parseInline(text), paragraphData: {} }],
  });

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      flushAll();
      continue;
    }

    // Raw-HTML passthrough (generated <figure>/<svg>): collect, do not embed.
    if (line.charAt(0) === "<") {
      flushAll();
      // Gather the full block until a blank line so multi-line <figure> is captured.
      const block: string[] = [raw];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "") {
        block.push(lines[++i]);
      }
      skippedHtmlBlocks.push(block.join("\n"));
      continue;
    }

    // Table: "| ... |" header followed by a "|---|---|" separator row.
    if (line.charAt(0) === "|" && i + 1 < lines.length && /-/.test(lines[i + 1]) && TABLE_SEP_RE.test(lines[i + 1])) {
      flushAll();
      const header = tableCells(line);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().charAt(0) === "|") {
        bodyRows.push(tableCells(lines[i]));
        i++;
      }
      i--; // step back; the for-loop will advance
      nodes.push(buildTable(header, bodyRows, id));
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(H_RE))) {
      flushAll();
      const level = Math.min(m[1].length, 6);
      nodes.push({
        type: "HEADING",
        id: id(),
        nodes: parseInline(m[2]),
        headingData: { level, textStyle: { textAlignment: "AUTO" } },
      });
    } else if ((m = line.match(BULLET_RE))) {
      flushPara();
      if (list?.type !== "BULLETED_LIST") {
        flushList();
        list = { type: "BULLETED_LIST", items: [] };
      }
      list.items.push(listItem(m[1]));
    } else if ((m = line.match(ORDERED_RE))) {
      flushPara();
      if (list?.type !== "ORDERED_LIST") {
        flushList();
        list = { type: "ORDERED_LIST", items: [] };
      }
      list.items.push(listItem(m[1]));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushAll();

  return { richContent: { nodes, metadata: { version: 1 } }, skippedHtmlBlocks };
}

// ── table builder ────────────────────────────────────────────────────────────
function cellNode(text: string, id: () => string): RicosNode {
  return {
    type: "TABLE_CELL",
    id: id(),
    nodes: [{ type: "PARAGRAPH", id: id(), nodes: parseInline(text), paragraphData: {} }],
    tableCellData: { cellStyle: { verticalAlignment: "TOP" } },
  };
}

function rowNode(cells: string[], id: () => string): RicosNode {
  return { type: "TABLE_ROW", id: id(), nodes: cells.map((c) => cellNode(c, id)) };
}

function buildTable(header: string[], bodyRows: string[][], id: () => string): RicosNode {
  const cols = header.length;
  const allRows = [header, ...bodyRows];
  const rows = allRows.map((r) => {
    // pad/truncate each row to the header's column count
    const cells = r.slice(0, cols);
    while (cells.length < cols) cells.push("");
    return rowNode(cells, id);
  });
  return {
    type: "TABLE",
    id: id(),
    nodes: rows,
    tableData: {
      dimensions: {
        colsWidthRatio: Array(cols).fill(Math.floor(1000 / Math.max(cols, 1))),
        rowsHeight: allRows.map(() => 40),
        colsMinWidth: Array(cols).fill(120),
      },
    },
  };
}
