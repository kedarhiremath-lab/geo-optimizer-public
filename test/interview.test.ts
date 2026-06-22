import { describe, it, expect } from "vitest";
import { INTERVIEW_LENSES, formatAnswers, hasAnswers } from "../src/interview.js";
import { articleBodyPrompt, structuredMetaPrompt } from "../src/prompts.js";
import { TROSSEN_BLUEPRINT_CONFIG } from "../src/config.js";
import type { Article } from "../src/types.js";

describe("interview lenses", () => {
  it("covers the five chosen gstack skills", () => {
    const skills = INTERVIEW_LENSES.map((l) => l.skill).sort();
    expect(skills).toEqual(
      ["office-hours", "plan-ceo-review", "plan-design-review", "plan-devex-review", "spec"].sort(),
    );
  });

  it("every question has a unique id", () => {
    const ids = INTERVIEW_LENSES.flatMap((l) => l.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("formatAnswers / hasAnswers", () => {
  it("hasAnswers is false for empty/blank input", () => {
    expect(hasAnswers(undefined)).toBe(false);
    expect(hasAnswers({})).toBe(false);
    expect(hasAnswers({ oh_reader: "   " })).toBe(false);
  });
  it("formats only answered questions, grouped by lens", () => {
    const out = formatAnswers({ oh_reader: "R&D leads", spec_constraints: "under 1500 words" });
    expect(out).toContain("Audience & Purpose (office-hours)");
    expect(out).toContain("R&D leads");
    expect(out).toContain("Hard Requirements (spec)");
    expect(out).not.toContain("Thesis & Differentiation"); // no answers there
  });
});

describe("rewritePrompt weaves in answers", () => {
  const article: Article = {
    url: "https://x", title: "t", text: "body", content: "body",
    headings: [], links: [], existingJsonLd: [], meta: {},
  };
  it("weaves the editorial direction into both prompts when answers given", () => {
    const body = articleBodyPrompt(article, TROSSEN_BLUEPRINT_CONFIG, [], { oh_takeaway: "start narrow" });
    const meta = structuredMetaPrompt(article, TROSSEN_BLUEPRINT_CONFIG, { oh_takeaway: "start narrow" });
    expect(body).toContain("AUTHOR'S EDITORIAL DIRECTION");
    expect(body).toContain("start narrow");
    expect(meta).toContain("start narrow");
  });
  it("omits the direction block when no answers", () => {
    expect(articleBodyPrompt(article, TROSSEN_BLUEPRINT_CONFIG, [])).not.toContain("AUTHOR'S EDITORIAL DIRECTION");
  });
});
