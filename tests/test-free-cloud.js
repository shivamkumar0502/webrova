import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreeApp } from '../server/free/index.js';
import { generateProject, validateProject } from '../server/free/generation.js';
import { previewDocument } from '../dashboard/src/free/preview.js';
import { demoProject } from '../dashboard/src/free/demoProject.js';

const key = 'AIza' + 'x'.repeat(35);
test('generated files reject zip traversal, duplicates and oversized payloads', () => {
  assert.equal(validateProject(demoProject).files.length, 5);
  for (const bad of ['../secret', '/absolute', 'backend/.env', '.git/config', 'backend\\secret']) {
    assert.throws(() => validateProject({ title: 'x', files: [...demoProject.files, { path: bad, content: '' }] }));
  }
  assert.throws(() => validateProject({ title: 'x', files: [{ path: 'frontend/index.html', content: 'x'.repeat(300001) }] }));
  assert.throws(() => validateProject({ title: 'x', files: [demoProject.files[0], demoProject.files[0]] }));
});
test('free AI call uses one bounded response, no thinking budget or paid fallback', async () => {
  let calls = 0;
  const client = { models: { generateContent: async options => {
    calls++;
    assert.equal(options.config.maxOutputTokens, 16384);
    assert.equal(options.config.thinkingConfig.thinkingBudget, 0);
    assert.equal(options.model, 'gemini-2.5-flash');
    assert.equal(JSON.stringify(options).includes(key), false);
    return { text: JSON.stringify(demoProject), candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 } };
  } } };
  const result = await generateProject({ requirement: 'Build a task board', apiKey: key, client });
  assert.equal(result.files.length, 5); assert.equal(calls, 1); assert.equal(result.usage.output, 100);
  client.models.generateContent = async () => ({ text: '{}', candidates: [{ finishReason: 'MAX_TOKENS' }] });
  await assert.rejects(generateProject({ requirement: 'test', client }), /Output limit/);
});
test('preview policy precedes generated code and blocks network access', () => {
  const doc = previewDocument(demoProject.files);
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('FOCUS BOARD'));
  assert.match(doc, /connect-src 'none'/); assert.match(doc, /form-action 'none'/);
});
test('free cloud HTTP validates keys, applies throttling and redacts provider errors', async () => {
  let calls = 0, mode = 'success';
  const app = createFreeApp({ generate: async options => {
    calls++; assert.equal(options.apiKey, key);
    if (mode === 'quota') throw Object.assign(new Error('provider secret ' + key), { status: 429 });
    return demoProject;
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.mode, 'free-cloud');
    assert.equal((await post({ requirement: 'Build a task app' })).status, 401);
    assert.equal((await post({ requirement: 'x' }, { 'X-Gemini-Key': key })).status, 400);
    assert.equal((await post({ requirement: 'Build a task app' }, { 'X-Gemini-Key': key, Origin: 'https://other.example' })).status, 403);
    const first = await post({ requirement: 'Build a task app' }, { 'X-Gemini-Key': key });
    assert.equal(first.status, 200); assert.equal((await first.json()).title, 'Focus Board');
    assert.equal((await post({ requirement: 'Build a task app' }, { 'X-Gemini-Key': key })).status, 429);
    assert.equal(calls, 1);
    mode = 'quota';
    const quota = await post({ requirement: 'Build a task app' }, { 'X-Gemini-Key': key, 'X-Forwarded-For': '192.0.2.1' });
    assert.equal(quota.status, 429); assert.equal((await quota.text()).includes(key), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('downloaded sample backend can perform a real SQLite CRUD cycle', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { createServer } = await import('node:net');
  const folder = await mkdtemp(path.join(tmpdir(), 'webrova-sample-'));
  const require = createRequire(import.meta.url);
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await new Promise(r => probe.once('listening', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  let child;
  try {
    await mkdir(path.join(folder, 'backend')); await mkdir(path.join(folder, 'frontend'));
    const code = demoProject.files.find(f => f.path === 'backend/server.mjs').content.replace("from 'express'", `from '${pathToFileURL(require.resolve('express')).href}'`);
    await writeFile(path.join(folder, 'backend/server.mjs'), code);
    await writeFile(path.join(folder, 'frontend/index.html'), demoProject.files[0].content);
    child = spawn(process.execPath, [path.join(folder, 'backend/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.ok(ready, 'sample backend starts');
    const create = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Learning demo' }) });
    assert.equal(create.status, 201); const task = await create.json();
    assert.equal((await (await fetch(base + '/api/tasks')).json()).length, 1);
    assert.equal((await fetch(base + '/api/tasks/' + task.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) })).status, 200);
    assert.equal((await (await fetch(base + '/api/tasks')).json())[0].done, 1);
    assert.equal((await fetch(base + '/api/tasks/' + task.id, { method: 'DELETE' })).status, 200);
    assert.equal((await (await fetch(base + '/api/tasks')).json()).length, 0);
  } finally { if (child) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); } await rm(folder, { recursive: true, force: true }); }
});

test('keys are opaque and copied env assignments/quotes are normalized', async () => {
  const { normalizeApiKey, hasApiKeyFormat } = await import('../shared/apiKey.js');
  const opaque = 'AQ.' + 'a'.repeat(80);
  assert.equal(normalizeApiKey('  GEMINI_API_KEY="' + key + '"  '), key);
  assert.equal(normalizeApiKey("  '" + key + "'  "), key);
  assert.ok(hasApiKeyFormat(opaque));
  assert.equal(hasApiKeyFormat('x'.repeat(20) + '\n' + 'y'.repeat(20)), false);
  let delivered;
  const server = createFreeApp({ generate: async options => { delivered = options.apiKey; return demoProject; } }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': 'GEMINI_API_KEY="' + opaque + '"' }, body: JSON.stringify({ requirement: 'Build a small task board' }) });
    assert.equal(response.status, 200);
    assert.equal(delivered, opaque);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
