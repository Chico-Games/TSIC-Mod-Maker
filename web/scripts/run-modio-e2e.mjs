// Loads MODIO_E2E_TOKEN (and any other MODIO_E2E_* vars) from
// `web/.modio-e2e.env` and runs the E2E test. The env file is gitignored
// so the token never enters source control or process-listing history.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envPath = join(root, '.modio-e2e.env');

const env = { ...process.env };
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    if (line.trim().startsWith('#')) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
} else {
  console.log(`[modio-e2e] ${envPath} not found — token must come from MODIO_E2E_TOKEN in the calling shell.`);
}

const args = process.argv.slice(2);
const tests = args.length
  ? args.map((a) => join('tests', a))
  : [
      join('tests', 'modioE2E.test.ts'),
      join('tests', 'modioBrowseE2E.test.ts'),
    ];

const r = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...tests],
  { stdio: 'inherit', cwd: root, env },
);
process.exit(r.status ?? 1);
