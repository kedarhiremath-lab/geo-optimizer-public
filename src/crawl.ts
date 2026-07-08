// Stage A — Crawl the Trossen blog index (/news) for every post URL.
//
// The news feed is a Wix blog: JS-rendered, lazy-loaded on scroll, and paginated
// via /news, /news/page/2, /news/page/3, ... Each page renders its cards only
// after the client hydrates and the reader scrolls, so a one-shot `browse html`
// dump misses most posts. We drive Chromium directly here: for each page we
// scroll until the post-link count stops growing, collect the /post/ hrefs, then
// advance to the next page until a page yields nothing new.
//
// Output is a de-duplicated, canonical (tracking-params stripped) list of
// https://www.trossenrobotics.com/post/<slug> URLs — exactly the URLs you would
// paste into the optimizer by hand.

import type { Browser } from "playwright";

const DEFAULT_NEWS_URL = "https://www.trossenrobotics.com/news";
const POST_PATH = "/post/";
const MAX_PAGES = 50; // safety cap; loop also stops on the first empty page
const SCROLL_SETTLE_MS = 800;
const MAX_SCROLLS_PER_PAGE = 25;
const NAV_TIMEOUT_MS = 60_000;

export interface CrawlOptions {
  newsUrl?: string;
  maxPages?: number;
  /** Called once per page with a short progress line. */
  onProgress?: (msg: string) => void;
}

/** Strip query string + fragment + trailing slash so the same post maps to one URL. */
export function canonicalizePostUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.split("?")[0].split("#")[0].replace(/\/$/, "");
  }
}

function pageUrl(newsUrl: string, page: number): string {
  if (page <= 1) return newsUrl;
  const base = newsUrl.replace(/\/$/, "");
  return `${base}/page/${page}`;
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  // Same flags fetch.ts uses so Chromium runs headless in a container / as root.
  return chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

/** Scroll a page to the bottom repeatedly until the post-link count stabilizes. */
async function collectPostLinksFromPage(browser: Browser, url: string): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // Wait for the feed to hydrate; a post link appearing is the ready signal.
    await page
      .waitForSelector(`a[href*="${POST_PATH}"]`, { timeout: 15_000 })
      .catch(() => {
        /* page may legitimately have no posts (past the last page) */
      });

    const readCount = () =>
      page.$$eval(`a[href*="${POST_PATH}"]`, (els) => new Set(els.map((e) => (e as HTMLAnchorElement).href)).size);

    let stable = 0;
    let last = await readCount();
    for (let i = 0; i < MAX_SCROLLS_PER_PAGE && stable < 2; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_SETTLE_MS);
      const now = await readCount();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }

    const hrefs = await page.$$eval(`a[href*="${POST_PATH}"]`, (els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    );
    return hrefs;
  } finally {
    await page.close();
  }
}

/**
 * Crawl every page of the blog index and return the full, de-duplicated list of
 * canonical post URLs (in first-seen order).
 */
export async function crawlPostUrls(opts: CrawlOptions = {}): Promise<string[]> {
  const newsUrl = opts.newsUrl ?? DEFAULT_NEWS_URL;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const log = opts.onProgress ?? (() => {});

  const seen = new Set<string>();
  const ordered: string[] = [];
  const browser = await launchBrowser();
  try {
    for (let p = 1; p <= maxPages; p++) {
      const url = pageUrl(newsUrl, p);
      let raw: string[] = [];
      try {
        raw = await collectPostLinksFromPage(browser, url);
      } catch (err) {
        log(`page ${p}: render failed (${err instanceof Error ? err.message : String(err)}) — stopping`);
        break;
      }
      const canonical = raw.map(canonicalizePostUrl).filter((u) => u.includes(POST_PATH));
      let newThisPage = 0;
      for (const u of canonical) {
        if (!seen.has(u)) {
          seen.add(u);
          ordered.push(u);
          newThisPage++;
        }
      }
      log(`page ${p}: ${canonical.length} links, ${newThisPage} new (total ${ordered.length})`);
      // No new posts on this page => we've walked past the last real page.
      if (newThisPage === 0) break;
    }
  } finally {
    await browser.close();
  }
  return ordered;
}
