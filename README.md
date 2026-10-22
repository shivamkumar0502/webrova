# Webrova

An AI code builder for learning and portfolios: describe a small app, generate frontend/backend/database source, inspect and edit files, preview the frontend, and download the full project as a ZIP.

## Deploy 

Create a **Node Web Service** from this repository and the branch containing this README.

- Compute plan: **Free** (do not select a paid plan).
- Build command: `npm ci --omit=dev && npm run build`
- Start command: `npm start`
- Environment: `NODE_ENV=production`, `NODE_VERSION=22.16.0`, `GEMINI_MODEL=gemini-2.5-flash`.
- Optional HTTP health check: `/api/health`.
- No attached disk, database, Redis, E2B account or shared owner API key is needed.
- Render assigns the public `onrender.com` subdomain and HTTPS.

Open Settings in the deployed app and enter **your own Gemini API key**. Use a free-tier Google API project if you want to stay within its free quota; a paid-tier key can incur Google charges. The key stays in page memory, is sent over HTTPS to this server and Google for generation, and is not saved to browser storage, filesystem or server logs. Refreshing clears it. The server intentionally ignores a shared `GEMINI_API_KEY`, so public visitors cannot consume an owner's key. Do not reuse previously committed keys.

Try **Sample project** without a key. This opens a clearly labelled, deterministic sample task board; it makes no AI request and does not claim to be AI-generated in that session.

## What works

- One bounded Gemini request per generation; no paid model fallback, automatic retries or thinking budget.
- Frontend HTML/CSS/JS and exported Node/Express/SQLite backend code.
- An isolated frontend iframe with an opaque origin and network-blocking CSP.
- Editable source files, refreshable desktop/mobile preview, copy and ZIP export.
- The current project is saved in your browser's session storage (API keys excluded). Download the ZIP to keep it permanently.
- Request-size/file-size limits, path validation, at most two active generations per instance, per-IP pacing, timeout/cancellation, and redacted provider errors.
- The API never executes generated server code, installs generated packages, or creates a database/VM.

## What free deployment does not provide

The live **Webrova builder** is cloud-hosted. Its preview runs only frontend scripts using sample/in-memory data. Generated backend and database source is exported but is **not run or runtime-verified by Webrova**. It needs its own suitable runtime/database if you later deploy the generated app. Generated source still needs review and testing.

Render Free sleeps after inactivity and has cold starts, ephemeral filesystems and shared monthly workspace quotas. Data in server memory/files cannot survive restarts; this app therefore returns generated files directly to the browser rather than storing projects on the server. Browser session storage is not a cloud backup. Free hosting is limited, not unlimited; review Render usage settings and provider quotas. No keep-alive pings or paid resources are provisioned.

The older LangGraph/isolated-runtime implementation remains in source for learning, with its dependencies moved to development-only dependencies. The default `npm start` and dashboard now use the free cloud mode. The archived advanced server is not required for this deployment.

## Development and tests

`npm ci` installs development dependencies for the offline test suite. `npm run build` installs/builds the React dashboard; `npm start` serves it and the API. Node 22+ is required.

- `npm run test:free`: request validation, provider behavior, no paid fallback, preview CSP and file/path checks.
- `npm run test:all:mock`: archived graph/pipeline and platform tests with mocked external calls.
- `npm run build`: production frontend bundle.

Production deployments only need the three root runtime dependencies (Express, dotenv and Google GenAI); heavy LangGraph/E2B dependencies are excluded by `--omit=dev`. Frontend build tooling is installed only during the build.
