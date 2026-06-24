import { describe, it, expect } from "vitest";
import { extractArticle, ExtractionError } from "../src/extract.js";
import type { RenderedPage } from "../src/types.js";

const goodHtml = `<!doctype html><html><head>
  <title>Physical AI Deployment Blueprint</title>
  <meta name="description" content="From pilot to commercial reality.">
  <script type="application/ld+json">{"@type":"BlogPosting","headline":"X"}</script>
  </head><body><article>
  <h1>The Physical AI Deployment Blueprint</h1>
  <p>Moving a robotics pilot to production requires data infrastructure, ${"and clear milestones. ".repeat(20)}</p>
  <h2>Pilot to production</h2>
  <p>${"Trossen Robotics builds research arms. ".repeat(20)}</p>
  <h3>Data collection</h3>
  <p>${"The Trossen SDK supports ROS 2 and LeRobot. ".repeat(20)}</p>
  <a href="https://www.trossenrobotics.com/sdk">SDK</a>
  <a href="https://ros.org">ROS</a>
  </article></body></html>`;

function page(html: string): RenderedPage {
  return { url: "https://www.trossenrobotics.com/post/x", html, fromCache: false };
}

describe("extractArticle", () => {
  it("extracts title, headings, links, existing JSON-LD", () => {
    const a = extractArticle(page(goodHtml));
    expect(a.title).toContain("Physical AI Deployment Blueprint");
    expect(a.headings.length).toBeGreaterThanOrEqual(3);
    expect(a.links).toContain("https://www.trossenrobotics.com/sdk");
    expect(a.links).toContain("https://ros.org");
    expect(a.existingJsonLd.length).toBe(1);
    expect(a.meta.description).toBe("From pilot to commercial reality.");
  });

  it("accepts a thin-but-real article even with only one heading (optimizer fixes structure)", () => {
    const oneHeading = `<!doctype html><html><head><title>t</title></head><body><article>
      <h1>Only one heading</h1><p>${"word ".repeat(300)}</p></article></body></html>`;
    const a = extractArticle(page(oneHeading));
    expect(a.text.split(/\s+/).length).toBeGreaterThan(250);
  });

  it("fails loud only when no real article content can be recovered", () => {
    const empty = `<!doctype html><html><head><title>t</title></head><body><nav>Home About</nav><p>tiny</p></body></html>`;
    expect(() => extractArticle(page(empty))).toThrow(ExtractionError);
  });

  it("captures body copy rendered in divs/spans (Wix-style, no <p> tags)", () => {
    const wix = `<!doctype html><html><head><title>Wix Post</title></head><body><main>
      <h1>Wix Post</h1>
      ${Array.from({ length: 16 }, (_, i) => `<div>This is a substantial paragraph of real article body copy number ${i} that Wix renders inside a div element rather than a paragraph tag, with enough words to count.</div>`).join("")}
    </main></body></html>`;
    const a = extractArticle(page(wix));
    expect(a.text.split(/\s+/).length).toBeGreaterThan(250);
    expect(a.text).toContain("substantial paragraph");
  });
});
