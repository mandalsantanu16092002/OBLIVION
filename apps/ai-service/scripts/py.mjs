// Run Python from this service's .venv when it exists, otherwise the `python` on PATH.
// Lets `npm run dev` work without activating the venv (and ignores an unrelated active venv).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const venvPython = process.platform === 'win32'
  ? resolve(root, '.venv', 'Scripts', 'python.exe')
  : resolve(root, '.venv', 'bin', 'python');
const python = existsSync(venvPython) ? venvPython : 'python';

const child = spawn(python, process.argv.slice(2), { cwd: root, stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`[ai-service] could not start ${python}: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
