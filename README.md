# Webrova

An AI app builder with a React workspace, Node API and LangGraph development pipeline.

## Docker-free setup

Use Node 22+ and Git. Run `npm ci`, copy `.env.example` to `.env`, and configure Gemini, E2B and a dedicated development database. Run `npm run build && npm start`, then open http://localhost:3000. For development, use `npm run dev`; `npm run cli` preserves the interactive CLI.

Generated code executes only in E2B, never on the API host. The API stores source workspaces locally; production requires persistent disk. No Docker daemon, local Redis container, per-project database container, backend container or frontend container is created.

PostgreSQL projects receive an isolated schema and deterministic migration bootstrap. Mongo projects receive a unique database name. The database credentials are available to generated code: use a dedicated development database with a restricted role, not production data. PostgreSQL roles must be permitted to create schemas. Schema/database isolation here is organizational, not a security boundary between tenants sharing the same database role.

## Cost controls

- Choose an estimated AI budget before building, from $0.50 to $5 in the UI; the API accepts $0.05–$10.
- Output allowance uses the remaining estimated budget. Configure model-specific input and output prices in `.env`.
- Retries and thinking tokens are included in reported usage when metadata is returned. Failed transport requests may still incur provider charges that the API cannot observe.
- Outputs are capped by task role. Transient/JSON retries are bounded; truncated generated code is rejected.
- Upload changed source only and reinstall dependencies only when a package manifest changes within the same VM.
- E2B VMs have a five-minute renewable timeout and are released when builds finish, fail or cancel. A build has a twenty-minute deadline. There is no always-on preview VM.
- Only one build runs per instance. Excess starts return HTTP 429 rather than multiplying costs.

The budget is an estimate, not a billing guarantee. It excludes sandbox, hosting, database and network charges. Savings have not been benchmarked against the original implementation.

## Private deployment on Render

`render.yaml` defines a native Node web service and persistent workspace disk. The blueprint includes a paid plan; review the hosting account's current pricing before creating it. Import the GitHub repository as a Blueprint and supply:

- `ACCESS_PASSWORD`: a strong workspace access password.
- `GEMINI_API_KEY` and `E2B_API_KEY`.
- `SANDBOX_DATABASE_URL`: dedicated PostgreSQL or MongoDB development database, matching the generated app's database choice.
- `REDIS_URL`: managed Redis with JSON and Search support (for example, compatible Redis Cloud). Plain Redis/Valkey without these modules is insufficient for the existing checkpointer.

Set `LLM_INPUT_USD_PER_MILLION` and `LLM_OUTPUT_USD_PER_MILLION` to the selected model's current rates. The app reads the platform's `PORT`. Frontend, API and authenticated WebSocket share one origin. Build command: `npm ci && npm run build`. Start command: `npm start`.

The deployment has not been provisioned by this change. Live verification requires the hosting account and runtime credentials. Repository `.env` files have been removed; rotate any live credentials previously committed because removal does not erase Git history.

## Scope and scaling

This is a private, single-tenant first deployment. Password sessions protect API and WebSocket access; project ownership and user accounts are not implemented. Keep `numInstances: 1`: active runs, human-input bridges and event replay are process-local, while source workspaces use an attached disk. Multiple replicas are not supported by this change.

For concurrent users, the next architecture step is durable queued jobs, worker leases, user/project authorization, shared object storage for workspaces, per-project database credentials, and cross-instance event delivery. Add those before horizontal autoscaling. Removing Docker alone does not solve these requirements.

The dashboard adds a Build Brief with scope presets, estimated budget selection, brief review/copy, and a generated file explorer. Generated project verification installs dependencies, applies PostgreSQL migrations and checks the frontend build/backend entry syntax inside E2B. It does not publish generated apps or prove that every endpoint works; inspect `DEPLOYMENT.md` in each generated project.

## Verification

`npm run test:platform` tests workspace containment, isolated command dispatch, dependency caching, cleanup/rollback, budget accounting, and authentication without making paid API calls. `npm run test:all:mock` also runs graph, blueprint and development-loop wiring checks. `npm run build` checks the production frontend bundle. GitHub Actions runs the offline checks on pushes and pull requests.
