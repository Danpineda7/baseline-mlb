# Baseline — MLB Intelligence

A transparent MLB forecasting and paper-testing workspace. Next.js App Router,
Turso (libSQL/SQLite) for storage, deployed on Netlify with a scheduled
function that freezes forecasts, settles finished games, and imports odds
automatically.

## Stack

- **Next.js 16** (App Router) — UI and API routes
- **Turso** (`@libsql/client`) — database; all SQL is SQLite dialect
- **Netlify** — hosting, functions, and the `netlify/functions/automation.mts` cron
- **MLB Stats API** — official schedule, stats, and finals (free)
- **OddsPapi** — historical sportsbook odds (free key)
- **The Odds API** — optional live consensus odds (free key)

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `libsql://…` for production, `file:.data/local.db` for local dev |
| `TURSO_AUTH_TOKEN` | production | Turso database token |
| `ADMIN_KEY` | yes | Unlocks odds capture/import endpoints (`x-admin-key` header) |
| `ODDS_PAPI_KEY` | recommended | Historical odds imports — the market-validation evidence path |
| `ODDS_API_KEY` | optional | Automatic live ML/totals consensus |

Local development reads `.env.local` (gitignored).

## Commands

```bash
npm install        # once
npm run db:migrate # apply drizzle/*.sql to TURSO_DATABASE_URL (tracks applied tags)
npm run dev        # local dev server
npm run test:unit  # fast test suite
npm test           # production build + full suite
npm run lint
```

## How trust works (short version)

- Forecasts freeze immutably only inside a 6-hour pre-pitch window and are
  graded against official MLB finals.
- All Phase 6 evidence (market validation, activation gates, the public paper
  scoreboard) counts only rows created after `VALIDATION_EPOCH`
  ([lib/epoch.ts](lib/epoch.ts)).
- Odds writes require `ADMIN_KEY`. Paper bets count toward public results only
  when their typed price matches a stored market observation.
- Real-money picks stay locked until every gate in
  [lib/activation.ts](lib/activation.ts) passes. The dashboard shows each
  gate's progress; nothing is promoted early.

## Deploying

Pushes to `main` auto-deploy via Netlify. New database migrations
(`npm run db:generate` after editing [db/schema.ts](db/schema.ts)) must be
applied with `npm run db:migrate` pointed at the production
`TURSO_DATABASE_URL`. Bump `MODEL_VERSION`
([lib/model-version.ts](lib/model-version.ts)) whenever modeling, calibration,
or freezing logic changes.
