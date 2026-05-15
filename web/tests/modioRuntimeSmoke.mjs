// Boot the dev server, load the app, and assert that mod.io UI surfaces
// render without runtime errors. Smoke-level only — no network calls to
// real mod.io.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4244;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
server.stdout.on('data', (b) => { stdout += b.toString(); });
server.stderr.on('data', (b) => { stderr += b.toString(); });

async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    // Strip ANSI escapes before matching.
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
    if (clean.includes(`localhost:${PORT}`)) return;
    await sleep(250);
  }
  throw new Error('vite preview never came up. stdout=' + stdout + ' stderr=' + stderr);
}

const browser = await chromium.launch();
try {
  await waitForReady();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.header .file-info', { timeout: 30_000 });

  // mod.io buttons should be present because .env.local provides creds.
  // We only check that they MOUNTED — there may be a LoadGate overlay from
  // the starter project's schema validation in the way, so we don't click.
  const signInBtn = await page.locator('button:has-text("Sign in")').count();
  const browseBtn = await page.locator('button:has-text("Browse mods")').count();
  const publishBtn = await page.locator('button:has-text("Publish")').count();
  if (signInBtn === 0) throw new Error('Sign in button missing');
  if (browseBtn === 0) throw new Error('Browse mods button missing');
  if (publishBtn === 0) throw new Error('Publish button missing');

  // Give the app a moment for any async boot work (modIoStore.bootstrap,
  // starter catalog load) to settle so we catch their errors too.
  await sleep(2000);

  if (consoleErrors.length > 0) {
    // Filter benign warnings.
    const real = consoleErrors.filter((e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('favicon') &&
      !e.toLowerCase().includes('react devtools'),
    );
    if (real.length > 0) {
      throw new Error('Runtime errors on page:\n' + real.join('\n'));
    }
  }
  console.log('OK: mod.io UI mounts without runtime errors');
} finally {
  await browser.close();
  server.kill();
}
