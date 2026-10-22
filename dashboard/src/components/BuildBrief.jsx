import { useState } from 'react';

const presets = [
  { title: 'Launch a product', text: 'A product launch page with pricing, waitlist signup and an admin dashboard.' },
  { title: 'Run a business', text: 'A client portal with authentication, project tracking, invoices and an admin dashboard.' },
  { title: 'Build a community', text: 'A community app with profiles, posts, comments and moderation.' },
];
export default function BuildBrief({ value, onChange, budget, onBudgetChange, busy, onLaunch }) {
  const [scope, setScope] = useState('MVP');
  const [copied, setCopied] = useState(false);
  const brief = `${value.trim()}\n\nDelivery scope: ${scope}. Prioritize a small working vertical slice. Include responsive frontend, backend validation, database migrations and setup instructions.`;
  return <section className="build-brief">
    <div className="brief-heading"><span className="brief-kicker">YOUR NEXT IDEA, SHIPPED</span><span className="brief-tag">BUILD BRIEF</span></div>
    <label htmlFor="build-prompt">What should we build?</label>
    <textarea id="build-prompt" value={value} onChange={e => onChange(e.target.value)} placeholder="Describe your app, who it helps, and what it should do…" rows={6} maxLength={20000} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && value.trim() && !busy) onLaunch(brief); }} />
    <div className="brief-presets">{presets.map(p => <button key={p.title} onClick={() => onChange(p.text)}>{p.title}<span>↗</span></button>)}</div>
    <div className="brief-controls"><label>Scope<select value={scope} onChange={e => setScope(e.target.value)}><option>MVP</option><option>Polished prototype</option><option>Production foundation</option></select></label><label>AI budget limit (USD)<select value={budget} onChange={e => onBudgetChange(Number(e.target.value))}><option value={0.5}>$0.50</option><option value={1}>$1.00</option><option value={2}>$2.00</option><option value={5}>$5.00</option></select></label></div>
    {value.trim() && <details className="brief-review"><summary>Review the agent's brief</summary><p>{brief}</p><button onClick={async () => { try { await navigator.clipboard.writeText(brief); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy brief'}</button></details>}
    <div className="brief-footer"><span>Estimated AI spend only. Hosting and sandbox billed separately.</span><button className="btn btn-accent" disabled={!value.trim() || busy} onClick={() => onLaunch(brief)}>{busy ? 'Starting…' : 'Build this idea ↗'}</button></div>
  </section>;
}
