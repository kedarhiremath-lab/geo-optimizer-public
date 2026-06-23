// Shared types for the GEO/SEO optimizer pipeline.
//
// Pipeline data flow:
//   URL -> RenderedPage -> Article -> ScoredArticle -> OptimizeResult
//
// Each stage adds information; nothing mutates a prior stage's object.

/** Output of the fetch stage (browse.exe render, possibly from cache). */
export interface RenderedPage {
  url: string;
  html: string;
  fromCache: boolean;
}

/** Output of the Readability extraction stage. */
export interface Article {
  url: string;
  title: string;
  /** Plain-text body content. */
  text: string;
  /** Markdown-ish content with headings preserved, for the LLM. */
  content: string;
  /** Heading texts in document order (H1-H3). */
  headings: string[];
  /** Outbound link hrefs found in the article body. */
  links: string[];
  /** JSON-LD blocks already present on the page (e.g. injected by Wix). */
  existingJsonLd: unknown[];
  /** Existing meta tags we care about. */
  meta: { title?: string; description?: string };
  byline?: string;
  publishedTime?: string;
}

/** A single checklist dimension and how the original post scored on it. */
export interface ChecklistFinding {
  id: string;
  label: string;
  /** 0 = absent, 1 = partial, 2 = present/strong. */
  score: 0 | 1 | 2;
  evidence: string;
  /** Higher = more impactful to fix. Used to rank the fix-list. */
  weight: number;
}

export interface ScoredArticle {
  article: Article;
  findings: ChecklistFinding[];
  /** 0-100 normalized baseline score of the ORIGINAL post. */
  baselineScore: number;
}

/** A prioritized recommendation derived from a weak/absent checklist finding. */
export interface FixItem {
  id: string;
  label: string;
  recommendation: string;
  priority: number; // weight * (2 - score), higher first
}

/** A factual claim extracted from source or rewrite, for the guardrail. */
export interface ClaimDiffResult {
  added: string[]; // claims in rewrite NOT supported by source -> reputational risk
  passed: boolean; // true when added.length === 0
}

/** A single FAQ entry (Q + A) — drives both the article section and FAQPage schema. */
export interface FaqItem {
  q: string;
  a: string;
}

/** SEO/GEO metadata recommendations (#6). */
export interface Metadata {
  title: string; // <title> tag, query-aligned, <= ~60 chars
  metaDescription: string; // ~150-160 chars
  slug: string; // url slug
  tags: string[];
  socialCopy: string; // og/social preview copy
  imageAltText: string[]; // suggested alt text for images that need it
}

/** The structured content the rewrite produces (Phase 1). */
export interface OptimizedContent {
  shortVersion: string[]; // #13 actionable steps
  whoThisIsFor: string[]; // #10 audience bullets
  articleMarkdown: string; // #11/#7 full optimized body (headings, tables, FAQ inline)
  faq: FaqItem[]; // #7 structured FAQ
  metadata: Metadata; // #6
  assetRecommendations: string[]; // #5/#9 visual->HTML + downloadable asset recs
}

export interface OptimizeResult {
  url: string;
  baselineScore: number;
  /** Score of the model's own rewrite, BEFORE deterministic guarantees (raw model quality). */
  modelScore: number;
  /** Final score after the engine guarantees the structural signals (the "after"). */
  optimizedScore: number;
  fixList: FixItem[];
  /** The optimized article body (markdown) — kept for back-compat + scoring. */
  rewrittenDraft: string;
  /** Full structured Phase-1 output. */
  content: OptimizedContent;
  /** Array of JSON-LD blocks: Article, Organization, Person, Breadcrumb, Image, FAQPage. */
  schemas: Record<string, unknown>[];
  schemaNotes: string[];
  claimDiff: ClaimDiffResult;
  /** Overall pass/fail gate: claimDiff passed AND at least the Article schema valid. */
  safe: boolean;
}

/** Frozen prompt set + checklist config (defaults in config.ts). */
export interface OptimizerConfig {
  /** Brand + product entities the content should name explicitly. */
  entities: string[];
  /** SEO target queries; primary ones should appear as H2s. */
  primaryQueries: string[];
  secondaryQueries: string[];
  /** GEO prompt panel (used by M2 measurement, kept here as the SoT). */
  geoPanel: string[];
}

/** Abstraction so we can swap Gemini for Anthropic etc. later. */
export interface LlmProvider {
  name: string;
  /** Single completion call. Pass { json: true } to request strict JSON output. */
  complete(prompt: string, opts?: { json?: boolean }): Promise<string>;
}
