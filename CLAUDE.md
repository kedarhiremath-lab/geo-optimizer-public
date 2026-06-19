# geo-optimizer — instructions for Claude Code

This is a local web app: the **Trossen GEO/SEO Content Optimizer**. It scores a
blog post, runs a short "skills interview", and produces an AI-optimized draft
with a before→after score. Node.js + TypeScript, Express UI, Gemini for the LLM.

## When the user asks to "set up", "run", "start", or "open" this app

Do these steps for them (run the commands yourself; don't make them type):

1. **Check Node.js is installed:** `node --version`. If missing, tell them to
   install Node.js 20+ from https://nodejs.org and stop until they have it.

2. **Install dependencies** (from this folder):
   ```
   npm install
   npx playwright install chromium
   ```
   `playwright install` downloads a headless browser (~150 MB, one-time). It can
   take a couple minutes — run it in the background and wait for it to finish.

3. **Get the Gemini API key.** Check whether a `.env` file exists with a real
   `GEMINI_API_KEY`. If not, ask the user:
   > "This app needs a free Google Gemini API key. Get one at
   > https://aistudio.google.com/apikey (no billing required), then paste it here."
   When they give you the key, write `.env` (copy `.env.example` and fill it in):
   ```
   GEMINI_API_KEY=<their key>
   GEMINI_MODEL=gemini-2.5-flash
   ```
   **Never commit `.env`** — it is gitignored; keep it that way.

4. **Start the app** in the background:
   ```
   npm run ui
   ```
   Wait until the log prints `GEO/SEO optimizer UI on http://localhost:5173`,
   then tell the user: **"The app is running — open http://localhost:5173 in your
   browser."** Keep the server process running; if it stops, the page goes dead.

## How the user uses the app (once it's open)

1. Paste a trossenrobotics.com blog-post URL → **Analyze** (free, no AI): baseline
   score + gaps.
2. **Skills interview**: answer what they can (blanks skipped) — steers the rewrite.
3. **Generate optimized article** (one AI call): optimized draft + before→after
   score + any claims flagged to verify. Copy the Markdown into the CMS.

## Things to know / likely questions

- **Free-tier quota:** the Gemini free tier allows ~20 requests/day per model.
  Each "Generate" uses ~2 calls. If they hit the cap, the app shows a clear
  "daily quota reached" message — they wait for the daily reset (midnight
  Pacific), or set `GEMINI_MODEL=gemini-2.5-flash-lite` in `.env`, or add billing.
- **It's local only.** The app runs on this machine at localhost:5173. It is not
  hosted anywhere.
- **Fact-preservation:** the rewrite will not invent stats/claims not in the
  source; anything it's unsure about is flagged "claims to verify."
- **To verify it works without using AI quota:** `npm test` (runs the unit tests)
  or `npm run inspect -- <url>` (fetch + score only, no AI call).
