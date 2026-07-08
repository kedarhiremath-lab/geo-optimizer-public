import { describe, it, expect } from "vitest";
import { markdownToRicos, parseInline } from "../src/wix/ricos.js";

// Walk the node tree collecting nodes of a given type.
function collect(nodes: any[], type: string, acc: any[] = []): any[] {
  for (const n of nodes) {
    if (n.type === type) acc.push(n);
    if (Array.isArray(n.nodes)) collect(n.nodes, type, acc);
  }
  return acc;
}

describe("parseInline", () => {
  it("splits plain text into a single TEXT node", () => {
    const t: any[] = parseInline("hello world");
    expect(t).toHaveLength(1);
    expect(t[0].textData.text).toBe("hello world");
    expect(t[0].textData.decorations).toEqual([]);
  });

  it("applies BOLD to **bold** runs only", () => {
    const t: any[] = parseInline("a **b** c");
    expect(t.map((n) => n.textData.text)).toEqual(["a ", "b", " c"]);
    expect(t[1].textData.decorations[0].type).toBe("BOLD");
    expect(t[0].textData.decorations).toEqual([]);
  });

  it("applies LINK decoration with the href and BLANK target", () => {
    const t: any[] = parseInline("see [the docs](https://example.com/x) now");
    const link = t.find((n) => n.textData.text === "the docs");
    expect(link.textData.decorations[0]).toEqual({
      type: "LINK",
      linkData: { link: { url: "https://example.com/x", target: "BLANK" } },
    });
  });

  it("supports **bold** inside link text", () => {
    const t: any[] = parseInline("[**buy** now](https://x.io)");
    const bold = t.find((n) => n.textData.text === "buy");
    expect(bold.textData.decorations.map((d: any) => d.type).sort()).toEqual(["BOLD", "LINK"]);
  });
});

describe("markdownToRicos — blocks", () => {
  it("maps #/##/### to HEADING levels", () => {
    const { richContent } = markdownToRicos("# One\n\n## Two\n\n### Three");
    const hs = collect(richContent.nodes, "HEADING");
    expect(hs.map((h) => h.headingData.level)).toEqual([1, 2, 3]);
    expect(hs[0].nodes[0].textData.text).toBe("One");
  });

  it("groups blank-line-separated lines into paragraphs", () => {
    const { richContent } = markdownToRicos("line a\nline b\n\nsecond para");
    const ps = collect(richContent.nodes, "PARAGRAPH");
    expect(ps).toHaveLength(2);
    expect(ps[0].nodes[0].textData.text).toBe("line a line b");
  });

  it("builds a bulleted list of LIST_ITEMs", () => {
    const { richContent } = markdownToRicos("- one\n- two\n- three");
    const lists = collect(richContent.nodes, "BULLETED_LIST");
    expect(lists).toHaveLength(1);
    expect(collect(lists[0].nodes, "LIST_ITEM")).toHaveLength(3);
  });

  it("builds an ordered list separate from bullets", () => {
    const { richContent } = markdownToRicos("1. a\n2. b\n\n- c");
    expect(collect(richContent.nodes, "ORDERED_LIST")).toHaveLength(1);
    expect(collect(richContent.nodes, "BULLETED_LIST")).toHaveLength(1);
  });

  it("parses a markdown table into TABLE/TABLE_ROW/TABLE_CELL", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    const { richContent } = markdownToRicos(md);
    const tables = collect(richContent.nodes, "TABLE");
    expect(tables).toHaveLength(1);
    expect(collect(tables[0].nodes, "TABLE_ROW")).toHaveLength(3); // header + 2 body
    expect(collect(tables[0].nodes, "TABLE_CELL")).toHaveLength(6);
  });

  it("collects raw <figure>/<svg> HTML instead of embedding it", () => {
    const md = "intro\n\n<figure><img src=\"data:image/png;base64,AAAA\"/></figure>\n\noutro";
    const { richContent, skippedHtmlBlocks } = markdownToRicos(md);
    expect(skippedHtmlBlocks).toHaveLength(1);
    expect(skippedHtmlBlocks[0]).toContain("<figure>");
    // no raw html leaked into the node tree
    expect(JSON.stringify(richContent)).not.toContain("<figure>");
    expect(collect(richContent.nodes, "PARAGRAPH")).toHaveLength(2); // intro + outro
  });

  it("assigns a unique id to every non-TEXT node", () => {
    const { richContent } = markdownToRicos("# H\n\ntext with **b** and [l](https://x.io)\n\n- item");
    const ids: string[] = [];
    const walk = (ns: any[]) => {
      for (const n of ns) {
        if (n.type !== "TEXT") {
          expect(typeof n.id).toBe("string");
          expect(n.id.length).toBeGreaterThan(0);
          ids.push(n.id);
        }
        if (Array.isArray(n.nodes)) walk(n.nodes);
      }
    };
    walk(richContent.nodes);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});
