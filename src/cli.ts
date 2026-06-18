// CLI entry: `npm run optimize -- <url>`
// Loads .env, runs the pipeline, prints a readable report.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { optimize } from "./optimize.js";
import { GeminiProvider } from "./llm.js";

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
  const provider = new GeminiProvider();
  console.error(`Optimizing ${url} via ${provider.name}…`);
  const r = await optimize(url, provider);

  console.log(`\n=== ${r.url} ===`);
  console.log(`Baseline GEO/SEO score: ${r.baselineScore}/100`);
  console.log(`Safe to use: ${r.safe ? "YES" : "NO — review flags below"}`);

  console.log(`\n--- Prioritized fix-list ---`);
  r.fixList.forEach((f, i) => console.log(`${i + 1}. [p${f.priority}] ${f.label}: ${f.recommendation}`));

  if (!r.claimDiff.passed) {
    console.log(`\n!!! FACT-PRESERVATION FAIL — rewrite added unsupported claims:`);
    r.claimDiff.added.forEach((c) => console.log(`   - ${c}`));
  }
  if (r.jsonLdNotes.length) {
    console.log(`\n--- JSON-LD notes ---`);
    r.jsonLdNotes.forEach((n) => console.log(`   - ${n}`));
  }

  console.log(`\n--- JSON-LD (${r.jsonLdValid ? "valid" : "INVALID"}) ---`);
  console.log(JSON.stringify(r.jsonLd, null, 2));

  console.log(`\n--- Rewritten draft ---\n`);
  console.log(r.rewrittenDraft);
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
