const STORAGE_KEY = 'webrova-projects-v1';
export function restoreWorkspace(storage, legacyStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved?.projects)) return { projects: saved.projects.filter(p => p.id && Array.isArray(p.files)), activeId: saved.activeId || null };
    const legacy = JSON.parse(legacyStorage.getItem('webrova-project') || 'null');
    if (Array.isArray(legacy?.files)) {
      const project = { ...legacy, id: crypto.randomUUID() };
      return { projects: [project], activeId: project.id };
    }
  } catch {}
  return { projects: [], activeId: null };
}
export function saveWorkspace(storage, workspace) {
  // Only project files and navigation state; API keys never enter this object.
  storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}
