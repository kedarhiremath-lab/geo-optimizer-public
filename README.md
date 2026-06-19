# Trossen GEO/SEO Content Optimizer — Milestone 1

Takes a trossenrobotics.com blog post and produces GEO (Generative Engine
Optimization) + SEO optimization output: a baseline score, a prioritized
fix-list, a short "skills interview" that tunes the rewrite to your goals,
and an optimized draft — with a before→after score. M1 is the optimizer core;
the measurement harness (M2) and multi-post crawl/dashboard (M3) come later.

## Quick start (new machine)

1. **Install Node.js 20+** — https://nodejs.org (LTS). Verify: `node --version`.
2. **Get a free Gemini API key** — https://aistudio.google.com/apikey (no billing
   required). Free tier allows ~20 requests/day per model.
3. In a terminal, from this folder:
   ```bash
   npm install
   npx playwright install chromium      # one-time: downloads the headless browser
   cp .env.example .env                  # then open .env and paste your key
   npm run ui
   ```
   (On Windows PowerShell, use `copy .env.example .env` instead of `cp`.)
4. Open **http://localhost:5173** in your browser.

`.env` should contain:
```
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.5-flash
```

## How to use the web app

1. Paste a blog-post URL → **Analyze** (free, no AI): see the baseline GEO/SEO
   score and the gaps.
2. **Skills interview**: answer what you can (blanks are skipped). The five
   sections come from gstack skill lenses — audience, thesis, structure,
   engagement, and hard requirements — and steer the rewrite.
3. **Generate optimized article** (one AI call): get the rewritten draft, the
   before→after score, and any claims flagged to verify. Copy the Markdown into
   your CMS.

## Command-line use (optional)

```bash
npm run inspect -- <url>     # fetch+extract+score, NO AI call (no quota used)
npm run optimize -- <url>    # full pipeline incl. AI rewrite (needs GEMINI_API_KEY)
npm test                     # unit tests
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
