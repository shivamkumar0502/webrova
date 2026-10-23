import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const digest = value => createHash('sha256').update(value).digest('hex');
export const schema = `
CREATE TABLE IF NOT EXISTS wr_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wr_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES wr_users(id) ON DELETE CASCADE, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS wr_quotas (scope TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(scope,day));
CREATE TABLE IF NOT EXISTS wr_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES wr_users(id) ON DELETE CASCADE, title TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wr_owner_idx ON wr_projects(user_id);
CREATE TABLE IF NOT EXISTS wr_versions (project_id TEXT NOT NULL REFERENCES wr_projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(project_id,number));
CREATE TABLE IF NOT EXISTS wr_shares (token TEXT PRIMARY KEY, project_id TEXT UNIQUE NOT NULL REFERENCES wr_projects(id) ON DELETE CASCADE, snapshot TEXT NOT NULL);
`;
export async function connectStore(url) {
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get('sslmode');
  const tls = ['require','verify-ca','verify-full'].includes(sslMode);
  if (tls) { parsed.searchParams.delete('sslmode'); parsed.searchParams.delete('uselibpqcompat'); }
  const pool = new pg.Pool({ connectionString: parsed.toString(), ...(tls ? { ssl: { rejectUnauthorized: true } } : {}), max: 4, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  // Never disable certificate verification. Honor the provider's connection URL.
  pool.on('error', () => console.error('Workspace database connection interrupted'));
  const db = { query: (s, p) => pool.query(s, p), transaction: async fn => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }, close: () => pool.end() };
  await db.query(schema);
  return new WorkspaceStore(db);
}
export class WorkspaceStore {
  constructor(db) { this.db = db; }
  async userByEmail(email) { return (await this.db.query('SELECT * FROM wr_users WHERE email=$1', [email])).rows[0]; }
  async createUser(email, password, ip, now = Date.now()) {
    return this.db.transaction(async q => {
      await this.consume(q, 'signup:'+digest(ip), 3, now);
      await this.consume(q, 'signup:global', 30, now);
      const user = { id: randomUUID(), email };
      await q.query('INSERT INTO wr_users(id,email,password) VALUES($1,$2,$3)', [user.id, email, password]);
      return user;
    });
  }
  async session(userId) {
    const token = randomBytes(32).toString('base64url');
    await this.db.query('DELETE FROM wr_sessions WHERE expires<$1', [Date.now()]);
    await this.db.query('INSERT INTO wr_sessions(token,user_id,expires) VALUES($1,$2,$3)', [digest(token), userId, Date.now()+7*86400000]);
    return token;
  }
  async user(token) { if (!token) return null; return (await this.db.query('SELECT u.id,u.email FROM wr_sessions s JOIN wr_users u ON s.user_id=u.id WHERE s.token=$1 AND s.expires>$2', [digest(token), Date.now()])).rows[0] || null; }
  async logout(token) { if (token) await this.db.query('DELETE FROM wr_sessions WHERE token=$1', [digest(token)]); }
  async consume(q, scope, limit, now) {
    const day = new Date(now).toISOString().slice(0,10);
    const r = await q.query('INSERT INTO wr_quotas(scope,day,used) VALUES($1,$2,1) ON CONFLICT(scope,day) DO UPDATE SET used=wr_quotas.used+1 WHERE wr_quotas.used<$3 RETURNING used', [scope, day, limit]);
    if (!r.rows.length || limit < 1) throw fail(429, 'Daily demo limit reached. Credits reset at 00:00 UTC.');
  }
  async reserve(userId, ip, limits, now=Date.now()) {
    return this.db.transaction(async q => {
      // All reservations lock the global row first, then user/IP; overspending rolls back atomically.
      await this.consume(q, 'build:global', limits.global, now);
      await this.consume(q, 'build:user:'+userId, limits.user, now);
      await this.consume(q, 'build:ip:'+digest(ip), limits.ip, now);
    });
  }
  async credits(userId, limits) {
    const rows = (await this.db.query('SELECT scope,used FROM wr_quotas WHERE day=$1 AND (scope=$2 OR scope=$3)', [new Date().toISOString().slice(0,10), 'build:user:'+userId, 'build:global'])).rows;
    const used = scope => Number(rows.find(r=>r.scope===scope)?.used || 0);
    return { remaining: Math.max(0,limits.user-used('build:user:'+userId)), limit: limits.user, globalRemaining: Math.max(0,limits.global-used('build:global')), resetAt: new Date(new Date().setUTCHours(24,0,0,0)).toISOString() };
  }
  async list(userId) { return (await this.db.query('SELECT id,title,head,updated_at FROM wr_projects WHERE user_id=$1 ORDER BY updated_at DESC', [userId])).rows; }
  async owned(q, userId, id, lock=false) {
    const row = (await q.query('SELECT * FROM wr_projects WHERE id=$1 AND user_id=$2'+(lock?' FOR UPDATE':''), [id,userId])).rows[0];
    if (!row) throw fail(404,'Project not found.'); return row;
  }
  async project(userId, id) {
    const row = await this.owned(this.db,userId,id);
    const v = (await this.db.query('SELECT snapshot FROM wr_versions WHERE project_id=$1 AND number=$2',[id,row.head])).rows[0];
    return { ...JSON.parse(v.snapshot), id, head: row.head, cloud: true };
  }
  async versions(userId, id) { await this.owned(this.db,userId,id); return (await this.db.query('SELECT number,label,created_at FROM wr_versions WHERE project_id=$1 ORDER BY number DESC',[id])).rows; }
  async version(userId,id,number) { await this.owned(this.db,userId,id); const r=(await this.db.query('SELECT snapshot FROM wr_versions WHERE project_id=$1 AND number=$2',[id,number])).rows[0]; if(!r)throw fail(404,'Version not found.'); return JSON.parse(r.snapshot); }
  async save(userId, id, expectedHead, snapshot, label) {
    return this.db.transaction(async q => {
      let row;
      if (id) row = await this.owned(q,userId,id,true);
      else {
        // Serialize project creation per user and bound retained data.
        await q.query('SELECT id FROM wr_users WHERE id=$1 FOR UPDATE',[userId]);
        if ((await q.query('SELECT id FROM wr_projects WHERE user_id=$1',[userId])).rows.length>=20) throw fail(409,'Demo workspace holds up to 20 projects.');
        id=randomUUID(); row={head:0};
        await q.query('INSERT INTO wr_projects(id,user_id,title,head,updated_at) VALUES($1,$2,$3,0,$4)',[id,userId,snapshot.title,new Date().toISOString()]);
      }
      if (row.head !== expectedHead) throw fail(409,'Project changed in another tab. Reopen it before saving.');
      if (row.head>=30) throw fail(409,'This demo keeps up to 30 versions per project. Download a ZIP to continue separately.');
      const head=row.head+1, at=new Date().toISOString();
      await q.query('INSERT INTO wr_versions(project_id,number,label,created_at,snapshot) VALUES($1,$2,$3,$4,$5)',[id,head,label.slice(0,180),at,JSON.stringify(snapshot)]);
      await q.query('UPDATE wr_projects SET title=$1,head=$2,updated_at=$3 WHERE id=$4',[snapshot.title,head,at,id]);
      return {...snapshot,id,head,cloud:true};
    });
  }
  async share(userId,id,expectedHead) {
    return this.db.transaction(async q=>{
      const row=await this.owned(q,userId,id,true);
      if(row.head!==expectedHead)throw fail(409,'Save and reopen the current version before sharing.');
      const v=(await q.query('SELECT snapshot FROM wr_versions WHERE project_id=$1 AND number=$2',[id,row.head])).rows[0];
      await q.query('DELETE FROM wr_shares WHERE project_id=$1',[id]);
      const token=randomBytes(24).toString('base64url');
      await q.query('INSERT INTO wr_shares(token,project_id,snapshot) VALUES($1,$2,$3)',[token,id,v.snapshot]);
      return token;
    });
  }
  async unshare(userId,id) { await this.owned(this.db,userId,id); await this.db.query('DELETE FROM wr_shares WHERE project_id=$1',[id]); }
  async shared(token) { const r=(await this.db.query('SELECT snapshot FROM wr_shares WHERE token=$1',[token])).rows[0]; if(!r)throw fail(404,'Share link is unavailable or has been revoked.'); const p=JSON.parse(r.snapshot); return {title:p.title,summary:p.summary,files:p.files,report:p.report,generatedAt:p.generatedAt}; }
}
