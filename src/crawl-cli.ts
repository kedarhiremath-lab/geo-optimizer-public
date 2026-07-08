// CLI: `npm run crawl` — print every blog post URL from the Trossen /news index.
// Useful on its own to see the full inventory before running the batch.

import { crawlPostUrls } from "./crawl.js";

async function main(): Promise<void> {
  const urls = await crawlPostUrls({ onProgress: (m) => console.error(m) });
  console.error(`\n${urls.length} post(s):`);
  for (const u of urls) console.log(u);
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
