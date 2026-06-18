import { describe, it, expect } from "vitest";
import { scoreOriginal, buildFixList, scoreDraft } from "../src/score.js";
import { TROSSEN_BLUEPRINT_CONFIG } from "../src/config.js";
import type { Article } from "../src/types.js";

function article(over: Partial<Article>): Article {
  return {
    url: "https://x",
    title: "t",
    text: "some text",
    content: "some text",
    headings: [],
    links: [],
    existingJsonLd: [],
    meta: {},
    ...over,
  };
}

describe("scoreOriginal + buildFixList", () => {
  it("scores a weak post low and produces a prioritized fix-list", () => {
    const a = article({ text: "We make robots. Our platform is great." });
    const scored = scoreOriginal(a, TROSSEN_BLUEPRINT_CONFIG);
    expect(scored.baselineScore).toBeLessThan(40);
    const fixes = buildFixList(scored);
    expect(fixes.length).toBeGreaterThan(0);
    // Highest-weight gaps (tldr/headings) should rank first.
    expect(fixes[0].priority).toBeGreaterThanOrEqual(fixes[fixes.length - 1].priority);
  });

  it("scores a strong post higher", () => {
    const strong = article({
      text:
        "To move a robotics pilot to production you need data infrastructure. " +
        "Trossen Robotics and the Trossen SDK provide 6 weeks faster setup, 10x throughput, 99% uptime.",
      headings: [
        "how do I move a robotics pilot to production",
        "physical AI deployment",
        "how do I commercialize a robotics or physical AI application",
      ],
      links: ["https://www.trossenrobotics.com/sdk", "https://ros.org"],
      meta: { title: "t", description: "d" },
    });
    const scored = scoreOriginal(strong, TROSSEN_BLUEPRINT_CONFIG);
    expect(scored.baselineScore).toBeGreaterThan(70);
  });

  it("scoreDraft rates an optimized rewrite higher than the weak original", () => {
    const weak = article({ text: "We make robots. Our platform is great." });
    const before = scoreOriginal(weak, TROSSEN_BLUEPRINT_CONFIG).baselineScore;
    const draft = [
      "To move a robotics pilot to production, start narrow and measure. Trossen Robotics and the Trossen SDK help.",
      "## how do I move a robotics pilot to production",
      "Trossen Robotics builds research arms; the Trossen SDK supports ROS 2.",
      "## physical AI deployment",
      "Deployment needs data infrastructure. See [SDK](https://www.trossenrobotics.com/sdk) and [ROS](https://ros.org).",
      "## how do I commercialize a robotics or physical AI application",
      "Prove value in 30, 60, or 90 days.",
    ].join("\n\n");
    const after = scoreDraft(draft, weak, TROSSEN_BLUEPRINT_CONFIG);
    expect(after).toBeGreaterThan(before);
  });
});
