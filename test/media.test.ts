import { describe, it, expect } from "vitest";
import { extractMediaNodes, interleaveMedia } from "../src/wix/media.js";
import type { RicosDocument, RicosNode } from "../src/wix/ricos.js";

const img = (id: string): RicosNode => ({ type: "IMAGE", id, imageData: { image: { src: { id } } } } as any);
const h = (id: string): RicosNode => ({ type: "HEADING", id, nodes: [], headingData: { level: 2, textStyle: { textAlignment: "AUTO" } } });
const p = (id: string): RicosNode => ({ type: "PARAGRAPH", id, nodes: [] });

describe("extractMediaNodes", () => {
  it("pulls IMAGE/VIDEO/FILE nodes and ignores text blocks", () => {
    const doc: RicosDocument = {
      nodes: [p("p1"), img("i1"), h("h1"), { type: "VIDEO", id: "v1" } as any, { type: "FILE", id: "f1" } as any],
    };
    const media = extractMediaNodes(doc);
    expect(media.map((m) => m.type)).toEqual(["IMAGE", "VIDEO", "FILE"]);
  });

  it("returns [] for a doc with no media", () => {
    expect(extractMediaNodes({ nodes: [p("p1"), h("h1")] })).toEqual([]);
  });
});

describe("interleaveMedia", () => {
  it("returns the doc unchanged when there is no media", () => {
    const doc: RicosDocument = { nodes: [h("h1"), p("p1")] };
    expect(interleaveMedia(doc, [])).toBe(doc);
  });

  it("inserts media before headings and preserves all original nodes", () => {
    const optimized: RicosDocument = { nodes: [p("intro"), h("h1"), p("a"), h("h2"), p("b"), h("h3"), p("c")] };
    const out = interleaveMedia(optimized, [img("i1"), img("i2")], "m");
    const types = out.nodes.map((n) => n.type);
    // every original node still present
    expect(types.filter((t) => t !== "IMAGE").length).toBe(optimized.nodes.length);
    // both images were inserted
    expect(types.filter((t) => t === "IMAGE").length).toBe(2);
    // each image sits immediately before a heading
    out.nodes.forEach((n, i) => {
      if (n.type === "IMAGE") expect(out.nodes[i + 1]?.type).toBe("HEADING");
    });
  });

  it("re-ids cloned media so ids stay unique in the merged doc", () => {
    const optimized: RicosDocument = { nodes: [h("h1"), p("p1"), h("h2")] };
    const out = interleaveMedia(optimized, [img("dup"), img("dup")], "m");
    const ids = out.nodes.filter((n) => n.type === "IMAGE").map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("dup");
  });

  it("appends media at the end when there are no headings", () => {
    const optimized: RicosDocument = { nodes: [p("p1"), p("p2")] };
    const out = interleaveMedia(optimized, [img("i1")], "m");
    expect(out.nodes[out.nodes.length - 1].type).toBe("IMAGE");
  });
});
