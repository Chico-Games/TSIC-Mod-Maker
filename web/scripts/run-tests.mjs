// Tiny launcher for the unit test layer.
// node --test's default discovery patterns don't include .ts files, so we
// expand the glob ourselves and pass explicit paths.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = 'tests';
let files = [];
try {
  files = readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => join(dir, f))
    .sort();
} catch (e) {
  console.error(`Cannot read ${dir}/:`, e.message);
  process.exit(1);
}

if (files.length === 0) {
  console.log('No .test.ts files found in tests/.');
  process.exit(0);
}

const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
