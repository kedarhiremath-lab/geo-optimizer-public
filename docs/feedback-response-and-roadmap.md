# GEO App — Point-by-Point Response to Feedback

Thanks for the detailed review. Direct answers to each item below, in order. I've
been honest about what the app does **today** vs. what's not built yet — the
deployed version is Milestone 1 (the diagnose + rewrite + safety core), and most
of your asks are the next milestones. A phased plan follows the answers.

---

**1. AI model and generation quality.**
The rewrite is done by **Google Gemini 2.5 Flash** on the **free tier** — that's
the "free tier" reference you saw; it's a quota limit (~20 requests/day), not a
quality setting. Details:
- The **same model** does both AI stages: the rewrite and the fact-check (the
  "claims to verify" guardrail).
- **No fallback today.** On error/quota it retries with backoff, then shows a
  clear error; it does not fail over to another model.
- The model is one config value, so swapping is a one-line change — the app was
  built behind a provider interface for exactly this.
- **My recommendation:** Flash is fast and cheap but not the right tool for
  output that beats a generic SEO rewrite. We should move the rewrite to a
  **frontier model with billing** (Gemini 2.5 Pro, Claude Sonnet/Opus, or
  GPT-class) and use **per-stage routing** — strong model for the rewrite, a
  cheap one for mechanical steps like claim extraction. This is the single
  highest-leverage quality change, ~1 day of work.

**2. CEO skill integration.**
Deliberate choice here: rather than run the CEO review as a one-off pass, we
**built its thinking directly into the product** so every article benefits from
it, not just this one. It lives as the "Thesis & Differentiation" lens in the
optimization flow — interrogating the core argument, what only Trossen can
credibly claim, the 10x version of the piece, and what to cut. The strategic
reasoning is in the engine, not locked in a one-time report.

You've pointed at the right next layer, though. Today we apply the CEO *lens*;
what we haven't built yet is the **deeper strategic diagnosis** (formal premise
challenge, "what would make this fail," positioning analysis) and the
**traceability** to show which input drove which recommendation. That
traceability is the same capability as #15, and I'd build them together — so the
tool doesn't just optimize, it shows *why* it made each call.

**3. Hosting and load time.**
I chose **Render** because it was the fastest path to a real clickable URL —
free, runs our container (the app uses headless Chromium to render Wix pages),
and deploys from GitHub. It was a **prototype choice, not final.** The slow first
load is a **Render free-tier cold start**: the free plan spins the service down
after ~15 min idle, so the first hit takes ~30–60s to wake, then it's fast. It is
**not** an app-performance problem. Fix before internal use: a paid always-on
instance (no cold start, more RAM — the free 512 MB is tight for Chromium), or a
comparable host. Small cost, removes the lag.

**4. Score methodology and path to improvement.**
Today the score is a **deterministic rubric** — a weighted structural checklist,
**not** an LLM judge and **not** live SEO/GEO signals. Six dimensions:

| Dimension | Weight | Checks |
|---|---|---|
| Answer-first TL;DR | 5 | Direct answer to the primary query up top |
| Question-shaped H2s | 5 | Headings match target queries verbatim |
| Entity naming | 4 | "Trossen Robotics"/"Trossen SDK" named explicitly |
| Citable stats | 3 | Concrete numbers present |
| Internal + external links | 2 | At least one of each |
| Meta title + description | 2 | Present |

Score = points earned ÷ max, ×100. **To reach the 90s:** max the high-weight
items — a real answer-first opening, headings phrased exactly as the target
questions, both entities named near claims, several citable stats, internal +
external links. (That's what the fix-list already lists.) **Honest limitation:**
this rubric is a **proxy** for what helps ranking/citation — it does **not**
measure actual search/AI performance. Real-performance measurement is its own
milestone (#14). Plan: make the score self-explaining — per-dimension breakdown,
ranked drivers, "do these N things to reach the 90s" — and label it clearly as a
rubric proxy until #14 lands.

**5. Images, tables, and machine-readable assets.**
Not in the app today. Plan: detect image/graphic-only content and recommend
converting key visuals (e.g. the readiness scorecard) into a **real HTML
`<table>` with a descriptive `<caption>`** — generated, not just suggested — so
search engines and AI tools can parse it. Also recommend alt text for remaining
images. Agreed this matters for extractability.

**6. Metadata recommendations.**
Not generated today (we *score* whether meta exists, but don't produce it). Plan:
output a full metadata block every run — title tag, meta description, URL slug,
tags, image alt text, and social preview copy.

**7. FAQ generation.**
Not in the app today. Plan: generate an FAQ section at the bottom from the
article's content, plus matching **FAQPage** schema. Your six example questions
are exactly the right shape and we'll target that style.

**8. Upfront questions — the logic.**
The five sections each come from a distinct expert lens (the gstack skill set):
**office-hours** (audience/purpose), **CEO review** (thesis/differentiation),
**design review** (structure/readability), **devex review** (engagement/flow),
**spec** (hard requirements — must-keep facts, target keywords). The point is to
capture human context an AI can't infer: who the reader is, the one takeaway,
what's non-negotiable — so the rewrite is tuned, not generic. **Your concern is
valid** — people skip forms. Plan: keep them optional (they already are) AND have
the app **pre-fill suggested answers from the article** so the user edits/approves
instead of writing from scratch — keeps the tuning value, removes the friction.

**9. Conversion assets.**
Not in the app today. Plan: where a strong asset exists (the scorecard),
recommend a downloadable, gated version ("Download the Physical AI Deployment
Readiness Scorecard") for lead capture, backlinks, and sales enablement.
Recommendation-level first, generation later.

**10. Target audience section.**
Not in the app today. Plan: recommend and generate a "Who this is for" block
(operations leaders, innovation teams, robotics startups, enterprise R&D teams,
systems integrators). Agreed it helps both reader alignment and GEO/SEO targeting.

**11. Content restructuring.**
The rewrite is already *allowed* to restructure, but it doesn't yet generate
structured assets on purpose. Plan: explicitly generate comparison tables (e.g.
**Demo vs. Minimum Viable Deployment vs. Production**) and scannable answer blocks
where they help. I'm aligned that the tool should make real structural changes,
not light edits — with the human-approval workflow in #15 as the safety net.

**12. Schema.**
Today the app generates `Article`/`TechArticle` JSON-LD (currently hidden in the
UI — I'll bring it back and expand it). Plan: add `Organization`, `Person`,
`BreadcrumbList`, `ImageObject`, and `FAQPage`, recommend which apply to a given
article, and generate them.

**13. Stronger top summary.**
Today it produces an answer-first paragraph. Plan: change it to a **"Short
Version"** — a numbered, actionable list (Pick a narrow, valuable task → Define
success metrics before the pilot → Treat the first deployment as an MVD → Plan
for human intervention/exception handling → Collect data from successes,
failures, interventions → Scale only when task, support model, and ROI are
repeatable). Exactly your example.

**14. Ongoing performance measurement.**
Not in the app today — and I want to be transparent that this was always planned
as a **later milestone**, because measuring *real* GEO performance (do
ChatGPT/Gemini/Perplexity actually cite us?) needs paid API access with web
grounding or manual tracking; the free tier can't do it automatically. The plan:
- Before/after rubric scores + recommended vs. actually-implemented changes — we
  can start logging now.
- **SEO signals** via Google Search Console (rankings, impressions, clicks, CTR)
  — needs GSC access for trossenrobotics.com.
- **GEO signals** — a weekly standardized prompt panel across the major
  assistants, tracking whether Trossen gets cited and the citation rate over time.
- A **dashboard** tying score → changes → impact on rankings, AI inclusion,
  citations, traffic, conversions.
This is the milestone that turns "we think this helps" into proof. It depends on
API budget + GSC access.

**15. Version control, diffs, and approvals.**
Not in the app today — and I agree it's essential before trusting the tool at
scale, especially since it makes real content changes. Plan: a section-by-section
**diff** (original vs. optimized), each change **labeled with what it's meant to
improve**, and per-recommendation **approve / reject / edit** before publishing.
This is the biggest of the trust features and the one I'd prioritize alongside
the model upgrade.

**Big picture — agreed.** The goal is an **optimization engine**, not a rewrite
tool: it should **diagnose** the article, **explain** what's holding it back,
**generate** a stronger, brand-true version with metadata/schema/assets, let a
human **approve** the changes, and **track** whether they actually improved
performance. v1 delivered diagnose + generate + a fact-preservation safety net.
The work below gets us to the trustworthy engine, and the measurement milestone
proves the impact.

---

## Phased plan

- **Phase 1 — Generation depth (fast, visible wins):** #13 Short Version, #7 FAQ
  + FAQPage, #10 "Who this is for", #11 comparison tables/answer blocks, #6
  metadata block, #12 expanded schema, #5 HTML-table conversion, #9 conversion-
  asset recommendations. Mostly prompt + output structure.
- **Phase 2 — Quality & trust:** frontier model + per-stage routing (#1),
  brand-voice control, score explainability (#2/#4), diff + approve/reject/edit
  (#15). This is what makes output materially better and trustworthy.
- **Phase 3 — Infra:** paid always-on hosting (#3).
- **Phase 4 — Performance measurement (#14):** GSC integration, weekly GEO
  citation panel, before/after dashboard. Needs API budget + GSC access.

**Recommended next sprint:** Phase 1 (immediate wins you can see in the article)
plus the model upgrade from Phase 2 (the quality lever).
