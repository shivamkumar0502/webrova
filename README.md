# Webrova

An AI app-builder portfolio project: turn an idea into frontend, backend and database source, then iterate on it with versioned edits, isolated frontend previews and portable ZIP exports.

## Studio

- Private email/password accounts and PostgreSQL-backed projects.
- Owner-managed Gemini credentials; users spend daily demo credits instead of supplying API keys.
- Transactional user/IP/global quotas, bounded model output and no paid fallback.
- AI edits to existing source, manual code edits, append-only versions, file comparisons and restore.
- Build receipts with file changes, source size, model token usage and clearly labelled validation limits.
- Revocable public links to a specific saved source snapshot, including preview and ZIP download.

Read **[WORKSPACE.md](WORKSPACE.md)** for activation, environment variables, security boundaries, demo limits and an interview-ready explanation.

## Deploy

Use a **Node Web Service** on Render with the existing Free compute plan:

- Build: `npm ci --omit=dev && npm run build`
- Start: `npm start`
- Runtime: Node 22+; `NODE_ENV=production`.
- Cloud activation: set `DATABASE_URL` and `GEMINI_API_KEY` as server-side environment secrets. Never put them in `VITE_` variables or commit them.
- Optional health path: `/api/health`.
- No Docker, E2B, Redis or attached disk is required.

Without the cloud secrets, Studio supports sample/local projects and explicitly shows cloud setup pending. The existing **`/byok`** builder remains available during migration; its page-memory Gemini key is supplied by each user, never saved in browser storage, and never replaced by an owner key.

Use a persistent PostgreSQL database for accounts. Render's free web filesystem is ephemeral, and its free Postgres expires after 30 days. An external persistent PostgreSQL service can be connected through `DATABASE_URL`. No paid resources are provisioned by this repository.

## Runtime boundary

Webrova hosts the builder and **frontend-only** isolated preview. Generated backend/database source is exported, not executed or runtime-verified by Webrova. It requires its own runtime/database when deployed. Preview CSP blocks network access and the iframe has an opaque origin. Generated source still needs review and testing.

Local projects are saved in this browser; cloud projects require an account and a connected database. ZIP export is available for backup. Free hosting and AI quotas are limited; a paid-tier Gemini account can incur charges despite request-count caps.

The older LangGraph/isolated-runtime implementation remains in source for learning, with its dependencies excluded from production installs. The default service uses the lightweight Studio/free-cloud server.

## Development and tests

`npm ci`, `npm run build`, then `npm start` (Node 22+).

- `npm run test:workspace`: embedded PostgreSQL/HTTP integration tests for accounts, quotas, ownership, edits, versions and sharing.
- `npm run test:free`: bounded generation, file/path validation, preview isolation and exported sample backend checks.
- `npm run test:platform`, `npm run test:graph`, `npm run test:validator`: archived platform and mock pipeline checks.

Tests never require a real Gemini key. Workspace tests use test-only model responses; live Google generation is a separate check after configuring the owner's key.
