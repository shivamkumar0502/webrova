import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { demoProject } from './demoProject';
import { previewDocument } from './preview';
import './free.css';

const examples = [ ['Task board', 'Build a task board with categories, due dates, and complete/delete actions.'], ['Client portal', 'Build a small client project tracker with project status, notes, and a dashboard.'], ['Habit tracker', 'Build a habit tracker with daily check-ins, streaks, and a weekly overview.'] ];
function restore() { try { const data = JSON.parse(sessionStorage.getItem('webrova-project') || 'null'); return Array.isArray(data?.files) ? data : null; } catch { return null; } }
export default function FreeApp() {
  const [project, setProject] = useState(restore);
  const [prompt, setPrompt] = useState('');
  const [key, setKey] = useState('');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('frontend/index.html');
  const [view, setView] = useState('preview');
  const [device, setDevice] = useState('desktop');
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef(null);
  const frame = useRef(null);
  const [frameRevision, setFrameRevision] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => { if (project) { try { sessionStorage.setItem('webrova-project', JSON.stringify(project)); } catch { setNotice('Session storage is full. Download the ZIP to keep your files.'); } } }, [project]);
  useEffect(() => { if (!busy) return; const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, [busy]);
  useEffect(() => () => abort.current?.abort(), []);
  const currentFile = project?.files.find(f => f.path === selected);
  const preview = useMemo(() => previewDocument(project?.files || []), [project]);
  async function build() {
    if (busy || prompt.trim().length < 10) return;
    if (!key.trim()) { setSettings(true); setError('Add your Gemini API key, or try the sample project without a key.'); return; }
    setError(''); setNotice(''); setBusy(true); setElapsed(0); const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': key.trim() }, body: JSON.stringify({ requirement: prompt.trim() }), signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Build failed');
      setProject(data); setSelected('frontend/index.html'); setView('preview'); setNotice('Code generated. Frontend preview is ready; backend code is exported, not executed or verified.');
    } catch (e) { setError(e.name === 'AbortError' ? 'Build cancelled. Your previous project is still available.' : e.message); }
    finally { setBusy(false); abort.current = null; }
  }
  function loadDemo() { setProject(structuredClone(demoProject)); setSelected('frontend/index.html'); setView('preview'); setError(''); setNotice('Sample project loaded. No AI call was made. Try adding or completing a task.'); }
  async function download() {
    const zip = new JSZip(); for (const file of project.files) zip.file(file.path, file.content);
    const blob = await zip.generateAsync({ type: 'blob' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'webrova-project.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function newProject() { if (busy) return; setProject(null); setPrompt(''); setNotice(''); setError(''); try { sessionStorage.removeItem('webrova-project'); } catch {} }
  return <div className="free-app">
    <aside className="free-sidebar"><a className="free-brand" href="/" aria-label="Webrova home"><span>W</span>webrova<i>beta</i></a><button className="free-new" onClick={newProject} disabled={busy}>＋ New project <kbd>⌘</kbd></button><p className="side-label">WORKSPACE</p><button className={'side-link ' + (project ? 'active' : '')} onClick={() => project && setView('preview')}>▧ {project?.title || 'Your next idea'}</button><p className="side-label side-gap">START SOMETHING</p>{examples.map(([name, text]) => <button className="side-link" key={name} onClick={() => setPrompt(text)}>{name}<span>↗</span></button>)}<div className="side-bottom"><span className="free-plan">FREE CLOUD EDITION</span><p>No paid sandbox.<br/>No hosting plan upgrade.</p><button className="side-link" onClick={() => setSettings(!settings)}>⚙ API settings <span>{key ? '●' : '○'}</span></button><a href="https://github.com/shivamkumar0502/webrova" target="_blank" rel="noreferrer">View source ↗</a></div></aside>
    <div className="free-main"><header className="free-header"><div><span className="header-dot"/> {project ? project.title : 'Personal workspace'}<span className="free-header-tag">Learning & portfolio</span></div><button onClick={loadDemo} disabled={busy} className="free-btn ghost">Try sample project ↗</button></header>
      {settings && <section className="free-settings"><div><h2>Bring your Gemini key</h2><p>Use a free-tier API project; a paid-tier key can incur Google charges. The key stays in page memory and is sent over HTTPS to this service and Google only for your generation request. It is never saved to browser storage or server logs.</p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get an API key in Google AI Studio ↗</a></div><label>Gemini API key<input type="password" autoComplete="off" value={key} placeholder="AIza…" onChange={e => setKey(e.target.value)}/></label><button className="free-btn ghost" onClick={() => { setKey(''); setNotice('API key cleared from this page.'); }}>Clear key</button><button className="free-btn" onClick={() => setSettings(false)}>Done</button></section>}
      {!project && <section className="free-hero"><span className="free-eyebrow">FROM A SMALL IDEA TO REAL CODE</span><h1>What will you<br/><em>build today?</em></h1><p>Describe an app. Generate the frontend, backend and database code.<br/>Preview the interface, make it yours, and take every file with you.</p><div className="hero-pills"><span>↗ Frontend preview</span><span>⌘ Editable source</span><span>↓ ZIP export</span></div></section>}
      <section className={'free-composer ' + (project ? 'compact' : '')}><label className="sr-only" htmlFor="free-prompt">Describe your app</label><textarea id="free-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="An app for tracking habits, with daily check-ins and a weekly progress view…" maxLength={6000} rows={project ? 2 : 4} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); build(); } }}/><div className="composer-footer"><span><span className={'key-dot ' + (key ? 'ready' : '')}/>{key ? 'Gemini key ready' : 'Add your Gemini key to generate'}<small>One focused request · no paid fallback</small></span>{busy ? <button className="free-btn" onClick={() => abort.current?.abort()}>Stop · {elapsed}s</button> : <button className="free-btn primary" disabled={prompt.trim().length < 10} onClick={build}>Build my idea <span>↑</span></button>}</div></section>
      {!project && <div className="free-examples">{examples.map(([name, text]) => <button key={name} onClick={() => setPrompt(text)}>{name} ↗</button>)}</div>}
      {busy && <div className="free-status" role="status"><span className="working-dot"/> Gemini is generating your project files… {elapsed}s. Larger requests can take a minute.</div>}
      {error && <div className="free-message error" role="alert">{error}</div>}{notice && <div className="free-message" role="status">{notice}</div>}
      {project && <section className="free-workspace"><div className="workspace-toolbar"><div className="free-tabs"><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')}>Preview</button><button className={view === 'code' ? 'selected' : ''} onClick={() => setView('code')}>Code <span>{project.files.length}</span></button></div><div className="workspace-actions">{view === 'preview' && <><button aria-label="Desktop preview" className={device === 'desktop' ? 'selected' : ''} onClick={() => setDevice('desktop')}>Desktop</button><button aria-label="Mobile preview" className={device === 'mobile' ? 'selected' : ''} onClick={() => setDevice('mobile')}>Mobile</button><button onClick={() => setFrameRevision(n => n + 1)} aria-label="Refresh preview">↻</button></>}<button className="free-btn" onClick={download}>↓ Download ZIP</button></div></div><div className="workspace-caption"><span>{project.sample ? 'SAMPLE PROJECT · NO AI CALL' : 'GENERATED SOURCE · NOT RUNTIME-VERIFIED'}</span><span>Frontend preview · backend not running</span></div>
      {view === 'preview' ? <div className={'free-preview ' + device}><iframe key={frameRevision} ref={frame} title="Generated frontend preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview}/></div> : <div className="free-code"><nav aria-label="Generated files">{project.files.map(f => <button key={f.path} className={f.path === selected ? 'selected' : ''} onClick={() => { setSelected(f.path); setCopyStatus(''); }}>{f.path}</button>)}</nav><div className="code-editor"><div><span>{selected}</span><button onClick={async () => { try { await navigator.clipboard.writeText(currentFile?.content || ''); setCopyStatus('Copied'); } catch { setCopyStatus('Select and copy the code manually'); } }}>{copyStatus || 'Copy'}</button></div><label className="sr-only" htmlFor="file-editor">Edit {selected}</label><textarea id="file-editor" spellCheck="false" value={currentFile?.content || ''} onChange={e => { const content = e.target.value; setProject(p => ({ ...p, files: p.files.map(f => f.path === selected ? { ...f, content } : f) })); }}/></div></div>}
      <div className="project-summary"><strong>{project.title}</strong><p>{project.summary}</p>{project.usage && <span>{project.usage.input.toLocaleString()} input / {project.usage.output.toLocaleString()} output tokens · your Gemini project quota applies</span>}</div></section>}
      <footer className="free-footer"><span>Built for curious builders.</span><span>Browser preview is isolated. Exported backend/database code needs its own runtime. <button onClick={() => setSettings(true)}>Settings</button></span></footer>
    </div>
  </div>;
}
