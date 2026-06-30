import { describe, it, expect } from "vitest";
import { figureBlock, pickFigures, insertFigures, ensureDownloadsSection } from "../src/assets.js";
import type { ImageSuggestion } from "../src/types.js";

const sug = (section: string): ImageSuggestion => ({
  section,
  alt: `alt for ${section}`,
  caption: `caption for ${section}`,
  prompt: `prompt for ${section}`,
});

describe("figureBlock", () => {
  it("emits a machine-readable <figure> with escaped alt + caption", () => {
    const b = figureBlock({ section: "s", alt: 'shows a "scorecard" <table>', caption: "Cost & ROI", prompt: "p" });
    expect(b).toContain("<figure>");
    expect(b).toContain("<figcaption>");
    expect(b).toContain("&quot;scorecard&quot;");
    expect(b).toContain("&lt;table&gt;");
    expect(b).toContain("Cost &amp; ROI");
  });
});

describe("pickFigures", () => {
  const headings = ["Intro", "Details", "Third", "Fourth", "Fifth"];

  it("always returns the requested count, synthesizing when the model gave fewer", () => {
    const figs = pickFigures([sug("Details")], headings, 2, 4);
    expect(figs.length).toBe(2);
    expect(figs.some((f) => f.section === "Details")).toBe(true);
  });

  it("only draws from the first N sections", () => {
    const figs = pickFigures([], headings, 2, 4);
    expect(figs.length).toBe(2);
    expect(figs.every((f) => ["Intro", "Details", "Third", "Fourth"].includes(f.section))).toBe(true);
  });

  it("synthesized figures carry alt + caption + prompt", () => {
    const figs = pickFigures([], headings, 2, 4);
    for (const f of figs) {
      expect(f.alt.length).toBeGreaterThan(0);
      expect(f.caption.length).toBeGreaterThan(0);
      expect(f.prompt.length).toBeGreaterThan(0);
    }
  });
});

describe("insertFigures", () => {
  it("inserts the figure right after its matching heading", () => {
    const md = "## Intro\n\nbody one\n\n## Details\n\nbody two";
    const out = insertFigures(md, [sug("Details")]);
    expect(out).toContain("<figure>");
    expect(out.indexOf("<figure>")).toBeGreaterThan(out.indexOf("## Details"));
    expect(out.indexOf("<figure>")).toBeLessThan(out.indexOf("body two"));
  });
});

describe("ensureDownloadsSection", () => {
  it("appends a Downloads section for assets not already in the article", () => {
    const out = ensureDownloadsSection("body text", ["https://x.com/readiness-scorecard.pdf"]);
    expect(out).toContain("## Downloads");
    expect(out).toContain("readiness-scorecard.pdf".replace(".pdf", "")); // link text derived from filename
    expect(out).toContain("https://x.com/readiness-scorecard.pdf");
  });
  it("does nothing when there are no downloads", () => {
    expect(ensureDownloadsSection("body", [])).toBe("body");
  });
  it("does not duplicate an asset already linked in the article", () => {
    const md = "see https://x.com/file.pdf for details";
    expect(ensureDownloadsSection(md, ["https://x.com/file.pdf"])).not.toContain("## Downloads");
  });
});
