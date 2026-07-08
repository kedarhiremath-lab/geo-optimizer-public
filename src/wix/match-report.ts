// Read-only coverage check: crawl every /news post, list every Wix draft, and
// report which posts map to which existing article by slug. Makes ZERO writes
// and ZERO LLM calls — run it before any --push to see what will match cleanly
// and what needs a manual override.
//
//   npm run wix:match

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { crawlPostUrls } from "../crawl.js";
import { WixClient, wixConfigFromEnv, matchDraft, slugFromUrl } from "./client.js";

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
  const cfg = wixConfigFromEnv();
  if (!cfg) {
    console.error("Need WIX_API_KEY and WIX_SITE_ID in .env.");
    process.exit(1);
  }
  const wix = new WixClient(cfg);

  console.error("Listing Wix draft posts…");
  const drafts = await wix.listAllDraftPosts();
  console.error(`  ${drafts.length} drafts.`);
  console.error("Crawling /news…");
  const urls = await crawlPostUrls({ onProgress: (m) => console.error("  " + m) });
  console.error(`  ${urls.length} posts.\n`);

  let matched = 0;
  const unmatched: string[] = [];
  for (const url of urls) {
    const m = matchDraft({ url }, drafts);
    if (m.draftId) {
      matched++;
      const d = drafts.find((x) => x.id === m.draftId);
      const dupe = m.candidates && m.candidates > 1 ? `  ⚠ ${m.candidates} candidates` : "";
      console.log(`✓ ${slugFromUrl(url)}  ->  "${(d?.title ?? "").slice(0, 55)}" [${m.strategy}]${dupe}`);
    } else {
      unmatched.push(url);
      console.log(`✗ ${slugFromUrl(url)}  ->  NO MATCH`);
    }
  }

  console.log(`\n=== ${matched}/${urls.length} matched by slug; ${unmatched.length} unmatched ===`);
  if (unmatched.length) {
    console.log("Unmatched (need a manual slug->draftId override, or the post isn't a Wix blog post):");
    for (const u of unmatched) console.log("  " + u);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
