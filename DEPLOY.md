# Deploying the optimizer to the cloud (permanent URL)

This gives your boss a link he opens in any browser — no install, no terminal,
no API key on his end. Hosted on **Render** (free tier). Everything is done in
Render's web dashboard; no commands.

## One-time setup (~5 minutes, in the browser)

1. Go to **https://render.com** and sign up (free) — "Sign in with GitHub" is
   easiest, and it lets Render see the `TrossenRobotics/kedar_projects` repo.
2. Click **New → Blueprint**.
3. Select the **`kedar_projects`** repo. Render finds `render.yaml` and shows a
   service named **geo-optimizer**. Click **Apply**.
4. Render asks for the two secret values (because they're marked `sync:false`):
   - **`GEMINI_API_KEY`** — a free Gemini key from
     https://aistudio.google.com/apikey. Use a key with billing if you expect
     real usage (the free tier is ~20 optimizations/day, shared across everyone
     who uses the site).
   - **`APP_PASSWORD`** — pick any password. The site will prompt for it; share
     it with whoever should have access. (Username can be anything.)
5. Click **Create / Deploy**. First build takes ~5-10 min (it installs Chromium).

When it's done, Render shows a URL like `https://geo-optimizer.onrender.com`.
Open it, enter the password, and use the app exactly like the local version.

## Things to know

- **Free tier sleeps.** After ~15 min idle the service spins down; the next
  visit takes ~30-60s to wake. Fine for occasional use. Upgrade the plan for
  always-on.
- **Shared quota.** Everyone using the site shares the one `GEMINI_API_KEY`. The
  free Gemini tier (~20/day) will run out fast if several people use it — add
  billing to the Google key for real shared use.
- **Updates auto-deploy.** `autoDeploy: true` means any push to `main` rebuilds
  the site automatically.
- **The password gate** is on whenever `APP_PASSWORD` is set. Remove that env var
  in Render to make the site fully open (not recommended — it burns your quota).

## Alternative hosts

The `Dockerfile` is standard, so Railway, Fly.io, or any Docker host works too —
set `GEMINI_API_KEY` and `APP_PASSWORD` as env vars and point it at
`geo-optimizer/Dockerfile`. Render is just the least-friction option.
