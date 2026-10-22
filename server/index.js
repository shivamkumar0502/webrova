/**
 * server/index.js — Express + WebSocket Server Entry Point
 * 
 * FIRST PRINCIPLES:
 * This is the "glue" between:
 *   1. React Dashboard (frontend, port 5173)
 *   2. LangGraph Pipeline (backend logic)
 *   3. Docker Sandbox (containers managed by pipeline)
 * 
 * It provides:
 *   - REST API on /api/* for CRUD operations
 *   - WebSocket on /ws for real-time streaming
 *   - CORS for frontend dev server
 * 
 * STARTUP SEQUENCE:
 *   1. Load env vars
 *   2. Initialize Gemini
 *   3. Start Express + attach WebSocket
 *   4. Ready for frontend connections
 */

import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { accessGate, login, authorized } from "./auth.js";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import { initGemini } from "../src/utils/gemini.js";
import projectRoutes from "./routes/projects.js";
import { initWebSocket } from "./ws/handler.js";

const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ─── Express App ─────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production" && (!process.env.ACCESS_PASSWORD || !process.env.REDIS_URL)) throw new Error("Production requires ACCESS_PASSWORD and REDIS_URL");

// Middleware
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`   ${req.method} ${req.path}`);
  }
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    gemini: !!process.env.GEMINI_API_KEY,
    timestamp: Date.now(),
  });
});

// Project routes
// Single same-origin deployment keeps authentication and WebSockets on one origin.
app.post("/api/login", login);
app.get("/api/session", (req, res) => res.json({ authenticated: authorized(req) }));
app.use("/api/projects", accessGate, projectRoutes);
const dashboardDist = path.resolve("dashboard/dist");
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}

// ─── HTTP + WebSocket Server ─────────────────────────────────

const server = createServer(app);

// WebSocket server — shares the same HTTP server
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 65536,
  verifyClient: ({ req }) => authorized(req),
});

initWebSocket(wss);

// ─── Startup ─────────────────────────────────────────────────

async function start() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                                                          ║");
  console.log("║   🤖  AI DEV TEAM — Mission Control Server              ║");
  console.log("║   Phase 7: Web Dashboard                                 ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  // 1. Initialize Gemini
  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`   ✅ Gemini initialized (model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`);
  } catch (error) {
    console.warn(`   ⚠️  Gemini not available: ${error.message}`);
    console.warn("      Set GEMINI_API_KEY in .env for full functionality");
  }

  // 2. Start server
  server.listen(PORT, () => {
    console.log(`   ✅ REST API:    http://localhost:${PORT}/api`);
    console.log(`   ✅ WebSocket:   ws://localhost:${PORT}/ws`);
    console.log(`   ✅ Frontend:    ${FRONTEND_URL}`);
    console.log("");
    console.log("   Waiting for dashboard connections...");
    console.log("");
  });
}

process.on("SIGTERM", () => {
  server.close(); wss.close();
  setTimeout(() => process.exit(0), 10000).unref();
});
start().catch((error) => {
  console.error("   ❌ Server failed to start:", error);
  process.exit(1);
});