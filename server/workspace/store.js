import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = user => user ? { id: user._id, email: user.email } : null;
export async function connectStore(uri, { dbName = process.env.MONGODB_DB || 'webrova' } = {}) {
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI must be a MongoDB connection string');
  const client = new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 20000 });
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Workspace requires a transaction-capable MongoDB replica set, such as Atlas');
    const store = new WorkspaceStore(client, client.db(dbName));
    await store.initialize();
    return store;
  } catch (e) { await client.close(); throw e; }
}
export class WorkspaceStore {
  constructor(client, db) {
    this.client = client;
    this.db = db;
    this.users = db.collection('wr_users');
    this.sessions = db.collection('wr_sessions');
    this.quotas = db.collection('wr_quotas');
    this.projects = db.collection('wr_projects');
    this.history = db.collection('wr_versions');
    this.shares = db.collection('wr_shares');
  }
  async initialize() {
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.sessions.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    await this.quotas.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    await this.projects.createIndex({ userId: 1, updated_at: -1 });
    await this.history.createIndex({ projectId: 1, number: 1 }, { unique: true });
    await this.shares.createIndex({ projectId: 1 }, { unique: true });
  }
  async close() { await this.client.close(); }
  async transaction(fn) {
    const session = this.client.startSession();
    try { return await session.withTransaction(() => fn(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 10000 }); }
    finally { await session.endSession(); }
  }
  async userByEmail(email) {
    const user = await this.users.findOne({ email });
    return user ? { ...publicUser(user), password: user.password } : null;
  }
  async createUser(email, password, ip, now = Date.now()) {
    await this.ensureCounters(['signup:global', 'signup:' + digest(ip)], now);
    return this.transaction(async session => {
      await this.consume(session, 'signup:global', 30, now);
      await this.consume(session, 'signup:' + digest(ip), 3, now);
      const user = { _id: randomUUID(), email, password, projectCount: 0 };
      await this.users.insertOne(user, { session });
      return publicUser(user);
    });
  }
  async session(userId) {
    const token = randomBytes(32).toString('base64url');
    await this.sessions.insertOne({ _id: digest(token), userId, expires: new Date(Date.now() + 7 * 86400000) });
    return token;
  }
  async user(token) {
    if (!token) return null;
    // Explicit expiry check: TTL cleanup is asynchronous.
    const row = await this.sessions.findOne({ _id: digest(token), expires: { $gt: new Date() } });
    return row ? publicUser(await this.users.findOne({ _id: row.userId })) : null;
  }
  async logout(token) { if (token) await this.sessions.deleteOne({ _id: digest(token) }); }
  async ensureCounters(scopes, now) {
    const day = new Date(now).toISOString().slice(0, 10);
    for (const scope of scopes) {
      try { await this.quotas.updateOne({ _id: day + ':' + scope }, { $setOnInsert: { used: 0, expires: new Date(Date.parse(day) + 3 * 86400000) } }, { upsert: true }); }
      catch (e) { if (e.code !== 11000) throw e; }
    }
  }
  async consume(session, scope, limit, now) {
    if (!Number.isInteger(limit) || limit < 1) throw fail(429, 'Daily demo limit reached. Credits reset at 00:00 UTC.');
    const day = new Date(now).toISOString().slice(0, 10);
    const updated = await this.quotas.updateOne({ _id: day + ':' + scope, used: { $lt: limit } }, { $inc: { used: 1 } }, { session });
    if (!updated.matchedCount) throw fail(429, 'Daily demo limit reached. Credits reset at 00:00 UTC.');
  }
  async authAttempt(ip) {
    const now = Date.now(), scope = 'auth:' + digest(ip);
    await this.ensureCounters([scope], now);
    return this.transaction(session => this.consume(session, scope, 60, now));
  }
  async reserve(userId, ip, limits, now = Date.now()) {
    const scopes = ['build:global', 'build:user:' + userId, 'build:ip:' + digest(ip)];
    // Initial zero counters are idempotent; only the bounded transaction spends credits.
    await this.ensureCounters(scopes, now);
    return this.transaction(async session => {
      await this.consume(session, scopes[0], limits.global, now);
      await this.consume(session, scopes[1], limits.user, now);
      await this.consume(session, scopes[2], limits.ip, now);
    });
  }
  async credits(userId, limits) {
    const day = new Date().toISOString().slice(0, 10);
    const userKey = day + ':build:user:' + userId, globalKey = day + ':build:global';
    const rows = await this.quotas.find({ _id: { $in: [userKey, globalKey] } }).toArray();
    const used = id => rows.find(row => row._id === id)?.used || 0;
    return { remaining: Math.max(0, limits.user - used(userKey)), limit: limits.user, globalRemaining: Math.max(0, limits.global - used(globalKey)), resetAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString() };
  }
  async list(userId) {
    const rows = await this.projects.find({ userId }, { projection: { title: 1, head: 1, updated_at: 1 } }).sort({ updated_at: -1 }).toArray();
    return rows.map(({ _id, ...row }) => ({ ...row, id: _id }));
  }
  async owned(userId, id, session) {
    if (typeof id !== 'string') throw fail(404, 'Project not found.');
    const row = await this.projects.findOne({ _id: id, userId }, { session });
    if (!row) throw fail(404, 'Project not found.');
    return row;
  }
  async project(userId, id) {
    const row = await this.owned(userId, id);
    const version = await this.history.findOne({ projectId: id, number: row.head });
    if (!version) throw fail(503, 'Project version is unavailable.');
    return { ...version.snapshot, id, head: row.head, cloud: true };
  }
  async versions(userId, id) {
    await this.owned(userId, id);
    return this.history.find({ projectId: id }, { projection: { _id: 0, number: 1, label: 1, created_at: 1 } }).sort({ number: -1 }).toArray();
  }
  async version(userId, id, number) {
    await this.owned(userId, id);
    const row = await this.history.findOne({ projectId: id, number });
    if (!row) throw fail(404, 'Version not found.');
    return row.snapshot;
  }
  async save(userId, id, expectedHead, snapshot, label) {
    // Stable ID across transaction retries. The callback has no external side effects.
    const newId = id || randomUUID();
    return this.transaction(async session => {
      let row;
      if (id) row = await this.owned(userId, id, session);
      else {
        const owner = await this.users.updateOne({ _id: userId, projectCount: { $lt: 20 } }, { $inc: { projectCount: 1 } }, { session });
        if (!owner.matchedCount) throw fail(409, 'Demo workspace holds up to 20 projects.');
        row = { head: 0 };
      }
      if (row.head !== expectedHead) throw fail(409, 'Project changed in another tab. Reopen it before saving.');
      if (row.head >= 30) throw fail(409, 'This demo keeps up to 30 versions per project. Download a ZIP to continue separately.');
      const head = row.head + 1, at = new Date().toISOString();
      if (id) {
        const updated = await this.projects.updateOne({ _id: id, userId, head: expectedHead }, { $set: { title: snapshot.title, head, updated_at: at } }, { session });
        if (!updated.matchedCount) throw fail(409, 'Project changed in another tab. Reopen it before saving.');
      } else await this.projects.insertOne({ _id: newId, userId, title: snapshot.title, head, updated_at: at }, { session });
      await this.history.insertOne({ projectId: newId, number: head, label: label.slice(0, 180), created_at: at, snapshot }, { session });
      return { ...snapshot, id: newId, head, cloud: true };
    });
  }
  async share(userId, id, expectedHead) {
    const token = randomBytes(24).toString('base64url');
    return this.transaction(async session => {
      const row = await this.owned(userId, id, session);
      if (row.head !== expectedHead) throw fail(409, 'Save and reopen the current version before sharing.');
      const version = await this.history.findOne({ projectId: id, number: row.head }, { session });
      await this.shares.deleteOne({ projectId: id }, { session });
      await this.shares.insertOne({ _id: token, projectId: id, snapshot: version.snapshot }, { session });
      return token;
    });
  }
  async unshare(userId, id) {
    await this.owned(userId, id);
    await this.shares.deleteOne({ projectId: id });
  }
  async shared(token) {
    const row = await this.shares.findOne({ _id: token });
    if (!row) throw fail(404, 'Share link is unavailable or has been revoked.');
    const p = row.snapshot;
    return { title: p.title, summary: p.summary, files: p.files, report: p.report, generatedAt: p.generatedAt };
  }
}
