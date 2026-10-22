import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSandbox, readFile, writeFile, safePath, executeCommand, installDependencies, releaseSandbox, destroySandbox, snapshot, rollback } from '../src/utils/sandboxManager.js';
import { createCheckpointer } from '../src/config/graph.js';
import { initGemini, getClient, callGemini, safeCallGemini } from '../src/utils/gemini.js';
import { authorized, login } from '../server/auth.js';
import { Sandbox } from 'e2b';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webrova-test-'));
process.env.SANDBOX_DIR = root;
process.env.SANDBOX_DATABASE_URL = 'postgresql://test:test@invalid.example/app';
process.env.E2B_API_KEY = 'mock';
delete process.env.REDIS_URL;
process.env.NODE_ENV = 'test';

test('one shared development checkpointer preserves state across API calls', async () => {
  const [a, b] = await Promise.all([createCheckpointer(), createCheckpointer()]);
  assert.equal(a, b);
});

test('workspace paths reject traversal and symlinks', () => {
  for (const name of ['../outside', '/etc/passwd', 'backend/../../bad', 'backend\\..\\secret']) assert.throws(() => safePath(root, name));
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  assert.throws(() => safePath(root, 'link/secret'));
});

test('isolated execution syncs changed files, caches installs and releases runtime', async () => {
  const original = Sandbox.create;
  const uploads = [], commands = []; let killed = 0;
  Sandbox.create = async () => ({ setTimeout: async () => {}, files: { write: async (file, content) => uploads.push([file, content]) }, commands: { run: async cmd => { commands.push(cmd); return { stdout: 'ok', stderr: '', exitCode: 0 }; } }, kill: async () => { killed++; } });
  let id;
  try {
    id = await createSandbox('', { backend: { dependencies: { express: '^4.21.0' } }, frontend: { dependencies: { react: '^18.3.1' } } }, {});
    assert.ok(readFile(id, 'backend/src/index.js'));
    assert.throws(() => writeFile(id, '../escape.js', 'x'));
    await installDependencies(id, 'backend');
    const initialUploads = uploads.length;
    await installDependencies(id, 'backend');
    assert.equal(commands.filter(s => s.includes('npm install')).length, 1);
    writeFile(id, 'backend/src/changed.js', 'export const changed = 1;');
    await executeCommand(id, 'node --version');
    assert.equal(uploads.length, initialUploads + 1);
    const checkpoint = snapshot(id, 'Safe literal $(touch should-not-exist)');
    assert.equal(checkpoint.success, true);
    writeFile(id, 'backend/src/changed.js', 'broken');
    assert.equal((await rollback(id, checkpoint.tag)).success, true);
    assert.match(readFile(id, 'backend/src/changed.js'), /changed = 1/);
    assert.equal(killed, 1);
    delete process.env.E2B_API_KEY;
    const result = await executeCommand(id, 'touch host-escape');
    assert.notEqual(result.exitCode, 0);
    assert.equal(fs.existsSync(path.join(root, id, 'host-escape')), false);
  } finally {
    process.env.E2B_API_KEY = 'mock';
    if (id) await destroySandbox(id);
    Sandbox.create = original;
  }
});

test('paid retries are counted and output allowance respects remaining estimate', async () => {
  initGemini('fake-test-key');
  const calls = [];
  getClient().models.generateContent = async options => {
    calls.push(options);
    return { text: calls.length === 1 ? '{broken' : '{"ok":true}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 }, candidates: [{ finishReason: 'STOP' }] };
  };
  const result = await callGemini({ systemPrompt: 'test', userPrompt: 'test', tokenBudget: 0.01 });
  assert.equal(result.parsed.ok, true);
  assert.equal(result.tokens.input, 20);
  assert.equal(result.tokens.output, 50);
  assert.ok(calls.every(c => c.config.maxOutputTokens < 8192));
  const count = calls.length;
  await assert.rejects(callGemini({ systemPrompt: 'test', userPrompt: 'test', tokenBudget: 0.001, currentCost: 0.001 }), /TOKEN_BUDGET_EXCEEDED/);
  assert.equal(calls.length, count);
  getClient().models.generateContent = async () => ({ text: '{}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }, candidates: [{ finishReason: 'MAX_TOKENS' }] });
  const failed = await safeCallGemini({ systemPrompt: 'test', userPrompt: 'test', tokenBudget: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.tokens.output, 20);
});

test('single-tenant authentication rejects forged, expired and malformed cookies', () => {
  process.env.ACCESS_PASSWORD = 'test-workspace-password';
  assert.equal(authorized({ headers: {} }), false);
  let cookie;
  const res = { setHeader: (_, value) => { cookie = value; }, json: () => {} };
  login({ body: { password: process.env.ACCESS_PASSWORD } }, res);
  assert.equal(authorized({ headers: { cookie } }), true);
  assert.equal(authorized({ headers: { cookie: 'webrova_session=1.bad' } }), false);
  assert.equal(authorized({ headers: { cookie: `webrova_session=${Date.now() + 1000}.${'é'.repeat(64)}` } }), false);
  delete process.env.ACCESS_PASSWORD;
});

test('database bootstrap uses quoted identifiers and rejects schema injections', async () => {
  const { migrationSQL } = await import('../src/utils/migrations.js');
  const sql = migrationSQL({ tables: [{ name: 'users', fields: [{ name: 'id', type: 'UUID', constraints: ['PRIMARY KEY'] }] }, { name: 'posts', fields: [{ name: 'user_id', type: 'UUID' }], foreignKeys: [{ field: 'user_id', references: 'users(id)', onDelete: 'CASCADE' }], indexes: ['user_id'] }] });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "users"/);
  assert.match(sql, /EXCEPTION WHEN duplicate_object/);
  assert.throws(() => migrationSQL({ tables: [{ name: 'users; DROP DATABASE x', fields: [{ name: 'id', type: 'TEXT' }] }] }));
  assert.throws(() => migrationSQL({ tables: [{ name: 'users', fields: [{ name: 'id', type: 'TEXT; DROP TABLE users' }] }] }));
  assert.throws(() => safePath(root, 'backend/../.git/hooks/pre-commit'));
});
