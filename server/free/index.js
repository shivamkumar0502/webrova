import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProject } from './generation.js';

export function createFreeApp({ generate = generateProject } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '24kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'free-cloud', ai: 'bring-your-own-gemini-key', execution: 'frontend-preview-only', storage: 'browser-export', version: '3.0.0' }));
  let active = 0;
  const lastRequest = new Map();
  const sweeper = setInterval(() => { for (const [key, at] of lastRequest) if (Date.now() - at > 60000) lastRequest.delete(key); }, 60000);
  sweeper.unref();
  app.post('/api/generate', async (req, res) => {
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Use this app from its own website.' }); }
      catch { return res.status(403).json({ error: 'Invalid origin' }); }
    }
    const requirement = req.body?.requirement;
    if (typeof requirement !== 'string' || requirement.trim().length < 10 || requirement.length > 6000) return res.status(400).json({ error: 'Describe your app in 10–6000 characters.' });
    // BYOK only: no public endpoint can consume the owner's shared paid credentials.
    const apiKey = req.get('x-gemini-key') || '';
    if (!/^AIza[A-Za-z0-9_-]{25,100}$/.test(apiKey)) return res.status(401).json({ error: 'Add your Gemini API key in Settings. It is used for this request only.' });
    const now = Date.now(), address = req.ip;
    if (active >= 2 || now - (lastRequest.get(address) || 0) < 15000) {
      res.setHeader('Retry-After', '15'); return res.status(429).json({ error: 'Please wait 15 seconds before another build.' });
    }
    if (lastRequest.size >= 2000 && !lastRequest.has(address)) return res.status(503).json({ error: 'Demo is busy. Please retry later.' });
    lastRequest.set(address, now); active++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 100000);
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', onClose);
    try {
      const project = await generate({ requirement: requirement.trim(), apiKey, signal: abort.signal, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
      if (!res.destroyed) res.json(project);
    } catch (error) {
      const status = Number(error.status || error.code);
      const quota = status === 429 || /RESOURCE_EXHAUSTED/.test(error.message || '');
      const auth = [400, 401, 403].includes(status);
      if (!res.destroyed) res.status(quota ? 429 : auth ? 401 : abort.signal.aborted ? 504 : error.status === 422 ? 422 : 502).json({ error: quota ? 'Gemini quota reached. Check your AI Studio limits and retry after reset. No paid fallback was used.' : auth ? 'Google rejected the key or model access. Check the API key in AI Studio.' : abort.signal.aborted ? 'Build timed out. Try a smaller app.' : error.status === 422 ? error.message : 'Generation failed. Check your key, quota and model availability; then retry.' });
    } finally {
      clearTimeout(timer); res.off('close', onClose); active--;
      // Neither prompts, generated projects nor keys are retained on the server.
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request body' }));
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createFreeApp().listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Webrova free cloud ready'));
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 10000).unref(); });
}
