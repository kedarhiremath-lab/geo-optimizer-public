import { describe, it, expect } from "vitest";
import { claimDiff, _internal } from "../src/claimDiff.js";
import type { LlmProvider } from "../src/types.js";
import { claimExtractionPrompt } from "../src/prompts.js";

describe("claimDiff deterministic matcher (against source text)", () => {
  it("treats a claim as supported when its words are present in the source text", () => {
    const src = _internal.tokens("The Trossen SDK supports ROS 2 natively for robot arms");
    expect(_internal.isSupportedByText("Trossen SDK supports ROS 2", src)).toBe(true);
  });
  it("flags a claim whose words are absent from the source", () => {
    const src = _internal.tokens("Trossen builds robot arms");
    expect(_internal.isSupportedByText("deployment takes 6 weeks and is 10x faster", src)).toBe(false);
  });
});

// Fake provider returns canned claims for the REWRITE extraction call only.
function fakeProvider(rewriteClaims: string[]): LlmProvider {
  return { name: "fake", async complete() { return JSON.stringify(rewriteClaims); } };
}

describe("claimDiff guardrail", () => {
  const SOURCE = "Trossen builds robot arms. The Trossen SDK supports ROS 2 and LeRobot.";

  it("PASSES when every rewrite claim is grounded in the source text", async () => {
    const r = await claimDiff(fakeProvider(["Trossen SDK supports ROS 2"]), SOURCE, "rewrite");
    expect(r.passed).toBe(true);
  });

  it("FAILS when rewrite invents a statistic (the reputational guardrail)", async () => {
    const r = await claimDiff(fakeProvider(["deployment is 10x faster than competitors"]), SOURCE, "rewrite");
    expect(r.passed).toBe(false);
    expect(r.added.some((c) => c.includes("10x"))).toBe(true);
  });

  it("does NOT flag allowed [ADD STAT:] placeholders as invented facts", async () => {
    const r = await claimDiff(fakeProvider(["[ADD STAT: throughput source needed]"]), SOURCE, "rewrite");
    expect(r.passed).toBe(true);
  });

  it("does NOT flag leaked page chrome (e.g. '25 min read', 'Jun 8')", async () => {
    const r = await claimDiff(fakeProvider(["25 min read", "Jun 8"]), SOURCE, "rewrite");
    expect(r.passed).toBe(true);
  });

  it("includes the frozen extraction instruction in its prompt", () => {
    expect(claimExtractionPrompt("hi")).toContain("ATOMIC FACTUAL CLAIM");
  });
});
