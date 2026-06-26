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
  function gatesFor(optBody: string, published: string, title: string) {
    const before = computeReadability(ORIG);
    const after = computeReadability(optBody);
    const budget = editorialChangeBudget({
      origBody: ORIG,
      optBody,
      origHeadings: [],
      origMetrics: before,
      optMetrics: after,
      claimsAdded: 0,
      claimsRemoved: 0,
      duplicateHeadingsRemoved: 0,
    });
    return evaluateEditorialGates({
      origBody: ORIG,
      optBody,
      origHeadings: [],
      published,
      title,
      before,
      after,
      report: budget,
      claimDiffPassed: true,
    });
  }

  it("fails the title gate when the published article does not open with the title", () => {
    const r = gatesFor(ORIG, "# Wrong Title\n\n" + ORIG, "Correct Title");
    expect(r.gates.find((g) => g.id === "title")?.pass).toBe(false);
    expect(r.publishReady).toBe(false);
  });

  it("passes the title gate when the title is preserved as the first heading", () => {
    const r = gatesFor(ORIG, "# Correct Title\n\n" + ORIG, "Correct Title");
    expect(r.gates.find((g) => g.id === "title")?.pass).toBe(true);
  });

  it("fails the generic-phrasing gate when AI slop is present", () => {
    const slop = ORIG + " In conclusion, this is a game-changer.";
    const r = gatesFor(slop, "# T\n\n" + slop, "T");
    expect(r.gates.find((g) => g.id === "generic")?.pass).toBe(false);
  });
});
