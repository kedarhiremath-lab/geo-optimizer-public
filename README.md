# Trossen GEO/SEO Content Optimizer — Milestone 1

Takes a trossenrobotics.com blog post and produces GEO (Generative Engine
Optimization) + SEO optimization output: a prioritized fix-list, a rewritten
draft, and `Article`/`TechArticle` JSON-LD. M1 is the optimizer core; the
measurement harness (M2) and multi-post crawl/dashboard (M3) come later.

## Pipeline

```
URL → render (Playwright/browse.exe, cached) → Readability extract (fail-loud)
    → score ORIGINAL vs checklist → Gemini Flash rewrite (fact-constrained)
    → claim-diff (invented fact = FAIL) → validate Article JSON-LD (dedup vs Wix)
    → fix-list + draft + JSON-LD
```

## Setup

```bash
npm install
npx playwright install chromium     # one-time, if not already present
cp .env.example .env                 # then add your free-tier GEMINI_API_KEY
```

Get a free Gemini key at https://aistudio.google.com/apikey (no billing required).

## Use

```bash
npm run inspect -- <url>     # fetch+extract+score+JSON-LD, NO LLM (no API quota used)
npm run optimize -- <url>    # full pipeline incl. LLM rewrite (needs GEMINI_API_KEY)
npm run ui                   # local web UI at http://localhost:5173
npm test                     # unit tests (deterministic parts)
npm run eval                 # independent quality eval on the Blueprint post
```

## Notes / constraints (M1)

- **Free-tier only.** Gemini free tier has no Search grounding — fine here, since
  the optimizer only analyzes/rewrites. Automated GEO *measurement* (M2) needs
  grounding and is deferred.
- **Free-tier daily quota.** `gemini-2.5-flash` free tier allows ~20 requests/day.
  Each optimize run uses 2 calls (rewrite + claim extraction), so ~10 posts/day.
  If you hit the cap you'll see a clear `429 ... free_tier_requests` error — wait
  for the daily reset, or set `GEMINI_MODEL=gemini-2.5-flash-lite` in `.env` for a
  higher free allowance, or add billing for production use.
- **Fact-preservation guardrail.** The rewrite must not introduce any stat or
  claim absent from the source; a claim-diff enforces this (`safe: false` on
  violation). Critical for a commercial page.
- **JSON-LD:** emits `TechArticle`, not `FAQPage` (deprecated May 2026 +
  restricted to gov/health). Flags conflicts with Wix's existing structured data.
- **Engine, validated on one post.** Config-driven (`src/config.ts`) so it
  generalizes; validated against the Blueprint post for M1.
