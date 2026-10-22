import { useEffect, useState } from 'react';
export default function AccessGate({ children }) {
  const [ready, setReady] = useState(false), [checking, setChecking] = useState(true), [password, setPassword] = useState(''), [error, setError] = useState('');
  useEffect(() => { fetch('/api/session').then(r => r.json()).then(data => setReady(data.authenticated)).catch(() => setError('Cannot reach the server')).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="access-card">Connecting to Webrova…</div>;
  if (ready) return children;
  return <form className="access-card" onSubmit={async e => { e.preventDefault(); try { const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (!r.ok) throw new Error('Invalid access password'); setReady(true); setPassword(''); } catch (e) { setError(e.message); } }}><p className="brief-kicker">WEBROVA / PRIVATE WORKSPACE</p><h1>Your ideas start here.</h1><label htmlFor="access-password">Workspace password</label><input id="access-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /><button className="btn btn-accent">Open workspace ↗</button>{error && <p role="alert">{error}</p>}</form>;
}
