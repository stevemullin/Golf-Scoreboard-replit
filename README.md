# Golf Pool Scoreboard

A live scoreboard for a golf pool (fantasy-style golf). Each pool member drafts a
team of golfers; the app pulls live scores from ESPN and ranks the teams in real
time. Built as a small pnpm monorepo and hosted for free.

- **Live:** https://golf-scoreboard-hk3w.onrender.com
- **Backlog / upcoming ideas:** [BACKLOG.md](BACKLOG.md)

## How the pool works

- Each member picks **6 golfers**.
- A team's score is the sum of its **best 4** golfers' tournament totals (the
  worst 2 are dropped). Lowest total wins, golf-style (`E`, `+5`, `-3`).
- Golfers who **miss the cut / WD / DQ** are penalized for each round they don't
  play — the penalty is the **worst score posted that round** by the field
  (applied to R3 *and* R4 once the cut is made).
- The board auto-refreshes ~every 60s and shows live "thru" / tee times.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite, wouter, TanStack Query, Radix/shadcn UI, Tailwind v4, Recharts |
| API | Express 5, Pino logging |
| Database | Neon Postgres via Drizzle ORM (`drizzle-orm/node-postgres`) |
| Scores | ESPN's public golf API (`site.api.espn.com/.../golf/pga/scoreboard`) |
| Tooling | pnpm 10 workspaces, TypeScript, Node 24 |
| Hosting | Render (web service) + Neon (DB) — both free tier |

## Repository layout

```
artifacts/
  golf-pool/        # React/Vite frontend (the scoreboard + admin UI)
  api-server/       # Express API; also serves the built frontend in production
  mockup-sandbox/   # unused scaffold (not deployed)
lib/
  db/               # Drizzle schema + client (@workspace/db) + migrate.mjs
  api-spec/         # OpenAPI spec
  api-zod/          # generated Zod schemas
  api-client-react/ # generated typed React Query client
scripts/
render.yaml         # Render Blueprint (build/start/env)
.github/workflows/  # CI (typecheck + build)
```

The API server (`artifacts/api-server`) serves both the JSON API under `/api/*`
and the built frontend (SPA) for everything else, so the whole app runs as a
**single web service**.

## Features

- **Live scoreboard** — best-4-of-6 team rankings, per-round breakdown, expandable
  team detail showing each golfer's score, "thru"/tee time, and dropped golfers.
  The header shows the event's dates, TV/streaming, and live status (from ESPN).
- **Manual mode** — enter scores by hand (fallback if ESPN is unavailable).
- **Admin** (`/admin`, password-protected):
  - Create a tournament — **pick it from the PGA schedule** dropdown (autofills
    name / year / ESPN event ID), or enter the ID manually.
  - Add pool members and assign each member's 6 picks.
  - Set the active tournament; edit a tournament's ESPN ID.
  - **Cut indicator** — set a per-tournament cut size (Top 50 Masters / 60 US Open
    / 70 PGA & Open, or off). During round 2 the board shows a projected cut line
    and a yellow/red **RISK** badge on at-risk golfers.
  - **Golfer Tiers** (majors) — "Build from odds" pulls the major's winner odds
    (The-Odds-API) and orders the field by odds, then splits it into 5 tiers of 8
    by default (T1 = 1–8, T2 = 9–16, …). Adjust by **dragging** the 4 divider
    lines (or their ▲▼); unmatched players default to T5. When a tournament has
    tiers, **pick entry switches to tiered slots** (1 per tier + a 6th from
    T4/T5, each dropdown sorted by odds best-first), enforced in the UI and on
    save; re-tiering flags any picks it invalidates.
  - **Self-service picks** — each member gets a private link (`/me/<token>`) and
    makes/edits their own tiered picks until an admin-set lock time, after which
    they freeze (admin can still edit). Admin sees who has submitted; pick
    *contents* stay hidden before lock (fairness). The **public scoreboard also
    masks everyone's picks** (shows only a submitted ✓/✗ roster) until the
    admin-set deadline (or, if no deadline is set, until round 1 begins) — the
    server withholds the picks, so they can't be seen via the API either.
  - **Pick reminders (email)** — a **Nudge now** button emails everyone who
    hasn't submitted their personal pick link; the same can run daily, unattended,
    via a free external cron hitting `/api/cron/reminders`. Only fires while picks
    are open (tiers built, deadline set and in the future). Needs `BREVO_API_KEY`
    + `EMAIL_FROM` in Render (Brevo's HTTPS API — Render's free tier blocks SMTP,
    so Gmail won't work) — a no-op without them.
  - Force an ESPN refresh; **download a full JSON backup**.
- **Champion celebration** — banner + confetti when a tournament goes Final.

## Data model (Postgres)

`tournaments`, `pool_members`, `golfers`, `golfer_scores`, `team_picks`,
`manual_scores`, `api_cache`, `golfer_tiers`, `pick_submissions`. Schema lives in
`lib/db/src/schema/`. (`pool_members` carries `email` + a secret `access_token`;
`tournaments` carries `picks_lock_at`.)

## API endpoints

```
GET    /api/healthz                       liveness
GET    /api/healthz/db                    liveness + DB ping (used by keep-alive)
GET    /api/scoreboard                    live leaderboard (+ projectedCut)
GET    /api/scoreboard/manual             manual leaderboard
PUT    /api/scoreboard/manual             save a manual score
GET    /api/tournaments                   list tournaments
GET    /api/pool-members                  list pool members
POST   /api/admin/verify                  check admin password
POST   /api/admin/tournament              create tournament
PATCH  /api/admin/tournament/:id          update ESPN event id
POST   /api/admin/tournament/:id/activate set active
POST   /api/admin/tournament/:id/cut-size set/clear cut size
POST   /api/admin/pool-member             create pool member
POST   /api/admin/picks                   set a member's 6 picks
GET    /api/admin/picks/:tid/:memberId    get a member's picks
GET    /api/admin/field?espnEventId=      golfer field for an event
GET    /api/admin/events?year=            PGA schedule (for the picker)
POST   /api/admin/tiers/suggest           fetch major odds + match to field
GET    /api/admin/tiers?tournamentId=     saved tiers for a tournament
POST   /api/admin/tiers                   save tier assignments
POST   /api/admin/members                 admin roster + submission status (masked)
PATCH  /api/admin/pool-member/:id         update a member's email
POST   /api/admin/tournament/:id/lock     set/clear participant pick deadline
GET    /api/me/:token                     participant's own event + tiers + picks
POST   /api/me/:token/picks               participant submits/updates own picks
POST   /api/admin/send-reminders          email non-submitters their link ("Nudge")
POST   /api/admin/clear-picks             wipe a member's picks for a tournament
POST   /api/cron/reminders                automated reminders (X-Cron-Secret header)
POST   /api/admin/refresh                 force ESPN refresh
POST   /api/admin/export                  download full JSON backup
```
All `/api/admin/*` routes are rate-limited (30/min per IP) and gated by `ADMIN_PASSWORD`.

## Environment variables (set in Render)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon **direct** connection string. Must **not** include `channel_binding=require` (node-postgres hangs on it). |
| `ADMIN_PASSWORD` | Required — admin actions are blocked without it. Use a long value. |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `ODDS_API_KEY` | [The-Odds-API](https://the-odds-api.com) key (free tier) — powers the Golfer Tiers odds fetch (majors only). |
| `BREVO_API_KEY` | [Brevo](https://www.brevo.com) API key (free tier) for pick-reminder emails. **Sent over HTTPS** — Render's free tier blocks outbound SMTP, so Gmail/nodemailer can't be used. Optional — email is a no-op without it. |
| `EMAIL_FROM` | Verified Brevo sender address (your email). Optional `EMAIL_FROM_NAME` sets the display name. |
| `CRON_SECRET` | Shared secret required (as `X-Cron-Secret`) to trigger `/api/cron/reminders`. |
| `APP_URL` | Base URL used in links inside cron-sent emails (defaults to the live URL). |

## Hosting & deployment

Render auto-deploys on every push to `main` (Blueprint = `render.yaml`). The build:

```
pnpm 10 install (|| true to survive the cosmetic esbuild build-script gate)
→ rebuild esbuild
→ pnpm typecheck                # HARD GATE: a type error fails the build
→ build golf-pool + api-server  # Vite + esbuild
→ pnpm --filter @workspace/db migrate   # idempotent ALTER ... IF NOT EXISTS
→ drizzle-kit push-force (|| true)       # best-effort table creation for fresh DBs
```

A failed build leaves the current version live (zero downtime). **CI**
(`.github/workflows/ci.yml`) runs typecheck + build on every push/PR.

**Keep-alive:** Render's free tier sleeps after 15 min idle and Neon suspends, so
an UptimeRobot monitor pings `/api/healthz/db` every 5 minutes (keeps both warm —
turn it on around tournament time).

**Automated reminders:** point a free scheduler (e.g. [cron-job.org](https://cron-job.org))
at `POST /api/cron/reminders` once a day during pick week, sending header
`X-Cron-Secret: <CRON_SECRET>`. It emails everyone who hasn't submitted yet. (The
admin **Nudge now** button does the same on demand.)

## Local development

⚠️ The repo is tuned for Render's **linux-x64** runtime — `pnpm-workspace.yaml`
prunes non-linux native binaries (esbuild, rollup, etc.). So on macOS/Windows,
`pnpm install` + Vite/esbuild **build won't work** without un-pruning those
overrides. `pnpm typecheck` (pure `tsc`) works fine on any platform.

```bash
pnpm install            # devDeps included
pnpm typecheck          # works everywhere (the CI/deploy gate)
```

## Operational gotchas (hard-won)

- **Add DB columns via `lib/db/migrate.mjs`, not `drizzle-kit push`.** Push stalls
  on an interactive prompt in CI (it wants to add a unique constraint to a
  populated table) and silently skips column adds — that once dropped a column and
  500'd the scoreboard.
- **Neon URL:** use the direct (non-pooled) string **without** `channel_binding`.
- **ESPN** is an unofficial API and can change/break; the `manual_scores` table is
  the fallback.

## Maintenance

Keep this README current as the project evolves — update the relevant section in
the same change that adds or alters a feature, endpoint, env var, or build step.
