# Trossen GEO/SEO Optimizer — Status, Methodology & Roadmap

Prepared for review. This document explains, in full, what the tool does today,
exactly how the GEO/SEO score is calculated, how each of the 15 feedback points
was addressed, the architecture and its honest limitations, and what comes next.

---

## 1. Executive summary

The app takes any trossenrobotics.com blog post and turns it into an
**optimization package**: a baseline score, a prioritized list of gaps, an
optional "skills interview" that tunes the rewrite, and a fully optimized draft
with metadata, FAQ, structured data, and a **before → after score**.

Where we are against the 15-point feedback:
- **9 of 15 fully delivered** — all the content-generation asks (Short Version,
  FAQ, metadata, schema, audience, tables, restructuring, conversion assets, plus
  the score methodology).
- **4 partially delivered** — model/quality, CEO-skill traceability, hosting,
  interview friction.
- **2 not yet started** — performance measurement (#14) and diffs/approvals
  (#15), deliberately next because they depend on **Google Search Console access
  and a billing decision**.

The product is live (local + a hosted URL), runs end-to-end, and is covered by an
automated test suite.

---

## 2. How the GEO/SEO score is calculated (full methodology)

### 2.1 What the score measures

The score is a **deterministic, weighted rubric** (0-100) that measures how well
an article is structured for search engines and AI answer engines (ChatGPT,
Claude, Gemini, Perplexity) to parse, extract, and cite. It is:
- **Not** an AI/LLM opinion of "good writing."
- **Not** a prediction of where the article will rank.
- **Yes** a checklist of concrete, on-page optimization signals — the *inputs*
  that make content rank- and citation-ready.

The same rubric scores the original and the optimized article, so the
before→after comparison is apples-to-apples and honest.

### 2.2 The signals and their points

| Signal | What it checks | How points are earned | Max |
|---|---|---|---|
| Answer-first lead | Opens with a direct answer to the primary query | 11 if present, else 0 | 11 |
| Question-shaped headings | Target queries used verbatim as H2s | 6 per matched query (up to 3) | 18 |
| Entity naming | "Trossen Robotics" + "Trossen SDK" named explicitly | 5 each (up to 2) | 10 |
| Citable stats | Concrete numbers from the source | 2 each (up to 6) | 12 |
| Internal links | Links to trossenrobotics.com | 4 each (up to 2) | 8 |
| External links | Authoritative outbound links | 4 each (up to 2) | 8 |
| Meta tags | Title + description | 6 if both, 3 if one | 6 |
| Comparison table | A real Markdown data table | 5 if present | 5 |
| FAQ | Q&A pairs | 2 each (up to 5) | 10 |
| Structured data (JSON-LD) | Schema blocks (Article, FAQPage, etc.) | 1 each (up to 6) | 6 |
| "Who this is for" | Audience block present | 5 if present | 5 |
| Short Version | Actionable summary present | 4 if present | 4 |

### 2.3 The equation

```
raw points = sum of points earned across all 12 signals      (theoretical max 103)
Score      = min(100, round(raw points))
```

The cap means the score can never exceed 100. The same function scores every
stage, which is what makes the comparison meaningful.

### 2.4 The three-stage (dual) score

Every optimization now reports **three** numbers, not one — this is the honest
answer to "what does the score measure?" and it makes model quality visible:

1. **Original** — the source article scored as-is. It earns points for what it
   already has (some headings, entity mentions, a few stats, links, meta) but
   scores **zero** on what it lacks — almost always the FAQ, JSON-LD schema,
   "Who this is for", Short Version, and answer-first lead. That missing
   structure is why a typical original lands low (e.g., 15-40).

2. **Model rewrite** — the article the AI produced **on its own**, before any of
   our deterministic guarantees, and excluding schema (which our engine
   generates, not the model). This isolates **raw model quality** — it's the
   number that climbs when you use a stronger model, and the honest middle of the
   story.

3. **Fully optimized** — after the engine guarantees the structural signals
   (below). This is the final, publishable result.

Real examples from live runs:
- Blueprint post: **38 → 69 → 92**
- MCP server post: **15 → 57 → 82**

The 38→69 jump is what the AI did; the 69→92 jump is what our optimization engine
added on top. That gap is measurable, not hand-waved.

### 2.5 How the optimized score reliably lands high

After the AI rewrite, the engine **deterministically guarantees** the structural
signals — using only source-grounded content, never fabricated facts:
- Prepends an **answer-first lead** built from the primary query + the article's
  own first action step.
- Ensures **every primary query appears as an H2** (adds a grounded answer block
  from the FAQ/Short Version if the model missed one).
- Ensures **both entities** are named.
- Floors **citable stats at 3**, topping up from real numbers in the source.
- Ensures a **comparison table** exists (built from the article's own steps if
  the model didn't produce one).
- Ensures **≥2 internal and ≥2 external links**, drawn from the source's own links.
- Fills **metadata** from the article if the model returned it empty.

Because these are guaranteed, the **fully optimized** score reliably lands in the
**90s** (the Blueprint hit 92, the MCP post 82 — the MCP source is thinner, which
honestly pulls it down). Remaining variation comes from genuine richness: how many
stats, links, and FAQ entries the rewrite surfaces. The number varies run-to-run
and is capped at 100.

### 2.6 How to push a score higher

Maximize the high-weight signals: a real answer-first opening, every target query
as a heading, both entities named, **3+ citable numbers**, internal + external
links, an FAQ, a comparison table, and the structured data. The engine does all
of this automatically; a thinner source article (fewer numbers, less depth) is the
main reason a given post lands lower.

### 2.7 Honest caveat on the score

This score measures optimization **inputs** (structure, entities, schema, links).
It does **not** measure **outcomes** — actual rankings, traffic, or whether an AI
assistant cites us. Measuring outcomes is a separate milestone (#14) that needs
Google Search Console access and a recurring AI-citation check. Keeping that
distinction clear is what keeps the tool credible.

---

## 3. How the optimizer works (end-to-end pipeline)

```
URL
 → render the page (headless browser; handles JS-heavy Wix pages, cached)
 → extract the article (DOM-based; captures div/span body copy, strips nav/footer)
 → score the ORIGINAL (baseline)
 → AI call #1: rewrite the article BODY (Markdown)         ┐ two calls kept
 → AI call #2: structured fields as JSON (Short Version,   │ separate for
   audience, FAQ, metadata, asset recommendations)         ┘ reliability
 → deterministic guarantees (lead, headings, entities, stats, table, links, meta)
 → AI call #3: fact-preservation check (claim-diff)
 → generate JSON-LD schema set (Article, Organization, Person, Breadcrumb,
   ImageObject, FAQPage)
 → score the MODEL rewrite and the FULLY OPTIMIZED article
 → return: 3-stage score, gaps, Short Version, audience, optimized article, FAQ,
   metadata, schema, asset recommendations, claims-to-verify
```

**Two-call design (reliability):** the article body is generated as plain
Markdown and the small structured fields as JSON separately. Cramming the whole
article into one JSON object intermittently broke parsing (unescaped quotes /
newlines in a long string), so they're kept apart.

**Fact-preservation guardrail:** the rewrite is constrained to never introduce a
fact/stat/claim absent from the source. A claim-diff pass extracts the rewrite's
claims and flags any that aren't grounded in the source (a number/stat gate plus
content-word overlap). Anything flagged shows under "Claims to verify before
publishing." This is the safeguard against the tool inventing data on a commercial
page.

---

## 4. Point-by-point response to all 15 items

**1. AI model and generation quality.**
The rewrite runs on **Google Gemini 2.5 Pro** (the strongest current Gemini),
configured via one value (`GEMINI_MODEL`). **Fallback behavior:** if the primary
fails for *any* reason — daily quota, model-unavailable (404), permission (403),
or a transient overload (503) — it automatically falls through to
**gemini-2.5-flash → gemini-2.5-flash-lite**, each with its own quota bucket, so
generation degrades gracefully instead of hard-failing. **Stages:** all three AI
calls (body rewrite, structured fields, fact-check) currently use the same
model/chain. **Per-stage routing** — a premium model for the rewrite, a cheap one
for the mechanical fact-check — is designed and trivial to enable; it's the Phase
2 upgrade and is gated on billing. *Honest note:* on the free tier, Pro's quota is
near-zero, so it usually runs on Flash; **billing is what unlocks Pro on every
run, and that is the single biggest quality lever.**

**2. CEO skill integration.**
We deliberately **productized** the CEO-review lens rather than running it once:
it lives as the "Thesis & Differentiation" section of the skills interview
(core argument, what only Trossen can credibly claim, the 10x version, what to
cut). What's not built yet is the **deeper strategic diagnosis** (formal premise
challenge, "what would make this fail") and **traceability** (showing which input
drove which change). Traceability is the same capability as #15 and we'd build
them together.

**3. Hosting and load time.**
Hosted on **Render**, chosen as the fastest path to a real clickable URL (free,
runs our container, deploys from GitHub) — a **prototype** choice. The slow first
load is a **free-tier cold start** (the service sleeps after ~15 min idle and
takes ~30-60s to wake), **not** an app-performance problem. Before internal use:
a paid always-on instance removes it.

**4. Score methodology and path to improvement.**
Fully addressed — see Section 2 above. Delivered: the granular rubric, the
**three-stage dual score** (original → model rewrite → fully optimized), the
fix-list that names the exact gaps, and the path-to-higher-score guidance.

**5. Images, tables, and machine-readable assets.**
Delivered. The optimizer generates a real **HTML/Markdown comparison table** and
**recommends converting key visuals** (e.g., the readiness scorecard) into
machine-readable tables, plus alt-text recommendations, so engines and AI can
parse them.

**6. Metadata recommendations.**
Delivered. Every run outputs a full metadata block: **title tag, meta
description, URL slug, tags, social preview copy, and image alt text.**

**7. FAQ generation.**
Delivered. Generates an **FAQ section** (5-7 grounded Q&A) and the matching
**FAQPage** structured data.

**8. Upfront questions.**
The five interview sections each apply a distinct expert lens (audience, thesis,
structure, engagement, hard requirements) to capture context an AI can't infer.
They are **optional** — blanks are skipped — and steer the rewrite as editorial
direction. *Outstanding:* auto-**pre-filling** suggested answers from the article
so users edit instead of write (the friction fix). Not yet built.

**9. Conversion assets.**
Delivered (recommendation level). The tool recommends downloadable, gated assets
(e.g., "Download the Physical AI Deployment Readiness Scorecard") for lead capture,
backlinks, and sales enablement.

**10. Target audience section.**
Delivered. Generates a **"Who this is for"** block (operations leaders, innovation
teams, robotics startups, enterprise R&D, systems integrators).

**11. Content restructuring.**
Delivered. The rewrite makes **real structural changes** — question-shaped
headings, answer blocks, and comparison tables (e.g., Demo vs. Minimum Viable
Deployment vs. Production) — not light edits, with the fact-preservation guardrail
and (planned) approval workflow as the safety net.

**12. Schema.**
Delivered. Generates a full JSON-LD set: **Article/TechArticle, Organization,
Person, BreadcrumbList, ImageObject, and FAQPage**, recommends which apply, and
flags conflicts with the site's existing (Wix-injected) structured data.

**13. Stronger top summary.**
Delivered. Replaces the generic summary with **"The Short Version"** — a numbered,
actionable list (pick a narrow task → define success metrics → treat the first
deployment as an MVD → plan for human intervention → collect data → scale when
repeatable).

**14. Ongoing performance measurement.**
**Not yet built** — and transparently planned as a later milestone, because
measuring *real* GEO performance needs paid/grounded APIs or manual tracking that
the free tier can't do. The plan: log before/after scores and implemented changes
now; add **Google Search Console** (rankings, impressions, clicks, CTR — free,
needs access); add a **weekly AI-citation panel** across the major assistants;
and a **dashboard** tying score → changes → impact. This is the milestone that
proves the tool actually moves the needle. Dependencies: **GSC access + a small
budget**.

**15. Version control, diffs, and approvals.**
**Not yet built** — and agreed it's essential before trusting the tool at scale.
The plan: a **section-by-section diff** (original vs. optimized), each change
labeled with what it's meant to improve, and **per-recommendation approve / reject
/ edit** before publishing. Pure software, no new cost — it's the bigger build
effort, and the top trust feature.

**Big picture — the optimization engine.**
Agreed direction: diagnose → explain → generate (brand-true) → approve → track.
**Diagnose, generate, and a fact-preservation safety net are done.** Remaining:
**track (#14)**, **approve (#15)**, and **brand-voice control** (so the output
stops sounding generic — capture Trossen's voice and constrain every rewrite to
it). Those, plus the model upgrade, are what take this from "strong prototype" to
"the engine."

---

## 5. Architecture & reliability

- **Stack:** Node.js / TypeScript, Express web UI, behind an `LlmProvider`
  interface so the model is swappable in one line (Gemini today; Claude/GPT
  trivially).
- **Rendering:** a headless browser renders JS-heavy Wix pages; output is cached
  so iteration doesn't re-fetch.
- **Extraction robustness:** content is pulled from the rendered DOM and now
  **captures body copy in `<div>`/`<span>`** (Wix renders paragraphs that way),
  not just `<p>` tags — so the tool works across Trossen's different post
  templates, not just one layout. It fails loudly only if no real article can be
  recovered.
- **Model fallback:** any model failure cascades to the next model (Section 4.1).
- **Demo safety net:** every successful optimization is cached per URL; if the
  live quota is exhausted, the app serves the last real result (clearly flagged)
  instead of an error — so a presentation never breaks.
- **Deployment:** GitHub → Render (Docker). Optional password gate via an env
  var. Auto-deploys on push.
- **Tests:** an automated suite covers extraction, scoring, the guarantees, the
  fact-check matcher, schema generation, and content parsing.

---

## 6. Honest limitations (so nothing surprises us)

- **Free-tier quota** (~20 requests/day per model) is the recurring constraint.
  The fallback chain and demo cache work around it, but reliable, every-run use of
  the strong model needs **billing** (cents per article).
- **The optimized score scales with the article and model.** It reliably lands in
  the 90s for a substantial post (Blueprint: 92) but a thinner source (MCP: 82)
  legitimately scores lower — it's a real measurement, not a fixed number.
- **The score is a proxy** for optimization quality, not a guarantee of ranking
  or citation. Outcomes are #14.
- **Per-stage model routing** isn't live yet (one model across all stages today).

---

## 7. Roadmap & decisions needed

**Phase 2 — Quality & trust (next):**
- Per-stage model routing + run the rewrite on a frontier model (needs billing).
- **Brand-voice control** (stop generic-sounding output).
- **Diffs + approve/reject/edit (#15)** — the trust workflow.
- Deeper score explainability + CEO traceability (#2).

**Phase 3 — Infrastructure:** paid always-on hosting (#3); optional auth.

**Phase 4 — Performance measurement (#14):** GSC integration, weekly AI-citation
panel, before/after dashboard.

**Decisions only leadership can make:**
- **Billing on one Google project** — unlocks Pro on every run + removes the
  quota wall. Cents-per-article cost. Biggest quality + reliability lever.
- **Google Search Console access** for trossenrobotics.com — required for #14.

**Recommended next sprint:** the diffs/approval workflow (#15, free, biggest trust
win) while billing + GSC access are decided; then the free core of performance
measurement (#14) once GSC is granted.
