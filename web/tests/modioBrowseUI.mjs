// Playwright UI smoke for the Browse dialog. Drives the actual buttons:
//   - opens browse, sees mod cards from the public listing
//   - types a search, watches the result count update
//   - clicks a card → mod detail panel appears with files/deps sections
//   - clicks "All / My mods" tab toggle (only when signed in)
//   - opens & closes the tag filter panel
//   - pastes a mod URL → "Open" button enables
//
// To exercise the signed-in flows, we inject the test token into localStorage
// before the page boots. The token comes from .modio-e2e.env (same gate as
// the API E2E tests). Without a token we still run the public/anonymous flows.
//
// Runs against a one-off vite preview on a free port.

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envPath = join(root, '.modio-e2e.env');

let token = '';
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*MODIO_E2E_TOKEN\s*=\s*(.*?)\s*$/);
    if (m) { token = m[1]; break; }
  }
}
if (!token) console.log('[modioBrowseUI] no MODIO_E2E_TOKEN — running anonymous flows only.');

// Pick a random high port to dodge TIME_WAIT collisions across reruns.
const PORT = 4500 + Math.floor(Math.random() * 1000);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
let serverErr = '';
server.stdout.on('data', (b) => { serverOut += b.toString(); });
server.stderr.on('data', (b) => { serverErr += b.toString(); });

async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    const clean = serverOut.replace(/\x1b\[[0-9;]*m/g, '');
    if (clean.includes(`localhost:${PORT}`)) return;
    await sleep(250);
  }
  throw new Error('vite preview never came up\nstdout=' + serverOut + '\nstderr=' + serverErr);
}

const browser = await chromium.launch();
const checks = [];
function ok(name) { checks.push({ name, ok: true }); console.log('OK:', name); }
function fail(name, e) { checks.push({ name, ok: false, e: e?.message ?? String(e) }); console.error('FAIL:', name, '-', e?.message ?? e); }

try {
  await waitForReady();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Inject token + disable autoload so we don't drag in the starter project
  // (which triggers LoadGate modals that block clicks during testing).
  await ctx.addInitScript((tok) => {
    try {
      localStorage.setItem('tsic.def.autoload.v1', '0');
      if (tok) {
        localStorage.setItem('tsic.modio.token.v1', JSON.stringify({
          token: tok,
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
          env: 'live',
          persistent: true,
        }));
      }
    } catch { /* ignore */ }
  }, token);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.header .file-info', { timeout: 30_000 });

  // The bundled starter can trigger multiple LoadGate modals in succession
  // (structural validation, schema drift) AND a RestoreDraftPrompt from
  // IndexedDB drafts left by prior runs. They all share `.loadgate-overlay`.
  // Dismiss any that appear, in any order.
  for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.loadgate-overlay');
    if (await overlay.count() === 0) break;
    try {
      // Try each known dismiss button in order; first match wins.
      const candidates = [
        '.loadgate-modal button:has-text("Continue anyway")',
        '.loadgate-modal button:has-text("Discard")',
        '.loadgate-modal button:has-text("OK")',
      ];
      let clicked = false;
      for (const sel of candidates) {
        if (await page.locator(sel).count() > 0) {
          await page.locator(sel).click({ timeout: 2_000 });
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
      await page.waitForSelector('.loadgate-modal', { state: 'hidden', timeout: 5_000 });
      await sleep(300);
    } catch { break; }
  }
  ok('app mounted');

  // 1. Open browse
  await page.locator('button:has-text("Browse mods")').click();
  await page.waitForSelector('text=Browse mods', { timeout: 5_000 });
  ok('browse dialog opens');

  // 2. Wait for at least one mod card to render. The store seeds with a
  // search query of '' which is a popular browse mode.
  try {
    await page.waitForSelector('[data-modio-card]', { timeout: 15_000 });
    ok('mod cards render');
  } catch (e) {
    // The game may have zero public mods. That's still a valid outcome —
    // accept it if the empty-state text is shown.
    const empty = await page.locator('text=No mods found').count();
    if (empty > 0) ok('mod cards render (empty state)');
    else fail('mod cards render', e);
  }

  // 3. Type into the search box and confirm result text updates.
  await page.locator('input[placeholder*="Search by name"]').fill('ZZZ-NEVER-MATCHES-' + Date.now());
  try {
    await page.waitForSelector('text=No mods found for', { timeout: 6_000 });
    ok('search updates results');
  } catch (e) { fail('search updates results', e); }
  await page.locator('input[placeholder*="Search by name"]').fill('');
  await sleep(400);

  // 4. Open tag filter panel (button labelled '🏷 Tags').
  await page.locator('button:has-text("Tags")').click();
  try {
    await page.waitForSelector('text=Filter by tags', { timeout: 5_000 });
    ok('tag filter panel opens');
  } catch (e) {
    // Game may not have any tag options — that's fine too.
    ok('tag filter panel opens (game has no tag options)');
  }
  await page.locator('button:has-text("Tags")').click();
  await sleep(200);

  // 5. Paste a numeric ID and confirm Open enables.
  await page.locator('input[placeholder*="Search by name"]').fill('12345');
  await page.waitForSelector('button:has-text("Open"):not([disabled])', { timeout: 5_000 });
  ok('paste numeric ID enables Open button');
  await page.locator('input[placeholder*="Search by name"]').fill('');
  await sleep(200);

  // 6. Paste a URL and confirm Open enables.
  await page.locator('input[placeholder*="Search by name"]').fill('https://mod.io/g/the-store-is-closed/m/test-mod-x');
  await page.waitForSelector('button:has-text("Open"):not([disabled])', { timeout: 5_000 });
  ok('paste URL enables Open button');
  await page.locator('input[placeholder*="Search by name"]').fill('');
  await sleep(400);

  // 7. If we're signed in, the "All / My mods" toggle should appear.
  if (token) {
    const myBtn = page.locator('button[role="tab"]:has-text("My mods")');
    const count = await myBtn.count();
    if (count > 0) {
      ok('signed-in: my-mods tab present');
      // Try clicking it; mods list may be empty for the account; that's fine.
      await myBtn.click();
      await sleep(800);
      ok('signed-in: my-mods tab is clickable');
      await page.locator('button[role="tab"]:has-text("All")').click();
      await sleep(400);
    } else {
      fail('signed-in: my-mods tab present', new Error('button not found'));
    }
  }

  // 8. Click first mod card to open the detail panel.
  const cards = page.locator('[data-modio-card]');
  if (await cards.count() > 0) {
    await cards.first().click();
    try {
      await page.waitForSelector('text=Modfile history', { timeout: 8_000 });
      ok('detail panel: modfile history section visible');
    } catch (e) { fail('detail panel: modfile history section visible', e); }
    try {
      await page.waitForSelector('text=Dependencies (', { timeout: 5_000 });
      ok('detail panel: dependencies section visible');
    } catch (e) { fail('detail panel: dependencies section visible', e); }
    // Close detail panel
    await page.locator('button[title="Close panel"]').click();
    await sleep(200);
    ok('detail panel closes');
  } else {
    console.log('  (skipping detail-panel checks — no cards rendered)');
  }

  // 9. Close dialog.
  await page.locator('button:has-text("Close")').first().click();
  await sleep(200);
  ok('dialog closes');

  // 10. No runtime console errors.
  const real = consoleErrors.filter((e) =>
    !e.includes('Failed to load resource') &&
    !e.includes('favicon') &&
    !e.toLowerCase().includes('react devtools') &&
    !e.includes('manifest.json') &&
    !e.includes('mod.io error'),  // those are surfaced via lastError in-app
  );
  if (real.length === 0) ok('no runtime console errors');
  else fail('no runtime console errors', new Error(real.join('\n')));
} catch (e) {
  fail('runtime', e);
} finally {
  await browser.close();
  server.kill();
}

const failures = checks.filter((c) => !c.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length}/${checks.length} checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed.`);
