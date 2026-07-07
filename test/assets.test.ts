import { describe, it, expect } from "vitest";
import { figureBlock, pickFigures, insertFigures, ensureDownloadsSection, contentHeadingTexts } from "../src/assets.js";
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

  it("appends (does not cluster at the top) when no heading matches", () => {
    const md = "## Intro\n\nbody one";
    const out = insertFigures(md, [sug("Nonexistent Section")]);
    // figure goes after the body, not jammed under Intro
    expect(out.indexOf("<figure>")).toBeGreaterThan(out.indexOf("body one"));
  });
});

describe("GEO-rewritten headings (regression: figures must not cluster at the top)", () => {
  // The model rewrote body headings for GEO; the original heading text no longer
  // appears. Figures must still land under the right (rewritten) sections.
  const md =
    "# Optimized Headline\n\n## The Short Version\n\n- a\n\n## What makes real-time control possible?\n\nbody one\n\n## How does ROS 2 help teams?\n\nbody two";

  it("contentHeadingTexts excludes the H1 title and engine scaffolding", () => {
    expect(contentHeadingTexts(md)).toEqual([
      "What makes real-time control possible?",
      "How does ROS 2 help teams?",
    ]);
  });

  it("anchors a model figure (referencing the ORIGINAL heading) to the rewritten heading", () => {
    const heads = contentHeadingTexts(md);
    const figs = pickFigures([sug("Real-time control")], heads, 2, 4);
    // the model's suggestion (original wording) is re-anchored to the rewritten heading
    expect(figs[0].section).toBe("What makes real-time control possible?");
  });

  it("inserts figures under the rewritten sections, not under 'The Short Version'", () => {
    const heads = contentHeadingTexts(md);
    const figs = pickFigures([sug("Real-time control")], heads, 2, 4);
    const out = insertFigures(md, figs);
    const shortIdx = out.indexOf("## The Short Version");
    const rtIdx = out.indexOf("## What makes real-time control possible?");
    // no figure was dumped between the Short Version and the first real section
    expect(out.slice(shortIdx, rtIdx).includes("<figure>")).toBe(false);
    // a figure sits under the rewritten real-time-control section
    expect(out.indexOf("<figure>")).toBeGreaterThan(rtIdx);
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
