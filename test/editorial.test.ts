import { describe, it, expect } from "vitest";
import {
  voicePreservationScore,
  genericAiPhrasesFound,
  compareHeadings,
  dedupeTitle,
  wordingPreservedPct,
  sentencesRewrittenPct,
  evaluateEditorialGates,
  editorialChangeBudget,
  headlineWellFormed,
  sectionStructurePreserved,
} from "../src/editorial.js";
import { computeReadability } from "../src/readability.js";

const ORIG =
  "The robotics pilot worked once in the lab. Moving it to production is the hard part because reliability matters far more than novelty. Teams that scale aggressively without discipline tend to fail when real-world constraints arrive.";

describe("voice preservation", () => {
  it("scores identical text as 100", () => {
    expect(voicePreservationScore(ORIG, ORIG)).toBe(100);
  });

  it("stays high (>=90) for a light editorial edit that keeps the author's words", () => {
    const lightEdit =
      "The robotics pilot worked once in the lab. Moving it to production is the hard part. Reliability matters far more than novelty. Teams that scale aggressively without discipline tend to fail when real-world constraints arrive.";
    expect(voicePreservationScore(ORIG, lightEdit)).toBeGreaterThanOrEqual(90);
  });

  it("drops for a full paraphrase that swaps the vocabulary", () => {
    const paraphrase =
      "Your prototype functioned a single time during testing. Transitioning toward deployment proves difficult since dependability outweighs innovation. Groups expanding hastily absent rigor collapse once practical limitations emerge.";
    expect(voicePreservationScore(ORIG, paraphrase)).toBeLessThan(80);
  });
});

describe("generic AI phrasing", () => {
  it("flags banned phrases", () => {
    const found = genericAiPhrasesFound("In conclusion, we delve into the topic when it comes to robots.");
    expect(found).toContain("in conclusion");
    expect(found).toContain("delve into");
    expect(found).toContain("when it comes to");
  });
  it("returns none for clean prose", () => {
    expect(genericAiPhrasesFound("The pilot worked once. Production is harder.")).toEqual([]);
  });
});

describe("heading preservation", () => {
  const origHeadings = ["Intro", "Details"];
  it("counts changed=0 when originals are preserved (engine-added headings ignored)", () => {
    const opt = "## Intro\n\nfoo\n\n## Details\n\nbar\n\n## Frequently Asked Questions\n\nq";
    const c = compareHeadings(origHeadings, opt);
    expect(c.changed).toBe(0);
    expect(c.preserved).toBe(2);
  });
  it("counts a renamed original heading as changed", () => {
    const opt = "## Introduction\n\nfoo\n\n## Details\n\nbar";
    const c = compareHeadings(origHeadings, opt);
    expect(c.changed).toBe(1);
    expect(c.preserved).toBe(1);
  });
});

describe("headlineWellFormed", () => {
  it("accepts a normal, question-shaped headline", () => {
    expect(headlineWellFormed("# How does ROS 2 power robot learning?\n\nbody")).toBe(true);
  });
  it("accepts a short product-name headline (no 6-char floor false-fail)", () => {
    expect(headlineWellFormed("# ROS 2 Guide\n\nbody")).toBe(true);
  });
  it("does NOT block a long, untouched original title (>100 chars)", () => {
    const long =
      "The Physical AI Deployment Blueprint: A Field Guide to Moving Robotics Pilots From the Lab to Reliable Commercial Production";
    expect(long.length).toBeGreaterThan(100);
    expect(headlineWellFormed("# " + long + "\n\nbody")).toBe(true);
  });
  it("rejects a missing/empty headline", () => {
    expect(headlineWellFormed("no heading at all, just prose")).toBe(false);
  });
  it("rejects a blatant keyword-stuffed headline (no connective words)", () => {
    expect(headlineWellFormed("# ROS 2 Robot Learning Guide Tutorial Tips Best Toolkit 2026\n\nbody")).toBe(false);
  });
});

describe("sectionStructurePreserved", () => {
  it("passes when headings are rewritten but the count holds", () => {
    const opt = "## How does ROS 2 help?\n\na\n\n## What about real-time control?\n\nb\n\n## Why open source?\n\nc";
    expect(sectionStructurePreserved(["Why ROS 2", "Real-time control", "Open source"], opt)).toBe(true);
  });
  it("fails when the model flattens 5 sections into 1", () => {
    expect(sectionStructurePreserved(["A", "B", "C", "D", "E"], "## Everything\n\nall of it")).toBe(false);
  });
  it("passes when the original had no headings", () => {
    expect(sectionStructurePreserved([], "## Anything\n\nx")).toBe(true);
  });
});

describe("title dedupe", () => {
  it("removes a duplicate H1 title and keeps the first", () => {
    const { md, removed } = dedupeTitle("# My Title\n\nbody\n\n# My Title\n\nmore", "My Title");
    expect(removed).toBe(1);
    expect(md.match(/# My Title/g)?.length).toBe(1);
  });
});

describe("diff metrics", () => {
  it("100% wording preserved for identical text", () => {
    expect(wordingPreservedPct(ORIG, ORIG)).toBe(100);
  });
  it("0% sentences rewritten for identical text", () => {
    expect(sentencesRewrittenPct(ORIG, ORIG)).toBe(0);
  });
});

describe("editorial gates", () => {
  function gatesFor(optBody: string, published: string, title: string, origHeadings: string[] = []) {
    const before = computeReadability(ORIG);
    const after = computeReadability(optBody);
    const budget = editorialChangeBudget({
      origBody: ORIG,
      optBody,
      origHeadings,
      origMetrics: before,
      optMetrics: after,
      claimsAdded: 0,
      claimsRemoved: 0,
      duplicateHeadingsRemoved: 0,
      title,
    });
    return evaluateEditorialGates({
      origBody: ORIG,
      optBody,
      origHeadings,
      published,
      title,
      before,
      after,
      report: budget,
      claimDiffPassed: true,
    });
  }

  it("fails the headline gate when the published article has no visible H1", () => {
    const r = gatesFor(ORIG, ORIG, "Some Title"); // published has no # heading at all
    expect(r.gates.find((g) => g.id === "title")?.pass).toBe(false);
    expect(r.publishReady).toBe(false);
  });

  it("passes the headline gate when a well-formed H1 is present (even if rephrased for GEO)", () => {
    const r = gatesFor(ORIG, "# A Clear, Optimized Headline\n\n" + ORIG, "A Clear, Optimized Headline");
    expect(r.gates.find((g) => g.id === "title")?.pass).toBe(true);
  });

  it("passes section-structure when subtitles are rewritten (even into questions) but none are dropped", () => {
    const orig = ["Why ROS 2 matters", "Real-time control", "Bridging academia and industry"];
    const optBody =
      "## How does ROS 2 power robot learning?\n\na\n\n## What makes real-time control possible?\n\nb\n\n## How does ROS 2 bridge academia and industry?\n\nc";
    const r = gatesFor(optBody, "# Optimized Headline\n\n" + optBody, "Optimized Headline", orig);
    expect(r.gates.find((g) => g.id === "subtitles")?.pass).toBe(true);
  });

  it("fails section-structure when the model flattens many sections into one", () => {
    const orig = ["A section", "B section", "C section", "D section", "E section"];
    const optBody = "## Everything at once\n\nall of it in one block";
    const r = gatesFor(optBody, "# Optimized Headline\n\n" + optBody, "Optimized Headline", orig);
    expect(r.gates.find((g) => g.id === "subtitles")?.pass).toBe(false);
  });

  it("fails the generic-phrasing gate when AI slop is present", () => {
    const slop = ORIG + " In conclusion, this is a game-changer.";
    const r = gatesFor(slop, "# A Clear Headline\n\n" + slop, "A Clear Headline");
    expect(r.gates.find((g) => g.id === "generic")?.pass).toBe(false);
  });
});
