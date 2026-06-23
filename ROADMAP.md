# Roadmap

Current status of the Golf Pool Scoreboard. See [README.md](README.md) for how
things work and [BACKLOG.md](BACKLOG.md) for the original idea capture.

_Last updated: 2026-06-22._

## ✅ Shipped

- **Hosting** — free on Render + Neon; GitHub auto-deploy; keep-alive pinger; typecheck CI gate; idempotent migrations.
- **Live scoreboard** — best-4-of-6 scoring, cut/WD/DQ penalties, projected cut line + RISK badges (per-tournament Top 50/60/70), THRU/tee times, champion celebration, richer event header (dates / TV / status), optional hole-by-hole scorecard toggle.
- **View any tournament** — header dropdown to see past events, not just the active one.
- **Admin** — PGA-schedule event picker; create / rename / delete tournaments; edit ESPN ID / year; set active; cut size; pick deadline; JSON backup; force refresh; clear a member's picks.
- **Golfer Tiers** (majors) — build 5 tiers from winner odds (8-per-tier default, draggable dividers), tiered pick entry (1 per tier + extra from T4/T5), odds-sorted dropdowns, re-tier validation.
- **Self-service picks** — per-member secret links, own-pick page with lock, scoreboard pick masking until reveal, email reminders via Brevo + admin "Nudge now".
- **Import past events** — admin tool to backfill completed majors from ESPN's official final scores + pasted picks (ESPN's `?dates=<year>` endpoint; `?event=<id>` doesn't serve historical). Frozen, viewable via the tournament dropdown.

## 🔜 Next — small, ready to build

- **Country flags** on the scoreboard + pick lists (ESPN `athlete.flag`; needs a `golfers.country` column populated on refresh).
- **Standings-over-rounds chart** (`recharts` is already a dependency).
- **Player ESPN profile links** from golfer names (opens ESPN; bio data isn't in the API).
- **Automated daily reminders** — the endpoint exists (`/api/cron/reminders`); just needs the external cron wired (see Ops).

## 🗓 Later — bigger or needs design

- **Season view** — standings across all four majors in a year.
- **Notify members on re-tier** — email the members whose submitted picks a re-tier invalidated (admin already sees the warnings).
- **SMS reminders** — only if the cost is acceptable (Twilio ~$0.01/text + ~$1.15/mo number; not free).
- **Regenerate the typed API client** — several newer response fields (`picksLockAt`, `picksRevealed`, `roster`, `statusDetail`, `holeScores`, …) are read loosely as `any`; regenerate the OpenAPI spec + client for type safety.
- **Reminder timezone** — reminder emails show the deadline in ET (hardcoded); make it configurable if the pool runs on another timezone.

## ⚙️ Ops / setup (not code — your action)

- [x] Set `BREVO_API_KEY` + `EMAIL_FROM` in Render to enable reminder emails.
- [ ] For automated daily nudges: add `CRON_SECRET` in Render + a free [cron-job.org](https://cron-job.org) job hitting `POST /api/cron/reminders` (header `X-Cron-Secret`).
- [ ] Lengthen `ADMIN_PASSWORD` in Render (it was short).
- [ ] Turn on the UptimeRobot keep-alive (`/api/healthz/db`, every 5 min) around tournament time.
- [ ] **Live dry-run for the 2026 majors** — point a tournament at the real ESPN event id and verify tiers → picks → masking → reveal → scoring end-to-end on a live event (so far tested against finished events).
