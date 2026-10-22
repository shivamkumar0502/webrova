/** Single-tenant access gate. Replace with project ownership before multi-user deployment. */
import { createHmac, timingSafeEqual } from 'node:crypto';
const digest = value => createHmac('sha256', process.env.ACCESS_PASSWORD || 'development').update(value).digest('hex');
function equal(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function authorized(req) {
  if (!process.env.ACCESS_PASSWORD) return process.env.NODE_ENV !== 'production';
  const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('webrova_session='))?.slice(16);
  if (!token) return false;
  const [expires, signature] = token.split('.');
  return Number(expires) > Date.now() && equal(signature, digest(expires));
}
export function accessGate(req, res, next) {
  if (authorized(req)) return next();
  res.status(401).json({ error: 'Sign in to Webrova' });
}
export function login(req, res) {
  if (!process.env.ACCESS_PASSWORD || !equal(digest(String(req.body.password || '')), digest(process.env.ACCESS_PASSWORD))) return res.status(401).json({ error: 'Invalid password' });
  const expires = String(Date.now() + 8 * 3600000);
  res.setHeader('Set-Cookie', `webrova_session=${expires}.${digest(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
}
