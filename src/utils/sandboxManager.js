/** Docker-free workspaces. Generated commands run only in an isolated E2B sandbox. */
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import { migrationSQL } from "./migrations.js";
import path from "node:path";
const sandboxes = new Map();
const baseDir = () => path.resolve(process.env.SANDBOX_DIR || "sandboxes");
export function safePath(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\\") || relative.includes("\0")) throw new Error("Invalid workspace path");
  if (relative.split("/").some(part => part === ".git")) throw new Error("Git metadata is protected");
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("Path escapes workspace");
  let cursor = resolved;
  while (cursor !== path.resolve(root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Symlinks are not allowed");
    cursor = path.dirname(cursor);
  }
  return resolved;
}
const git = (folder, args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: folder, stdio: "pipe", encoding: "utf8", timeout: 10000 });
function workspace(id) {
  if (!/^sandbox-[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid sandbox ID");
  if (!sandboxes.has(id)) {
    const folder = safePath(baseDir(), id);
    if (!fs.existsSync(folder)) throw new Error("Workspace not found");
    sandboxes.set(id, { path: folder, synced: new Map() });
  }
  return sandboxes.get(id);
}
export async function createSandbox(folderStructure, dependencies, dbSchema) {
  const sandboxId = `sandbox-${randomUUID()}`;
  const sandboxBase = baseDir();
  const sandboxPath = path.join(sandboxBase, sandboxId);

  console.log(`   📂 Creating sandbox: ${sandboxPath}`);


  // ─── Step 1: Create local folder structure ────────────────

  fs.mkdirSync(sandboxPath, { recursive: true });

  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");
  fs.mkdirSync(backendPath, { recursive: true });
  fs.mkdirSync(frontendPath, { recursive: true });

  const backendDirs = ["src", "src/models", "src/routes", "src/middleware", "src/config", "src/utils"];
  const frontendDirs = ["src", "src/pages", "src/components", "src/hooks", "src/context", "src/utils"];
  backendDirs.forEach(d => fs.mkdirSync(path.join(backendPath, d), { recursive: true }));
  frontendDirs.forEach(d => fs.mkdirSync(path.join(frontendPath, d), { recursive: true }));

  // Parse additional folders
  if (typeof folderStructure === "string") {
    for (const line of folderStructure.split("\n")) {
      const match = line.match(/(?:├──|└──|│\s+[├└]──|\s+)\s*(.+)/);
      if (match) {
        const item = match[1].trim().replace(/\/$/, "");
        if (item && !item.includes(".") && item.length < 100) {
          try { fs.mkdirSync(safePath(sandboxPath, item), { recursive: true }); }
          catch (e) { /* skip */ }
        }
      }
    }
  }

  // ─── Step 2: Write package.json files ─────────────────────

  if (dependencies?.backend) {
    fs.writeFileSync(path.join(backendPath, "package.json"), JSON.stringify({
      name: dependencies.backend.name || "backend",
      version: "1.0.0",
      type: "module",
      main: "src/index.js",
      scripts: { start: "node src/index.js", dev: "nodemon src/index.js" },
      dependencies: dependencies.backend.dependencies || {},
      devDependencies: dependencies.backend.devDependencies || {},
    }, null, 2));
  }

  if (dependencies?.frontend) {
    fs.writeFileSync(path.join(frontendPath, "package.json"), JSON.stringify({
      name: dependencies.frontend.name || "frontend",
      version: "1.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: dependencies.frontend.dependencies || {},
      devDependencies: dependencies.frontend.devDependencies || {},
    }, null, 2));
  }

  // Detect DB type
  const dbType = dependencies?.backend?.dependencies?.mongoose ? "mongo" : "postgres";
  // A dedicated database URL must be supplied for this single-tenant instance.
  // Never share this deployment across unrelated users without per-project provisioning.
  let dbUrl = process.env.SANDBOX_DATABASE_URL || "";
  if (!dbUrl) throw new Error("SANDBOX_DATABASE_URL is required (dedicated development database)");
  const schemaName = sandboxId.replaceAll('-', '_');
  const connection = new URL(dbUrl);
  if (dbType === "postgres") {
    if (!["postgres:", "postgresql:"].includes(connection.protocol)) throw new Error("This project requires a PostgreSQL database URL");
    connection.searchParams.set("options", `-c search_path=${schemaName},public`);
  } else {
    if (!["mongodb:", "mongodb+srv:"].includes(connection.protocol)) throw new Error("This project requires a MongoDB database URL");
    connection.pathname = "/" + schemaName;
  }
  dbUrl = connection.toString();
  // ─── Step 3: Write .env files ─────────────────────────────

  fs.writeFileSync(path.join(backendPath, ".env"), [
    "PORT=5000",
    `DATABASE_URL=${dbUrl}`,
    `JWT_SECRET=${randomBytes(32).toString("hex")}`,
    "NODE_ENV=development",
  ].join("\n") + "\n");

  fs.writeFileSync(path.join(frontendPath, ".env"), [
    `VITE_API_URL=http://localhost:5000/api`,
  ].join("\n") + "\n");

  // ─── Step 3b: Deterministic scaffold files ────────────
  // These NEVER change between projects. Generating them here
  // means the LLM only writes business logic (models, routes, pages).

  // --- .gitignore ---
  fs.writeFileSync(path.join(sandboxPath, ".gitignore"), [
    "node_modules/", ".env", "dist/", ".DS_Store", "*.log",
  ].join("\n") + "\n");

  // --- Backend: src/config/db.js ---
  if (dbType === "postgres") {
    fs.writeFileSync(path.join(backendPath, "src/config/db.js"), `import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err);
});

export { pool };

export async function connectDB() {
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL');
    client.release();
  } catch (err) {
    throw err;
  }
}
`);
  } else {
    fs.writeFileSync(path.join(backendPath, "src/config/db.js"), `import mongoose from 'mongoose';
import 'dotenv/config';

export async function connectDB() {
  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('Connected to MongoDB');
  } catch (err) {
    throw err;
  }
}

export default mongoose;
`);
  }

  // --- Backend: src/index.js (Express skeleton) ---
  // This is the entry point. Routes will be injected by the assembly node later,
  // but having a working skeleton means the app can start at any point.
  fs.writeFileSync(path.join(backendPath, "src/index.js"), `import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './config/db.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══ ROUTE IMPORTS (auto-assembled after all routes are built) ═══
// ROUTE_IMPORTS_PLACEHOLDER
// ROUTE_MOUNTS_PLACEHOLDER

// Error handler (must be last)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
  });
});

export default app;
`);

  // --- Backend: src/middleware/auth.js (JWT skeleton) ---
  fs.writeFileSync(path.join(backendPath, "src/middleware/auth.js"), `import jwt from 'jsonwebtoken';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

export function authorizeRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}
`);

  // --- Frontend: index.html ---
  fs.writeFileSync(path.join(frontendPath, "index.html"), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`);

  // --- Frontend: src/main.jsx ---
  fs.writeFileSync(path.join(frontendPath, "src/main.jsx"), `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`);

  // --- Frontend: src/App.jsx (shell — pages assembled later) ---
  fs.writeFileSync(path.join(frontendPath, "src/App.jsx"), `import { BrowserRouter, Routes, Route } from 'react-router-dom';

// ═══ PAGE IMPORTS (auto-assembled after all pages are built) ═══
// PAGE_IMPORTS_PLACEHOLDER

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center"><p>Loading...</p></div>} />
        {/* PAGE_ROUTES_PLACEHOLDER */}
      </Routes>
    </BrowserRouter>
  );
}
`);

  // --- Frontend: src/index.css (Tailwind) ---
  fs.writeFileSync(path.join(frontendPath, "src/index.css"), `@tailwind base;
@tailwind components;
@tailwind utilities;
`);

  // --- Frontend: tailwind.config.js ---
  fs.writeFileSync(path.join(frontendPath, "tailwind.config.js"), `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`);

  // --- Frontend: postcss.config.js ---
  fs.writeFileSync(path.join(frontendPath, "postcss.config.js"), `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`);

  // --- Frontend: vite.config.js ---
  fs.writeFileSync(path.join(frontendPath, "vite.config.js"), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
`);

  // --- Frontend: src/utils/api.js (axios instance) ---
  fs.writeFileSync(path.join(frontendPath, "src/utils/api.js"), `import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

export default api;
`);

  console.log("   Scaffold: backend skeleton, frontend boilerplate, configs created");

  if (dbType === "postgres") {
    fs.writeFileSync(path.join(backendPath, "schema.sql"), migrationSQL(dbSchema));
    fs.writeFileSync(path.join(backendPath, "migrate.js"), `import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  await pool.query('CREATE SCHEMA IF NOT EXISTS "${schemaName}"');
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
} finally { await pool.end(); }
`);
  }
  sandboxes.set(sandboxId, { path: sandboxPath, synced: new Map() });
  git(sandboxPath, ["init"]);
  git(sandboxPath, ["config", "user.name", "Webrova"]);
  git(sandboxPath, ["config", "user.email", "builder@webrova.local"]);
  snapshot(sandboxId, "Initial scaffold");
  return sandboxId;
}
export async function reconnectSandbox(id) { try { workspace(id); return true; } catch { return false; } }
export function writeFile(id, file, content) {
  const target = safePath(workspace(id).path, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, "utf8");
}
export function readFile(id, file) {
  const target = safePath(workspace(id).path, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}
export function getFileList(id) {
  const root = workspace(id).path, files = [];
  function walk(folder, prefix = "") {
    for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist"].includes(e.name) || e.isSymbolicLink()) continue;
      const relative = prefix + e.name;
      if (e.isDirectory()) walk(path.join(folder, e.name), relative + "/");
      else files.push(relative);
    }
  }
  walk(root); return files;
}
async function runtime(id) {
  const w = workspace(id);
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is required for isolated execution");
  if (!w.remote) {
    const { Sandbox } = await import("e2b");
    w.remote = await Sandbox.create(process.env.E2B_TEMPLATE || "base", {
      apiKey: process.env.E2B_API_KEY, timeoutMs: 300000,
    });
    await w.remote.commands.run("sudo mkdir -p /app && sudo chown $(id -u):$(id -g) /app");
  }
  try { await w.remote.setTimeout(300000); }
  catch (error) {
    // Expired VMs must be recreated from the persistent source workspace.
    if (error.status !== 404 && error.statusCode !== 404) throw error;
    w.remote = null; w.synced.clear(); delete w.backendDeps; delete w.frontendDeps;
    return runtime(id);
  }
  // Upload only changed source files. Node modules remain in the remote VM.
  for (const file of getFileList(id)) {
    const data = readFile(id, file);
    const digest = createHash("sha256").update(data).digest("hex");
    if (w.synced.get(file) !== digest) {
      await w.remote.files.write("/app/" + file, data);
      w.synced.set(file, digest);
    }
  }
  return w.remote;
}
export async function executeCommand(id, command, timeout = 30000) {
  try {
    const remote = await runtime(id);
    const result = await remote.commands.run(command, { cwd: "/app", timeoutMs: timeout });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error) {
    return { stdout: error.stdout || "", stderr: error.stderr || error.message, exitCode: error.exitCode || 1 };
  }
}
export async function installDependencies(id, side) {
  if (!["backend", "frontend"].includes(side)) throw new Error("Invalid package directory");
  const w = workspace(id), manifest = readFile(id, side + "/package.json");
  const digest = createHash("sha256").update(manifest || "").digest("hex");
  if (w[side + "Deps"] === digest) return { exitCode: 0, stdout: "Dependencies unchanged", stderr: "" };
  const result = await executeCommand(id, `cd /app/${side} && npm install --no-audit --no-fund`, 120000);
  if (!result.exitCode) w[side + "Deps"] = digest;
  return result;
}
export async function releaseSandbox(id) {
  const w = sandboxes.get(id);
  if (w?.remote) {
    try { await w.remote.kill(); } finally {
      w.remote = null; w.synced.clear(); delete w.backendDeps; delete w.frontendDeps;
    }
  }
}
export function snapshot(id, message) {
  const folder = workspace(id).path;
  try {
    git(folder, ["add", "-A"]);
    git(folder, ["commit", "-m", message, "--allow-empty"]);
    const tag = "checkpoint-" + randomUUID(); git(folder, ["tag", tag]);
    return { success: true, tag, message };
  } catch (error) { return { success: false, error: error.message }; }
}
export async function rollback(id, tag) {
  if (!/^(checkpoint-[a-z0-9-]+|v[0-9.]+)$/.test(tag)) throw new Error("Invalid snapshot");
  try {
    await releaseSandbox(id);
    git(workspace(id).path, ["restore", "--source", tag, "--staged", "--worktree", "."]);
    return { success: true, rolledBackTo: tag };
  } catch (error) { return { success: false, error: error.message }; }
}
export function getSandboxPath(id) { return workspace(id).path; }
export function getSandboxInfo(id) { return { provider: "e2b", isolatedExecution: true, path: workspace(id).path }; }
export async function healthCheck(id) {
  const failures = [];
  for (const file of ["backend/package.json", "frontend/package.json"]) if (!readFile(id, file)) failures.push(file + " missing");
  if (!process.env.E2B_API_KEY) failures.push("E2B_API_KEY missing");
  if (!process.env.SANDBOX_DATABASE_URL) failures.push("Dedicated SANDBOX_DATABASE_URL missing");
  return { healthy: !failures.length, failures, provider: "e2b" };
}
export async function destroySandbox(id) {
  await releaseSandbox(id); fs.rmSync(workspace(id).path, { recursive: true, force: true }); sandboxes.delete(id);
}
