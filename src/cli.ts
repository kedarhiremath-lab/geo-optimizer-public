// CLI entry: `npm run optimize -- <url>`
// Loads .env, runs the pipeline, prints a readable report.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { optimize } from "./optimize.js";
import { createProvider } from "./llm.js";

// Minimal .env loader (avoid a dependency for one file).
function loadEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run optimize -- <post-url>");
    process.exit(1);
  }
  const provider = createProvider();
  console.error(`Optimizing ${url} via ${provider.name}…`);
  const r = await optimize(url, provider);

  console.log(`\n=== ${r.url} ===`);
  console.log(`GEO/SEO score: ${r.baselineScore} (original) -> ${r.modelScore} (model rewrite) -> ${r.optimizedScore}/100 (fully optimized)`);
  console.log(`Safe to use: ${r.safe ? "YES" : "NO — review flags below"}`);

  if (r.editorial) {
    const e = r.editorial, b = e.budget;
    console.log(`\n--- Editorial Preservation Mode ---`);
    console.log(`Publish-ready: ${e.publishReady ? "YES" : "NO"}`);
    if (!e.publishReady) e.doNotPublishReasons.forEach((x) => console.log(`   ✗ ${x}`));
    console.log(`Reading friction: ${e.before.readingFriction} -> ${e.after.readingFriction} | cognitive load: ${e.before.cognitiveLoad} -> ${e.after.cognitiveLoad}`);
    console.log(`Reading time: ${e.before.readingTimeMin} -> ${e.after.readingTimeMin} min | avg paragraph: ${e.before.avgParagraphLength} -> ${e.after.avgParagraphLength} words`);
    console.log(`Voice preservation: ${b.voicePreservationScore}/100 | wording preserved: ${b.wordingPreservedPct}% | sentences rewritten: ${b.sentencesRewrittenPct}%`);
    console.log(`Headings preserved/changed: ${b.headingsPreserved}/${b.headingsChanged} | dupes removed: ${b.duplicateHeadingsRemoved} | claims added/removed: ${b.claimsAdded}/${b.claimsRemoved}`);
  }

  if (r.scoreExplain) {
    const se = r.scoreExplain;
    console.log(`\n--- Score explainer (deterministic rubric) ---`);
    se.signals.forEach((s) => console.log(`   ${s.earned}/${s.max}  ${s.label} (${s.note})`));
    console.log(`Highest-leverage changes left:`);
    se.topImprovements.forEach((t) => console.log(`   +${t.gain} ${t.how}`));
    if (se.sourceLimited.length) console.log(`Source-limited: ${se.sourceLimited.join(", ")}`);
  }

  console.log(`\n--- Assets ---`);
  console.log(`Figures generated: ${r.content.imageSuggestions?.length ?? 0} | downloads preserved: ${r.sourceDownloads.length} | rewrite has <figure>: ${/<figure>/.test(r.rewrittenDraft)} | has Sources section: ${/##\s+Sources/i.test(r.rewrittenDraft)}`);

  console.log(`\n--- Prioritized fix-list ---`);
  r.fixList.forEach((f, i) => console.log(`${i + 1}. [p${f.priority}] ${f.label}: ${f.recommendation}`));

  if (!r.claimDiff.passed) {
    console.log(`\n!!! FACT-PRESERVATION FAIL — rewrite added unsupported claims:`);
    r.claimDiff.added.forEach((c) => console.log(`   - ${c}`));
  }

  console.log(`\n--- Short Version ---`);
  r.content.shortVersion.forEach((s, i) => console.log(`${i + 1}. ${s}`));
  console.log(`\n--- Who this is for ---`);
  r.content.whoThisIsFor.forEach((s) => console.log(`   - ${s}`));
  console.log(`\n--- Metadata ---`);
  console.log(`title: ${r.content.metadata.title}`);
  console.log(`description: ${r.content.metadata.metaDescription}`);
  console.log(`slug: ${r.content.metadata.slug}`);
  console.log(`tags: ${r.content.metadata.tags.join(", ")}`);
  console.log(`\n--- FAQ (${r.content.faq.length}) ---`);
  r.content.faq.forEach((f) => console.log(`Q: ${f.q}`));
  if (r.schemaNotes.length) {
    console.log(`\n--- Schema notes ---`);
    r.schemaNotes.forEach((n) => console.log(`   - ${n}`));
  }
  console.log(`\n--- JSON-LD (${r.schemas.length} blocks) ---`);
  console.log(JSON.stringify(r.schemas, null, 2));

  console.log(`\n--- Optimized article ---\n`);
  console.log(r.content.articleMarkdown);
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
