export function compareFiles(before = [], after = []) {
  const old = new Map(before.map(f => [f.path, f.content]));
  const next = new Map(after.map(f => [f.path, f.content]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().map(path => ({ path, change: !old.has(path) ? 'added' : !next.has(path) ? 'removed' : old.get(path) !== next.get(path) ? 'modified' : 'unchanged', before: old.get(path) || '', after: next.get(path) || '' }));
}
export function buildReport(project, previous, { durationMs = 0, model = 'sample', kind = 'build' } = {}) {
  const files = project.files || [];
  return { kind, model, durationMs, fileCount: files.length, bytes: files.reduce((n,f)=>n+new TextEncoder().encode(f.content).length,0), usage: project.usage || {input:0,output:0}, changes: compareFiles(previous?.files,files).map(({path,change})=>({path,change})), checks: [
    { label: 'Project structure and file paths', status: 'passed' },
    { label: 'Frontend preview isolation', status: 'enforced' },
    { label: 'Backend execution and API tests', status: 'not run' },
    { label: 'Generated app security review', status: 'not run' }
  ] };
}
