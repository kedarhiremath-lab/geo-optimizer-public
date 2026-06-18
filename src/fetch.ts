// T2 — Fetch + render a page via the gstack browse.exe binary, with an
// on-disk cache so extraction/LLM iteration doesn't re-render every run.
//
// browse.exe runs a persistent browser server; we drive it with:
//   browse goto <url>           navigate
//   browse wait --networkidle   let Wix lazy-loaded content settle
//   browse html                 dump the rendered DOM
//
// Failure modes handled (eng review):
//   - binary absent        -> throw with install hint
//   - goto/render timeout  -> throw; caller surfaces error + may use stale cache
//   - empty/short html      -> throw (don't feed garbage downstream)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RenderedPage } from "./types.js";

const execFileAsync = promisify(execFile);

const CACHE_DIR = join(process.cwd(), "cache");
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_HTML_BYTES = 500;

function resolveBrowseBin(): string {
  if (process.env.BROWSE_BIN && existsSync(process.env.BROWSE_BIN)) {
    return process.env.BROWSE_BIN;
  }
  const guess = join(homedir(), ".claude", "skills", "gstack", "browse", "dist", "browse.exe");
  if (existsSync(guess)) return guess;
  const guessNoExe = join(homedir(), ".claude", "skills", "gstack", "browse", "dist", "browse");
  if (existsSync(guessNoExe)) return guessNoExe;
  throw new Error(
    "browse binary not found. Set BROWSE_BIN in .env, or build gstack: " +
      "cd ~/.claude/skills/gstack && ./setup",
  );
}

function cachePathFor(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `${hash}.html`);
}

export interface FetchOptions {
  /** Skip the cache and force a fresh render. */
  noCache?: boolean;
  /** Cache entries older than this many ms are treated as stale. */
  maxAgeMs?: number;
  timeoutMs?: number;
}

/**
 * Render a URL to HTML, using the cache when possible.
 * Throws on render failure or suspiciously empty output.
 */
export async function fetchRendered(url: string, opts: FetchOptions = {}): Promise<RenderedPage> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cachePath = cachePathFor(url);

  if (!opts.noCache && existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (opts.maxAgeMs === undefined || age <= opts.maxAgeMs) {
      const html = readFileSync(cachePath, "utf8");
      if (html.length >= MIN_HTML_BYTES) {
        return { url, html, fromCache: true };
      }
    }
  }

  const bin = resolveBrowseBin();
  const run = (args: string[]) =>
    execFileAsync(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });

  try {
    await run(["goto", url]);
    // Wix lazy-loads on scroll/idle; give the network a moment to settle.
    await run(["wait", "--networkidle"]).catch(() => {
      /* networkidle can time out on chatty pages; the DOM is usually ready anyway */
    });
    const { stdout } = await run(["html"]);
    const html = stdout;
    if (!html || html.length < MIN_HTML_BYTES) {
      throw new Error(`Rendered HTML for ${url} is suspiciously small (${html?.length ?? 0} bytes).`);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, html, "utf8");
    return { url, html, fromCache: false };
  } catch (err) {
    // Fall back to a stale cache entry if we have one — better than nothing.
    if (existsSync(cachePath)) {
      const html = readFileSync(cachePath, "utf8");
      if (html.length >= MIN_HTML_BYTES) {
        return { url, html, fromCache: true };
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to render ${url}: ${msg}`);
  }
}
