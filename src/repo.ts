// Article repository storage (#6) with a DURABLE backend.
//
// Render's free tier has an EPHEMERAL filesystem — it is wiped on every restart
// and every idle spin-down — so file storage cannot persist saved articles. When
// a durable store is configured (Upstash Redis REST, free tier), we use it so the
// repository survives forever. Otherwise we fall back to the local file cache
// (which is durable locally, ephemeral on free Render).
//
// To enable durable storage, set these env vars (from a free Upstash Redis DB):
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DIR = join(process.cwd(), "cache", "results");
const U_URL = process.env.UPSTASH_REDIS_REST_URL;
const U_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const DURABLE = !!(U_URL && U_TOK);

export function repoIsDurable(): boolean {
  return DURABLE;
}

/**
 * Canonical form of a source URL for dedup keying. Two links to the SAME article
 * must map to ONE key so re-optimizing overwrites instead of creating a duplicate.
 * We drop the query string (tracking params like ?utm_source/&utm_medium/gclid are
 * the usual culprit) and the hash, lowercase the host, strip a leading "www." and
 * any trailing slash. The article is identified by origin + path.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    return u.protocol.toLowerCase() + "//" + host + path;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Stable id for a source URL (re-optimizing the same article overwrites — latest
 * only). Keyed by the CANONICAL url, so tracking params never split into dupes. */
export function resultIdFor(url: string): string {
  return createHash("sha256").update(canonicalizeUrl(url)).digest("hex").slice(0, 16);
}

export interface RepoEntry {
  id: string;
  url: string;
  title: string;
  score: number;
  savedAt: number;
}

/** Run a pipeline of Redis commands against Upstash's REST API. */
async function upstash(commands: unknown[][]): Promise<{ result: unknown }[]> {
  const r = await fetch(U_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + U_TOK, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  return (await r.json()) as { result: unknown }[];
}

// ── File fallback ─────────────────────────────────────────────────────────────
function fileSave(id: string, result: unknown): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, id + ".json"), JSON.stringify(result), "utf8");
}
function fileLoad(id: string): unknown | null {
  const p = join(DIR, id + ".json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
function fileList(): RepoEntry[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f): RepoEntry | null => {
      try {
        const r = JSON.parse(readFileSync(join(DIR, f), "utf8"));
        return { id: f.replace(/\.json$/, ""), url: r.url || "", title: r.title || r.url || "Untitled", score: r.optimizedScore ?? 0, savedAt: statSync(join(DIR, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is RepoEntry => x !== null)
    .sort((a, b) => b.savedAt - a.savedAt);
}

// ── Public API (durable when configured, file fallback otherwise) ─────────────
export async function saveResult(url: string, result: { title?: string; optimizedScore?: number }): Promise<void> {
  const id = resultIdFor(url);
  if (DURABLE) {
    try {
      const meta = JSON.stringify({ url, title: result.title || url, score: result.optimizedScore ?? 0, savedAt: Date.now() });
      await upstash([
        ["HSET", "geo:meta", id, meta],
        ["SET", "geo:result:" + id, JSON.stringify(result)],
      ]);
      return;
    } catch {
      /* fall through to file */
    }
  }
  try {
    fileSave(id, result);
  } catch {
    /* best-effort */
  }
}

export async function loadResultById(id: string): Promise<unknown | null> {
  if (DURABLE) {
    try {
      const out = await upstash([["GET", "geo:result:" + id]]);
      const v = out[0]?.result;
      return typeof v === "string" ? JSON.parse(v) : null;
    } catch {
      /* fall through */
    }
  }
  try {
    return fileLoad(id);
  } catch {
    return null;
  }
}

export function loadResultByUrl(url: string): Promise<unknown | null> {
  return loadResultById(resultIdFor(url));
}

/** Delete one stored result (both its metadata and body). Best-effort. */
export async function deleteResult(id: string): Promise<void> {
  if (DURABLE) {
    try {
      await upstash([["HDEL", "geo:meta", id], ["DEL", "geo:result:" + id]]);
      return;
    } catch {
      /* fall through to file */
    }
  }
  try {
    const p = join(DIR, id + ".json");
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

/** Low-level write of an entry under an explicit id, preserving its savedAt
 * (used by the dedup migration to re-key a survivor under the canonical id). */
async function putEntry(id: string, meta: Omit<RepoEntry, "id">, result: unknown): Promise<void> {
  if (DURABLE) {
    await upstash([
      ["HSET", "geo:meta", id, JSON.stringify({ url: meta.url, title: meta.title, score: meta.score, savedAt: meta.savedAt })],
      ["SET", "geo:result:" + id, JSON.stringify(result)],
    ]);
    return;
  }
  fileSave(id, result);
}

/**
 * One-time repository cleanup (idempotent). Collapses legacy duplicates — the same
 * article saved under different URLs (e.g. differing ?utm_* tracking params) — by
 * grouping on the CANONICAL url, keeping the newest, deleting the rest, and
 * re-keying the survivor under the canonical id so future re-optimizes overwrite.
 * Safe to run on every boot: once each article is single + canonical, it's a no-op.
 */
export async function dedupRepo(): Promise<{ removed: number; rekeyed: number }> {
  const entries = await listResults(); // sorted newest-first
  const groups = new Map<string, RepoEntry[]>();
  for (const e of entries) {
    const canon = resultIdFor(e.url);
    const arr = groups.get(canon);
    if (arr) arr.push(e);
    else groups.set(canon, [e]);
  }
  let removed = 0;
  let rekeyed = 0;
  for (const [canonId, list] of groups) {
    const keep = list[0]; // newest (listResults is newest-first)
    for (let i = 1; i < list.length; i++) {
      await deleteResult(list[i].id);
      removed++;
    }
    if (keep.id !== canonId) {
      const full = await loadResultById(keep.id);
      if (full) {
        await putEntry(canonId, { url: keep.url, title: keep.title, score: keep.score, savedAt: keep.savedAt }, full);
        await deleteResult(keep.id);
        rekeyed++;
      }
    }
  }
  return { removed, rekeyed };
}

export async function listResults(): Promise<RepoEntry[]> {
  if (DURABLE) {
    try {
      const out = await upstash([["HGETALL", "geo:meta"]]);
      const arr = (out[0]?.result as string[]) || []; // flat [field,val,field,val,…]
      const entries: RepoEntry[] = [];
      for (let i = 0; i + 1 < arr.length; i += 2) {
        try {
          const m = JSON.parse(arr[i + 1]);
          entries.push({ id: arr[i], url: m.url, title: m.title, score: m.score, savedAt: m.savedAt });
        } catch {
          /* skip malformed */
        }
      }
      return entries.sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      /* fall through */
    }
  }
  try {
    return fileList();
  } catch {
    return [];
  }
}
