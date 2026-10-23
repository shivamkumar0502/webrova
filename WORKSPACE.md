# Webrova Studio

A portfolio app builder with private cloud workspaces, bounded AI generation, version history, build receipts and revocable public source snapshots. Generated backend code is exported, not executed on this service.

## Activate on the existing Render service

Keep the Node runtime and free web instance. Build: `npm ci --omit=dev && npm run build`. Start: `npm start`.

Set these in Render → webrova-builder → Environment, then deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | A persistent PostgreSQL connection string from your database provider, with its required TLS parameters |
| `GEMINI_API_KEY` | Your private Gemini API key; never a `VITE_` variable |
| `NODE_ENV` | `production` |
| `DAILY_USER_BUILDS` | `3` |
| `DAILY_GLOBAL_BUILDS` | `20` |
| `DAILY_IP_BUILDS` | `6` |

The application creates `wr_*` tables on startup. Use a database account that owns these tables. A failed database connection prevents startup rather than silently losing accounts or replacing storage with memory. Without DATABASE_URL, the app serves the local sample workspace and explicitly reports accounts unavailable. Without the owner key, accounts and manual cloud saves work, but AI builds return a configuration message. The existing `/byok` builder remains available during migration; it never consumes the owner's key.

Render free web files disappear on sleep/restart, so do not point accounts at local SQLite. Render free Postgres expires after 30 days; for a longer portfolio demo, supply an external persistent PostgreSQL database (for example a free-tier project in your own Neon/Supabase account). Check that provider's current storage, inactivity, expiry and billing limits. No database, paid service or paid AI fallback is provisioned by this code.

## What is implemented

- Email/password registration and login; asynchronous salted scrypt password hashes; 256-bit random sessions stored as hashes; seven-day HttpOnly, SameSite=Strict cookies, Secure on Render.
- Server-side project ownership checks, same-origin mutation checks, parameterized SQL and authentication throttling. No email verification or password recovery yet; use a unique demo password. This is a portfolio demo, not a finished commercial identity system.
- PostgreSQL transaction-backed per-user, per-IP and global daily attempt counters. One build/edit attempt consumes one credit when reserved, even if generation later fails or is cancelled. Failed quota reservations roll back every counter. UTC daily reset. Two simultaneous builds per process, one per account per process.
- Three user attempts/day, twenty global/day, six/IP/day by default. Positive configured values are capped at 20/200/30 respectively. These limits control request count, not a guaranteed dollar spend: use provider quotas/budget controls too.
- Existing-project AI edits send the current saved files and return a validated complete snapshot in one bounded model call. Unsaved manual edits must be saved or discarded first. Edits over 150 KB of serialized source are refused before quota reservation.
- Cloud projects: up to 20 per account and 30 append-only versions/project. Optimistic version checks reject stale saves from other tabs. Restore appends a new version without AI usage. Local sample projects keep the last 10 saved versions.
- Side-by-side file comparisons with added/modified/removed/unchanged labels.
- Build receipt: file count, UTF-8 source size, measured generation duration, model-reported token counts, file changes, structural validation and explicitly unrun backend/security checks. ZIP includes the receipt.
- Public sharing publishes a fixed saved source snapshot under an unguessable token. Later edits remain private. Replacing/revoking invalidates the old link. The page supports isolated preview, source inspection and ZIP download. Sharing includes all source, so users review it before publishing.
- API keys never reach the Studio client, project snapshots, cookies or reports. Each AI request has a 100-second abort deadline and 16,384 output-token ceiling. No paid model fallback and no execution of generated backend code.

## Validation

`npm ci && npm run build && npm run test:free && npm run test:workspace`

Workspace integration tests use an actual embedded PostgreSQL engine (PGlite), real SQL transactions, HTTP endpoints and test-only mocked model responses. They cover signup, invalid login, session flags/logout, unauthorized requests, cross-account access, quota rollbacks/concurrency, complete edit context, immutable shared snapshots, stale-save rejection, restore and revocation. Tests do not call Google or verify generated backend behavior beyond the trusted exported sample test.

## Interview explanation

“I built an AI app-builder demo that supports complete-source edits, isolated frontend previews, append-only versions, build receipts and revocable project sharing. I used PostgreSQL transactions for shared quota enforcement and optimistic concurrency for version saves, keeping the owner model key server-side. Generated backend code is exported rather than executed.”

Future commercial work: verified identity and recovery, stronger abuse controls, durable job coordination across app instances, database backups/retention, observability and a real isolated runtime for generated backend tests. Process-local in-flight guards do not provide global concurrency coordination across replicas; transactional daily counters do.
