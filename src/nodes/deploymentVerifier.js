/** Verify generated builds inside the isolated runtime; publishing is a separate operation. */
import { executeCommand, installDependencies, writeFile, readFile } from '../utils/sandboxManager.js';
import { assembleBackendEntry, assembleFrontendEntry } from './assembleEntryPoints.js';
export async function deploymentVerifierNode(state) {
  const id = state.sandboxId;
  if (!id) throw new Error('Cannot verify a project without a workspace');
  assembleBackendEntry(id, state.fileRegistry || [], state.blueprint);
  assembleFrontendEntry(id, state.fileRegistry || [], state.blueprint);
  const logs = [], errors = [];
  for (const side of ['backend', 'frontend']) {
    const result = await installDependencies(id, side);
    logs.push(result.stdout);
    if (result.exitCode) errors.push(`${side}: ${result.stderr}`);
  }
  if (!errors.length && readFile(id, 'backend/migrate.js')) {
    const migration = await executeCommand(id, 'cd /app/backend && node migrate.js', 30000);
    if (migration.exitCode) errors.push('Database migration failed: ' + migration.stderr);
  }
  if (!errors.length) {
    const result = await executeCommand(id, 'cd /app/frontend && npm run build', 120000);
    logs.push(result.stdout);
    if (result.exitCode) errors.push(result.stderr || result.stdout);
    const backend = await executeCommand(id, 'cd /app/backend && node --check src/index.js', 30000);
    if (backend.exitCode) errors.push(backend.stderr);
  }
  const instructions = ['Set a dedicated DATABASE_URL and JWT_SECRET for the backend.', 'Backend: npm install && npm start', 'Frontend: npm install && npm run build; publish dist/ on a static host.', 'Set VITE_API_URL to the public backend API URL before building.'];
  writeFile(id, 'DEPLOYMENT.md', '# Deployment\n\n' + instructions.join('\n\n') + '\n\nBuild verification does not verify database migrations or publish the app.\n');
  return {
    deploymentAttempts: (state.deploymentAttempts || 0) + 1,
    executionResult: { result: errors.length ? 'fail' : 'pass', output: logs.join('\n'), errors: errors.join('\n') },
    deploymentConfig: { platform: 'native-node', files: ['DEPLOYMENT.md'], instructions },
  };
}
export function deploymentVerifierRouter(state) {
  if (state.executionResult?.result === 'pass') return 'presentToUser';
  if ((state.deploymentAttempts || 0) >= 2) throw new Error('Generated project build verification failed: ' + state.executionResult?.errors);
  return 'debuggerAgent';
}
