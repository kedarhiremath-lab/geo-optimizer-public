import { describe, it, expect } from "vitest";
import {
  readingTimeMin,
  avgParagraphLength,
  readingFriction,
  splitParagraphs,
  paragraphDensityPct,
  computeReadability,
} from "../src/readability.js";

describe("readability metrics", () => {
  it("estimates reading time at ~200 wpm", () => {
    const text = Array(200).fill("word").join(" ");
    expect(readingTimeMin(text)).toBeCloseTo(1.0, 1);
  });

  it("computes average prose-paragraph length", () => {
    const md = `${Array(10).fill("alpha").join(" ")}\n\n${Array(20).fill("beta").join(" ")}`;
    expect(avgParagraphLength(md)).toBe(15); // (10 + 20) / 2
  });

  it("excludes headings and tables from prose paragraphs", () => {
    const md = "## Heading\n\nReal paragraph here with words.\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const paras = splitParagraphs(md);
    expect(paras.length).toBe(1);
    expect(paras[0]).toContain("Real paragraph");
  });

  it("scores denser, longer-worded text as higher friction", () => {
    const easy = "The dog ran. It was fun. We all sat down. The sun was out.";
    const hard =
      "Notwithstanding the aforementioned considerations, the implementation necessitates comprehensive architectural deliberation regarding multifaceted infrastructural dependencies and their concomitant ramifications.";
    expect(readingFriction(hard)).toBeGreaterThan(readingFriction(easy));
  });

  it("flags dense paragraphs (>80 words)", () => {
    const dense = Array(90).fill("word").join(" ");
    const light = Array(20).fill("word").join(" ");
    expect(paragraphDensityPct(dense)).toBe(100);
    expect(paragraphDensityPct(light)).toBe(0);
  });

  it("returns a full metrics object", () => {
    const m = computeReadability("A short paragraph.\n\nAnother one here.");
    expect(m).toHaveProperty("readingFriction");
    expect(m).toHaveProperty("cognitiveLoad");
    expect(m).toHaveProperty("readingTimeMin");
    expect(m).toHaveProperty("avgParagraphLength");
    expect(m).toHaveProperty("paragraphDensityPct");
  });
});
