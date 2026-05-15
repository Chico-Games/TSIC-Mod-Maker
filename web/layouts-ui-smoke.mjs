// Headed Playwright smoke for the Layouts editor:
//   - Filterable LayoutPicker opens; biome+type chip rows present
//   - Picking a layout mounts a non-empty WebGL canvas
//   - Outliner shows rows; clicking one updates selection visually
//   - Viewport doesn't crash on selection (no error-boundary text)
//   - No "Cannot read properties of undefined" errors in console
//
// Runs against bundled defaults (no real directory pick required).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4244;

function startServer() {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`OK: ${msg}`);
}

async function main() {
  // Build then serve via vite preview so we test the prod bundle.
  console.log('Building...');
  const build = spawn('npx', ['vite', 'build'], { cwd: process.cwd(), stdio: 'inherit', shell: true });
  const buildExit = await new Promise((res) => build.on('exit', res));
  assert(buildExit === 0, 'vite build succeeded');

  const server = startServer();
  let serverOutput = '';
  server.stdout?.on('data', (d) => { serverOutput += d.toString(); });
  server.stderr?.on('data', (d) => { serverOutput += d.toString(); });
  await waitForServer(`http://localhost:${PORT}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('Cannot read properties of undefined')) errors.push(text);
      if (text.includes('Viewport error')) errors.push(text);
      if (text.includes('Minified React error')) errors.push(text);
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  try {
    await page.goto(`http://localhost:${PORT}/?bundled=1`);
    await page.waitForLoadState('networkidle');

    // Dismiss any blocking overlays. Prefer affirmative buttons.
    for (let i = 0; i < 4; i++) {
      const overlay = page.locator('.loadgate-overlay, .restore-draft-overlay');
      if (await overlay.count() === 0) break;
      // Try in order: Continue anyway, Got it, Restore, Discard.
      const candidates = [
        /continue anyway/i,
        /got it/i,
        /restore/i,
        /discard/i,
      ];
      let clicked = false;
      for (const rx of candidates) {
        const btn = page.getByRole('button', { name: rx });
        if (await btn.count()) {
          await btn.first().click({ force: true }).catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
      await page.waitForTimeout(300);
    }

    // Wait for definitions to settle after LoadGate continue.
    await page.waitForFunction(() => {
      const txt = document.body.innerText || '';
      const m = /(\d+)\s+defs/.exec(txt);
      return m && parseInt(m[1], 10) > 100;
    }, { timeout: 15000 }).catch(() => {});

    // Click the Layouts tab via the .tab class to be specific.
    const layoutsTab = page.locator('button.tab', { hasText: /^Layouts$/ });
    await layoutsTab.waitFor({ state: 'visible', timeout: 10000 });
    await layoutsTab.click();
    await page.waitForTimeout(500);

    await page.locator('.layouts-toolbar').waitFor({ state: 'visible', timeout: 5000 });

    // The LayoutPicker trigger button.
    const trigger = page.locator('.layout-picker-trigger').first();
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    await trigger.click();

    // Popover should be visible with chip rows.
    await page.waitForSelector('.layout-picker-popover', { timeout: 2000 });
    const chipRows = await page.locator('.layout-picker-chip-row').count();
    assert(chipRows >= 1, `LayoutPicker shows at least one chip row (got ${chipRows})`);
    const biomeLabel = await page.locator('.layout-picker-chip-label', { hasText: /biome/i }).count();
    const typeLabel = await page.locator('.layout-picker-chip-label', { hasText: /type/i }).count();
    assert(biomeLabel > 0, 'LayoutPicker has a biome chip label');
    assert(typeLabel > 0, 'LayoutPicker has a type chip label');

    // Filter by typing.
    await page.locator('.layout-picker-search').fill('Bathroom_All');
    await page.waitForTimeout(150);
    const matches = await page.locator('.layout-picker-item').count();
    assert(matches > 0, `search "Bathroom_All" returned matches (got ${matches})`);

    // Pick LYD_Bathroom_All.
    await page.locator('.layout-picker-item', { hasText: 'LYD_Bathroom_All' }).first().click();

    // Outliner shows rows.
    await page.waitForSelector('.outliner-row', { timeout: 5000 });
    const rowCount = await page.locator('.outliner-row').count();
    assert(rowCount > 0, `outliner has rows (got ${rowCount})`);

    // Canvas exists and has nonzero size.
    const canvasBox = await page.locator('.layouts-viewport canvas').first().boundingBox();
    assert(canvasBox && canvasBox.width > 100 && canvasBox.height > 100,
      `canvas mounted with non-tiny size (${canvasBox?.width}x${canvasBox?.height})`);

    // Click first row, expect selection class.
    await page.locator('.outliner-row').first().click();
    await page.waitForTimeout(150);
    const isSelected = await page.locator('.outliner-row.selected').first().isVisible();
    assert(isSelected, 'first outliner row reflects selection after click');

    // No viewport-error boundary visible (i.e. no runtime crash).
    const errBoundary = await page.locator('text=Viewport error').count();
    assert(errBoundary === 0, 'no viewport error boundary surfaced');

    assert(errors.length === 0, `no critical console errors (got ${errors.length}: ${errors[0] ?? ''})`);

    console.log('\nAll layouts UI smoke assertions passed.');
  } finally {
    await browser.close();
    server.kill();
    if (process.exitCode === 0 || process.exitCode === undefined) {
      // emit a snippet of the server log if it had warnings
      const tail = serverOutput.split('\n').slice(-3).join('\n');
      if (tail) console.log('--- server tail ---\n' + tail);
    }
  }
}

main().catch((e) => {
  console.error('UNEXPECTED ERROR:', e);
  process.exit(1);
});
