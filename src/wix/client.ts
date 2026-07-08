// Stage D — Wix Blog API client (draft-only write-back).
//
// Verified against dev.wix.com (Aug 2025 docs):
//   PATCH  /blog/v3/draft-posts/{id}          update a draft (saves UNPUBLISHED changes)
//   POST   /blog/v3/draft-posts/query         find drafts (filter by title, status, ...)
//   GET    /blog/v3/draft-posts/{id}          read one draft
//   POST   /blog/v3/draft-posts/{id}/publish  publish (updates the LIVE post) — NOT used by default
//
// Auth: header `Authorization: <API_KEY>` + `wix-site-id: <SITE_ID>` (Blog is a
// site-level API). Permission scope: "Manage Blog". Keys are minted by an account
// owner in the Wix API Keys Manager.
//
// Safety: the default flow only ever calls updateDraftPost — it saves changes to
// the post's DRAFT (status UNPUBLISHED, hasUnpublishedChanges: true) and leaves
// the live post untouched. A human reviews the draft in the Wix dashboard and
// clicks Publish. publishDraftPost() exists but is never called unless a caller
// explicitly opts in.

import type { RicosDocument } from "./ricos.js";

const API_BASE = "https://www.wixapis.com/blog/v3";

export interface WixConfig {
  apiKey: string;
  siteId: string;
}

export interface DraftPost {
  id: string;
  title?: string;
  seoSlug?: string;
  slugs?: string[];
  /** Present when the query requests the URL fieldset: { path: "/post/<slug>" }. */
  url?: { base?: string; path?: string };
  status?: string;
  hasUnpublishedChanges?: boolean;
  [k: string]: unknown;
}

export interface PublishedPost {
  id: string; // same id as the post's draft
  title?: string;
  slug?: string;
  firstPublishedDate?: string;
  url?: { base?: string; path?: string };
  [k: string]: unknown;
}

export function wixConfigFromEnv(): WixConfig | null {
  const apiKey = process.env.WIX_API_KEY?.trim();
  const siteId = process.env.WIX_SITE_ID?.trim();
  if (!apiKey || !siteId) return null;
  return { apiKey, siteId };
}

export class WixClient {
  constructor(private cfg: WixConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: this.cfg.apiKey,
      "wix-site-id": this.cfg.siteId,
      "Content-Type": "application/json",
    };
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Wix ${method} ${path} -> ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** List every draft post (paginates through the query endpoint, 100/page). */
  async listAllDraftPosts(): Promise<DraftPost[]> {
    const out: DraftPost[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const resp = await this.call<{ draftPosts?: DraftPost[] }>(
        "POST",
        "/draft-posts/query",
        // URL fieldset makes the response include seoSlug + url.path for matching.
        { fieldsets: ["URL"], query: { paging: { limit, offset }, sort: [{ fieldName: "editedDate", order: "DESC" }] } },
      );
      const batch = resp.draftPosts ?? [];
      out.push(...batch);
      offset += batch.length;
      if (batch.length < limit) break; // last (partial) page
      if (offset > 5000) break; // hard safety cap
    }
    return out;
  }

  /** List every PUBLISHED post (paginated). Posts carry firstPublishedDate —
   * the "Published date" shown in the Wix dashboard — which drafts do not. */
  async listAllPosts(): Promise<PublishedPost[]> {
    const out: PublishedPost[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const resp = await this.call<{ posts?: PublishedPost[] }>("POST", "/posts/query", {
        fieldsets: ["URL"],
        query: { paging: { limit, offset }, sort: [{ fieldName: "firstPublishedDate", order: "DESC" }] },
      });
      const batch = resp.posts ?? [];
      out.push(...batch);
      offset += batch.length;
      if (batch.length < limit) break;
      if (offset > 5000) break;
    }
    return out;
  }

  /** Find drafts whose title exactly equals `title`. */
  async findDraftsByTitle(title: string): Promise<DraftPost[]> {
    const resp = await this.call<{ draftPosts?: DraftPost[] }>("POST", "/draft-posts/query", {
      query: { filter: { title: { $eq: title } } },
    });
    return resp.draftPosts ?? [];
  }

  async getDraftPost(id: string): Promise<DraftPost> {
    const resp = await this.call<{ draftPost: DraftPost }>("GET", `/draft-posts/${id}`);
    return resp.draftPost;
  }

  /** Fetch a draft including its rich content (used to preserve original media). */
  async getDraftWithContent(id: string): Promise<DraftPost> {
    const resp = await this.call<{ draftPost: DraftPost }>("GET", `/draft-posts/${id}?fieldsets=RICH_CONTENT`);
    return resp.draftPost;
  }

  /**
   * Update a draft post's body (and optionally title). Saves UNPUBLISHED changes;
   * does NOT publish. Returns the updated draft.
   */
  async updateDraftBody(id: string, richContent: RicosDocument, title?: string): Promise<DraftPost> {
    const draftPost: Record<string, unknown> = { id, richContent };
    if (title !== undefined) draftPost.title = title;
    const resp = await this.call<{ draftPost: DraftPost }>("PATCH", `/draft-posts/${id}`, { draftPost });
    return resp.draftPost;
  }

  /** Publish a draft (updates the LIVE post). NOT called by the default batch flow. */
  async publishDraft(id: string): Promise<string> {
    const resp = await this.call<{ postId: string }>("POST", `/draft-posts/${id}/publish`);
    return resp.postId;
  }
}

// ── matching a source URL to its draft id ────────────────────────────────────

/** The trailing /post/<slug> segment of a Trossen article URL. */
export function slugFromUrl(url: string): string {
  const m = url.match(/\/post\/([^/?#]+)/);
  return m ? m[1] : "";
}

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface MatchResult {
  draftId: string | null;
  strategy: "override" | "slug" | "title" | "none";
  candidates?: number;
}

/**
 * Resolve a source article to its Wix draft id. Tries, in order:
 *   1. a manual override map (slug -> draftId),
 *   2. slug match against every draft's seoSlug/slugs,
 *   3. exact original-title match.
 * `allDrafts` is passed in so the caller fetches the full list once and reuses it.
 */
export function matchDraft(
  source: { url: string; originalTitle?: string },
  allDrafts: DraftPost[],
  overrides: Record<string, string> = {},
): MatchResult {
  const slug = slugFromUrl(source.url);
  if (slug && overrides[slug]) return { draftId: overrides[slug], strategy: "override" };

  if (slug) {
    const draftSlug = (d: DraftPost): string => d.seoSlug || slugFromUrl(d.url?.path ?? "") || "";
    const bySlug = allDrafts.filter(
      (d) => draftSlug(d) === slug || (Array.isArray(d.slugs) && d.slugs.includes(slug)),
    );
    if (bySlug.length === 1) return { draftId: bySlug[0].id, strategy: "slug", candidates: 1 };
    if (bySlug.length > 1) return { draftId: bySlug[0].id, strategy: "slug", candidates: bySlug.length };
  }

  if (source.originalTitle) {
    const byTitle = allDrafts.filter((d) => norm(d.title ?? "") === norm(source.originalTitle!));
    if (byTitle.length >= 1) return { draftId: byTitle[0].id, strategy: "title", candidates: byTitle.length };
  }

  return { draftId: null, strategy: "none" };
}
