import { fetchRendered } from "./src/fetch.js";
import { extractArticle } from "./src/extract.js";
import { scoreOriginal, buildFixList } from "./src/score.js";
import { deriveConfig } from "./src/config.js";

// Debug the no-LLM half of the pipeline (fetch + extract + score + JSON-LD)
// without spending API quota. Usage: npm run inspect -- <url>
async function main() {
  const URL =
    process.argv[2] ||
    "https://www.trossenrobotics.com/post/the-physical-ai-deployment-blueprint-from-pilot-to-commercial-reality";
  const page = await fetchRendered(URL, { noCache: true });
  console.log("fetched:", page.html.length, "bytes, fromCache:", page.fromCache);
  const a = extractArticle(page);
  console.log("title:", a.title);
  console.log("headings:", a.headings.length, "| links:", a.links.length, "| existing JSON-LD:", a.existingJsonLd.length);
  a.headings.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));
  console.log("body words:", a.text.split(/\s+/).length);
  const scored = scoreOriginal(a, deriveConfig(a));
  console.log("baseline score:", scored.baselineScore + "/100");
}
main().catch((e) => { console.error("SMOKE ERROR:", e.message); process.exit(1); });
