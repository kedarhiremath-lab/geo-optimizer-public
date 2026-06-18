import { describe, it, expect } from "vitest";
import { claimDiff, _internal } from "../src/claimDiff.js";
import type { LlmProvider } from "../src/types.js";
import { claimExtractionPrompt } from "../src/prompts.js";

describe("claimDiff deterministic matcher", () => {
  it("treats a claim as supported when tokens overlap >= 70%", () => {
    expect(_internal.isSupported("Trossen SDK supports ROS 2", ["The Trossen SDK supports ROS 2 natively"])).toBe(true);
  });
  it("flags an unrelated claim as unsupported", () => {
    expect(_internal.isSupported("deployment takes 6 weeks", ["Trossen builds robot arms"])).toBe(false);
  });
});

// Fake provider returns canned claim arrays based on which text it was asked about.
function fakeProvider(map: Record<string, string[]>): LlmProvider {
  return {
    name: "fake",
    async complete(prompt: string) {
      const key = Object.keys(map).find((k) => prompt.includes(k));
      return JSON.stringify(key ? map[key] : []);
    },
  };
}

describe("claimDiff guardrail", () => {
  it("PASSES when rewrite adds no new facts", async () => {
    const p = fakeProvider({ "SRC": ["robots are useful", "Trossen SDK supports ROS 2"], "REW": ["Trossen SDK supports ROS 2"] });
    const r = await claimDiff(p, "SRC text", "REW text");
    expect(r.passed).toBe(true);
  });

  it("FAILS when rewrite invents a statistic (the reputational guardrail)", async () => {
    const p = fakeProvider({ "SRC": ["Trossen builds arms"], "REW": ["Trossen builds arms", "deployment is 10x faster than competitors"] });
    const r = await claimDiff(p, "SRC text", "REW text");
    expect(r.passed).toBe(false);
    expect(r.added.some((c) => c.includes("10x"))).toBe(true);
  });

  it("does NOT flag allowed [ADD STAT:] placeholders as invented facts", async () => {
    const p = fakeProvider({ "SRC": ["Trossen builds arms"], "REW": ["Trossen builds arms", "[ADD STAT: throughput source needed]"] });
    const r = await claimDiff(p, "SRC text", "REW text");
    expect(r.passed).toBe(true);
  });

  it("includes the frozen extraction instruction in its prompt", () => {
    expect(claimExtractionPrompt("hi")).toContain("ATOMIC FACTUAL CLAIM");
  });
});
