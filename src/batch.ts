// Batch orchestrator — automate the whole manual flow for every blog post.
//
//   crawl /news  ->  optimize each post  ->  markdown -> Ricos  ->  write Wix draft
//
// Replaces the by-hand loop: copy a post URL, paste into the optimizer, generate,
// "Copy for Wix", find the article in Wix Studio, paste, publish.
//
// SAFETY:
//   * Dry-run is the DEFAULT. It crawls, optimizes, converts, and writes each
//     result to ./out/<slug>.{json,md,ricos.json} locally. It makes ZERO Wix
//     calls, so you can review everything before anything touches the site.
//   * Pass --push to write the optimized body into each post's Wix DRAFT
//     (status UNPUBLISHED). The live post is NOT changed. You review each draft
//     in the Wix dashboard and click Publish yourself. Nothing auto-publishes.
//
// Usage:
//   npm run batch                 # dry-run: optimize all posts -> ./out
//   npm run batch -- --push       # also write Wix drafts (needs WIX_* in .env)
//   npm run batch -- --limit 3    # only the first 3 posts (good for a test run)
//   npm run batch -- --url <u>    # a single explicit post URL (repeatable)
//   npm run batch -- --from 2024-03-26 --to 2024-09-13   # only posts whose Wix
//       "Published date" (site timezone) falls in the range; needs WIX_* creds.
//       Date-scoped runs match drafts by exact post id (no slug guessing).
//   npm run batch -- --remote https://geo-optimizer-j5sc.onrender.com ...
//       Optimize THROUGH the deployed app's /api/optimize instead of locally.
//       Every result is then saved in the app's "Saved GEO-optimized articles"
//       dashboard (durable repository) with a shareable /r/<id> link.

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { crawlPostUrls } from "./crawl.js";
import { optimize } from "./optimize.js";
import { createProvider } from "./llm.js";
import { markdownToRicos } from "./wix/ricos.js";
import { extractMediaNodes, interleaveMedia } from "./wix/media.js";
import { WixClient, wixConfigFromEnv, matchDraft, slugFromUrl, type DraftPost } from "./wix/client.js";

function loadEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

interface Args {
  push: boolean;
  limit?: number;
  urls: string[];
  outDir: string;
  overridesPath?: string;
  from?: string; // YYYY-MM-DD, inclusive (Wix "Published date", site timezone)
  to?: string; // YYYY-MM-DD, inclusive
  remote?: string; // base URL of a deployed optimizer; results save to its dashboard
  resume?: boolean; // skip posts whose <slug>.meta.json already exists (crash recovery)
}

function parseArgs(argv: string[]): Args {
  const a: Args = { push: false, urls: [], outDir: join(process.cwd(), "out") };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--push") a.push = true;
    else if (t === "--limit") a.limit = Number(argv[++i]);
    else if (t === "--url") a.urls.push(argv[++i]);
    else if (t === "--out") a.outDir = argv[++i];
    else if (t === "--overrides") a.overridesPath = argv[++i];
    else if (t === "--from") a.from = argv[++i];
    else if (t === "--to") a.to = argv[++i];
    else if (t === "--remote") a.remote = argv[++i].replace(/\/$/, "");
    else if (t === "--resume") a.resume = true;
  }
  return a;
}

/** Result shape returned by the deployed app (OptimizeResult + savedUrl). The
 * deployed build may predate the originalTitle field, so it's optional here. */
type RemoteResult = Awaited<ReturnType<typeof optimize>> & { savedUrl?: string; servedFromCache?: boolean };

/** Optimize via a deployed optimizer's API. The server ALSO saves the result to
 * its durable repository, so it appears on the /dashboard automatically. */
async function optimizeRemote(base: string, url: string): Promise<RemoteResult> {
  const password = process.env.REMOTE_APP_PASSWORD?.trim();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (password) headers.Authorization = "Basic " + Buffer.from("api:" + password).toString("base64");
  const res = await fetch(`${base}/api/optimize`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, answers: {} }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = (JSON.parse(text).error as string) ?? msg;
    } catch {
      /* keep raw */
    }
    throw new Error(`remote optimize ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as RemoteResult;
}

/** A post's published date as YYYY-MM-DD in the site's timezone (America/Chicago) —
 * the same date string the Wix dashboard displays, so range bounds match what the
 * user sees on screen. */
function publishedDayChicago(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

interface RowReport {
  url: string;
  slug: string;
  originalTitle: string;
  baseline: number;
  optimized: number;
  publishReady: boolean;
  claimsToVerify: number;
  skippedFigures: number;
  preservedMedia: number; // original inline images/videos carried into the draft
  dashboard?: string; // shareable /r/<id> link on the deployed app (remote mode)
  wix: string; // draft status / dry-run note
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  // 1) Wix setup — needed for --push, and for --from/--to (dates come from Wix).
  const needsWix = args.push || args.from !== undefined || args.to !== undefined;
  let wix: WixClient | null = null;
  let allDrafts: DraftPost[] = [];
  let overrides: Record<string, string> = {};
  if (needsWix) {
    const cfg = wixConfigFromEnv();
    if (!cfg) {
      console.error("ERROR: --push/--from/--to need WIX_API_KEY and WIX_SITE_ID in .env. Aborting.");
      process.exit(1);
    }
    if (args.overridesPath && existsSync(args.overridesPath)) {
      overrides = JSON.parse(readFileSync(args.overridesPath, "utf8"));
    }
    wix = new WixClient(cfg);
    console.error("Fetching existing Wix draft posts for matching…");
    allDrafts = await wix.listAllDraftPosts();
    console.error(`  found ${allDrafts.length} draft posts.`);
  }

  // 2) URL list — explicit --url wins; then a --from/--to date window over the
  //    site's published posts; else crawl the whole blog index.
  let urls = args.urls;
  if (urls.length === 0 && (args.from !== undefined || args.to !== undefined) && wix) {
    const from = args.from ?? "0000-01-01";
    const to = args.to ?? "9999-12-31";
    console.error(`Listing published posts with Published date in [${from} .. ${to}] (site timezone)…`);
    const posts = await wix.listAllPosts();
    const inRange = posts
      .filter((p) => p.firstPublishedDate)
      .filter((p) => {
        const day = publishedDayChicago(p.firstPublishedDate!);
        return day >= from && day <= to;
      })
      // oldest first, so a partial run covers a contiguous date span
      .sort((a, b) => (a.firstPublishedDate! < b.firstPublishedDate! ? -1 : 1));
    for (const p of inRange) {
      const slug = p.slug || slugFromUrl(p.url?.path ?? "");
      if (!slug) continue;
      const url = `https://www.trossenrobotics.com/post/${slug}`;
      urls.push(url);
      overrides[slug] = p.id; // exact id match — a published post's draft shares its id
      console.error(`  ${publishedDayChicago(p.firstPublishedDate!)}  ${slug}`);
    }
    console.error(`  ${urls.length} post(s) in range.`);
  }
  if (urls.length === 0) {
    console.error("Crawling https://www.trossenrobotics.com/news …");
    urls = await crawlPostUrls({ onProgress: (m) => console.error("  " + m) });
  }
  if (args.limit !== undefined) urls = urls.slice(0, args.limit);
  console.error(`\n${urls.length} post(s) to process. Mode: ${args.push ? "PUSH (write Wix drafts)" : "DRY-RUN (local only)"}\n`);

  const provider = createProvider();
  const rows: RowReport[] = [];

  // 3) Per-post pipeline (sequential — respects LLM cost + Wix rate limits).
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const slug = slugFromUrl(url) || `post-${i}`;
    // Crash recovery: a post's meta.json is written only after it fully succeeds,
    // so its presence means this post is already optimized + drafted. Skip it.
    if (args.resume && existsSync(join(args.outDir, `${slug}.meta.json`))) {
      console.error(`[${i + 1}/${urls.length}] ${slug} — already done, skipping (--resume)`);
      continue;
    }
    console.error(`[${i + 1}/${urls.length}] ${url}`);
    try {
      // Match first (slug/override, pre-optimize) so we can fetch the ORIGINAL
      // draft's media and preserve it. Title fallback happens after optimize.
      let match = args.push ? matchDraft({ url }, allDrafts, overrides) : { draftId: null, strategy: "none" as const };
      let originalMedia: ReturnType<typeof extractMediaNodes> = [];
      if (args.push && wix && match.draftId) {
        try {
          const original = await wix.getDraftWithContent(match.draftId);
          originalMedia = extractMediaNodes(original.richContent as any);
          // Automatic safety backup of the draft we're about to overwrite.
          // First-backup-wins: on a re-run the draft already holds OUR content,
          // and overwriting the backup would lose the real original.
          const backupPath = join(args.outDir, `BACKUP-${slug}.json`);
          if (!existsSync(backupPath)) {
            writeFileSync(backupPath, JSON.stringify(original, null, 2), "utf8");
          }
        } catch {
          /* non-fatal — proceed without media preservation */
        }
      }

      const r: RemoteResult = args.remote ? await optimizeRemote(args.remote, url) : await optimize(url, provider);
      // A cached remote result means the server's live AI quota was exhausted and
      // it served an OLD saved version — do not push stale content to Wix.
      if (r.servedFromCache) throw new Error("remote served a cached (stale) result — AI quota exhausted; retry later");
      const dashboardUrl = args.remote && r.savedUrl ? `${args.remote}${r.savedUrl}` : undefined;
      let { richContent, skippedHtmlBlocks } = markdownToRicos(r.rewrittenDraft, { idPrefix: `${slug}-` });
      // Carry the original post's inline images/videos into the optimized body.
      richContent = interleaveMedia(richContent, originalMedia, `${slug}-media`);

      // Persist everything locally for review (dry-run deliverable).
      writeFileSync(join(args.outDir, `${slug}.md`), r.rewrittenDraft, "utf8");
      writeFileSync(join(args.outDir, `${slug}.ricos.json`), JSON.stringify(richContent, null, 2), "utf8");
      writeFileSync(
        join(args.outDir, `${slug}.meta.json`),
        JSON.stringify(
          {
            url,
            dashboardUrl,
            originalTitle: r.originalTitle,
            optimizedTitle: r.title,
            baselineScore: r.baselineScore,
            optimizedScore: r.optimizedScore,
            publishReady: r.editorial?.publishReady,
            doNotPublishReasons: r.editorial?.doNotPublishReasons ?? [],
            claimsToVerify: r.claimDiff.passed ? [] : r.claimDiff.added,
            metadata: r.content.metadata,
            skippedFigures: skippedHtmlBlocks.length,
            preservedMedia: originalMedia.length,
          },
          null,
          2,
        ),
        "utf8",
      );

      const row: RowReport = {
        url,
        slug,
        originalTitle: r.originalTitle,
        baseline: r.baselineScore,
        optimized: r.optimizedScore,
        publishReady: !!r.editorial?.publishReady,
        claimsToVerify: r.claimDiff.passed ? 0 : r.claimDiff.added.length,
        skippedFigures: skippedHtmlBlocks.length,
        preservedMedia: originalMedia.length,
        dashboard: dashboardUrl,
        wix: "dry-run (not written)",
      };

      // 4) Write the Wix draft (never publishes).
      if (args.push && wix) {
        // Slug match may have missed; try the title fallback now that we have it.
        if (!match.draftId) match = matchDraft({ url, originalTitle: r.originalTitle }, allDrafts, overrides);
        if (!match.draftId) {
          row.wix = "NO MATCH — add to overrides.json (slug -> draftId)";
        } else {
          // Preserve the original title (Editorial Preservation Mode). Body only.
          await wix.updateDraftBody(match.draftId, richContent);
          row.wix = `draft updated via ${match.strategy} (id ${match.draftId.slice(0, 8)}…), ${originalMedia.length} media kept — review & Publish in Wix`;
        }
      }
      rows.push(row);
      console.error(
        `    score ${row.baseline}→${row.optimized}  publishReady=${row.publishReady}  claims=${row.claimsToVerify}  media=${row.preservedMedia}  ${row.wix}`,
      );
    } catch (err) {
      // Remove the resume marker so --resume retries this post (meta.json must
      // only exist for posts that completed the whole pipeline incl. Wix push).
      rmSync(join(args.outDir, `${slug}.meta.json`), { force: true });
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        url,
        slug,
        originalTitle: "",
        baseline: 0,
        optimized: 0,
        publishReady: false,
        claimsToVerify: 0,
        skippedFigures: 0,
        preservedMedia: 0,
        wix: `ERROR: ${msg.slice(0, 120)}`,
      });
      console.error(`    ERROR: ${msg}`);
    }
  }

  // 5) Report.
  const reportPath = join(args.outDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(rows, null, 2), "utf8");
  console.log(`\n=== Batch complete: ${rows.length} post(s) ===`);
  console.log(`Mode: ${args.push ? "PUSH" : "DRY-RUN"}   Output: ${args.outDir}`);
  for (const r of rows) {
    console.log(
      `  ${r.baseline}→${r.optimized}  ${r.publishReady ? "✓" : "⚠"}  claims:${r.claimsToVerify}  media:${r.preservedMedia}  ${r.slug}  [${r.wix}]${r.dashboard ? "  " + r.dashboard : ""}`,
    );
  }
  const unmatched = rows.filter((r) => r.wix.startsWith("NO MATCH")).length;
  if (unmatched) console.log(`\n${unmatched} post(s) had no Wix match — map them in an overrides file and re-run with --overrides.`);
  console.log(`\nFull report: ${reportPath}`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
