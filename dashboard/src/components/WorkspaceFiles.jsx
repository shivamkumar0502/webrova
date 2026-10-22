import { useEffect, useState } from 'react';
import { getSandbox, readFile } from '../lib/api';
export default function WorkspaceFiles({ projectId, status }) {
  const [files, setFiles] = useState([]), [selected, setSelected] = useState(''), [content, setContent] = useState(''), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getSandbox(projectId).then(data => { if (!cancelled) { setFiles(data.files || []); setError(''); } }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [projectId, status, revision]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setContent('Loading…');
    readFile(projectId, selected).then(data => { if (!cancelled) setContent(data.content); }).catch(e => { if (!cancelled) setContent(e.message); });
    return () => { cancelled = true; };
  }, [projectId, selected, revision]);
  return <section className="workspace-files"><div className="brief-heading"><span>WORKSPACE EXPLORER</span><button className="btn btn-text" onClick={() => setRevision(n => n + 1)}>Refresh files</button></div>{error && <p role="status">{error}</p>}<div className="file-layout"><nav aria-label="Project files">{files.map(file => <button key={file} className={file === selected ? 'selected' : ''} onClick={() => setSelected(file)}>{file}</button>)}</nav><div><div className="file-title">{selected || 'Select a file to inspect generated code'}</div><pre tabIndex={0}><code>{content}</code></pre></div></div></section>;
}
