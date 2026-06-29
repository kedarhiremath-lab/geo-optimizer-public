import { describe, it, expect } from "vitest";
import { explainScore, scoreGranular } from "../src/score.js";
import { traceInterview } from "../src/trace.js";
import type { Article, OptimizerConfig } from "../src/types.js";

const config: OptimizerConfig = {
  entities: ["Trossen Robotics", "Trossen SDK"],
  primaryQueries: ["physical ai deployment"],
  secondaryQueries: [],
  geoPanel: [],
};

function article(p: Partial<Article>): Article {
  return { url: "", title: "T", text: "", content: "", headings: [], links: [], existingJsonLd: [], meta: {}, ...p };
}

describe("explainScore", () => {
  it("breaks the score into 12 signals whose total matches scoreGranular", () => {
    const a = article({ text: "Physical AI deployment with Trossen Robotics and the Trossen SDK." });
    const ex = explainScore(a, config, { faqCount: 2, schemaCount: 3 });
    expect(ex.signals.length).toBe(12);
    expect(ex.total).toBe(scoreGranular(a, config, { faqCount: 2, schemaCount: 3 }));
  });

  it("ranks the highest-leverage improvements by point gap and gives a how", () => {
    const a = article({ text: "thin article" });
    const ex = explainScore(a, config, {});
    expect(ex.topImprovements.length).toBeGreaterThan(0);
    // sorted descending by gain
    for (let i = 1; i < ex.topImprovements.length; i++) {
      expect(ex.topImprovements[i - 1].gain).toBeGreaterThanOrEqual(ex.topImprovements[i].gain);
    }
    expect(ex.topImprovements[0].how.length).toBeGreaterThan(0);
  });
});

describe("interview traceability", () => {
  const optimized =
    "Physical AI is ready for deployment if you pick the right narrow task. Trossen Robotics brings real deployment experience.";

  it("traces a CEO-lens answer that landed as applied", () => {
    const trace = traceInterview(
      { ceo_thesis: "Physical AI is ready for deployment if you pick the right narrow task" },
      optimized,
    );
    const ceo = trace.find((l) => l.skill === "plan-ceo-review")!;
    expect(ceo.used).toBe(true);
    expect(ceo.items[0].applied).toBe("yes");
  });

  it("marks an answer whose terms are absent as not applied", () => {
    const trace = traceInterview({ ceo_unique: "proprietary quantum teleportation lattice nobody else mentions" }, optimized);
    const ceo = trace.find((l) => l.skill === "plan-ceo-review")!;
    expect(ceo.items[0].applied).toBe("no");
  });

  it("marks 'what to cut' as directional (not verifiable by presence)", () => {
    const trace = traceInterview({ ceo_cut: "the long history-of-AI preamble" }, optimized);
    const ceo = trace.find((l) => l.skill === "plan-ceo-review")!;
    expect(ceo.items[0].applied).toBe("directional");
  });

  it("reports every lens as unused when no answers are provided", () => {
    const trace = traceInterview(undefined, "some text");
    expect(trace.every((l) => !l.used)).toBe(true);
    expect(trace.find((l) => l.skill === "plan-ceo-review")).toBeTruthy();
  });
});
