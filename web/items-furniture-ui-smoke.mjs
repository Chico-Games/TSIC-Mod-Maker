import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4236;

function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
  return proc;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}

(async () => {
  const proc = startServer();
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.tabs');

    // ---- Items tab loads ----
    await page.click('.tabs button:has-text("Items")');
    await page.waitForSelector('.vertical-subtab-rail');
    console.log('OK Items tab loaded');

    // ---- Equippables sub-tab + smart effects view ----
    await page.click('.vertical-subtab:has-text("Equippables")');
    await page.waitForSelector('.rail-row');
    // Click the Crossbow row (first match — humanizeAssetId may produce 'Crossbow EQ' or 'Crossbow').
    await page.click('.rail-row:has-text("Crossbow")');
    // Smart effects view should be visible.
    await page.waitForSelector('.smart-effects', { timeout: 5000 });
    console.log('OK Smart effects view rendered');

    // ---- Spreadsheet view (sort + edit) ----
    await page.click('.vertical-subtab:has-text("Crafting Materials")');
    await page.click('.mode-toggle button:has-text("Spreadsheet")');
    await page.waitForSelector('.spreadsheet');
    // Sort by Wt.
    await page.click('.spreadsheet-h:has-text("Wt")');
    console.log('OK Spreadsheet sort');

    // Find the first editable numeric cell and bump it.
    const firstEditable = page.locator('.spreadsheet-cell.editable input[type="number"]').first();
    await firstEditable.waitFor({ state: 'visible', timeout: 5000 });
    const beforeVal = await firstEditable.inputValue();
    const beforeNum = Number(beforeVal) || 0;
    const nextVal = beforeNum + 1;
    await firstEditable.fill(String(nextVal));
    await firstEditable.blur();
    // Switch back to detail and check the same numeric field reflects the change.
    await page.click('.mode-toggle button:has-text("Detail")');
    const detailFirst = page.locator('.detail-pane input[type="number"]').first();
    await detailFirst.waitFor({ state: 'visible', timeout: 5000 });
    const matched = await page.evaluate((expected) => {
      const inputs = Array.from(document.querySelectorAll('.detail-pane input[type="number"]'));
      return inputs.some((i) => Number((i).value) === expected);
    }, nextVal);
    if (!matched) throw new Error(`edited value ${nextVal} not visible in detail-pane number inputs`);
    console.log('OK Spreadsheet edit reflected in Detail');

    // ---- Furniture tab + Damageable + cross-link ----
    await page.click('.tabs button:has-text("Furniture")');
    await page.waitForSelector('.vertical-subtab-rail');
    await page.click('.vertical-subtab:has-text("Damageable")');
    await page.waitForSelector('.rail-row');
    await page.click('.rail-row >> nth=0');
    await page.waitForSelector('.cross-link:has-text("Edit recipes/loot")');
    await page.click('.cross-link:has-text("Edit recipes/loot")');
    // Active tab should have moved to Recipes & Loot.
    await page.waitForSelector('.tab.active:has-text("Recipes & Loot")');
    console.log('OK Cross-link to Recipes & Loot');

    // ---- Layout: resize and collapse the rail ----
    await page.click('.tabs button:has-text("Furniture")');
    await page.waitForSelector('.class-browser');

    const grid = page.locator('.class-browser');
    const before = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    // Drag the first resize-handle (rail) by +60px.
    const handle = page.locator('.class-browser > .resize-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('rail resize handle not found');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 60, y, { steps: 6 });
    await page.mouse.up();
    const after = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    if (before === after) throw new Error(`rail width did not change after drag: ${before} -> ${after}`);
    console.log(`OK Rail resize ${before} -> ${after}`);

    // Collapse the rail.
    await page.click('.rail-collapse-btn');
    await page.waitForSelector('.class-browser.rail-collapsed .collapse-strip');
    console.log('OK Rail collapse');

    // Expand again.
    await page.click('.class-browser.rail-collapsed .collapse-strip');
    await page.waitForSelector('.class-browser:not(.rail-collapsed)');
    const restored = await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--cb-rail-w').trim());
    if (restored !== after) throw new Error(`rail width didn't restore after expand: expected ${after}, got ${restored}`);
    console.log('OK Rail re-expand restored width');

    // ---- Pin to right: split view ----
    // Sub-tab with at least two records.
    await page.click('.vertical-subtab:has-text("Damageable")');
    await page.waitForSelector('.rail-row');

    const railRows = page.locator('.rail-row');
    await railRows.nth(0).click();
    // Capture the first record's id (rendered in the .station-sub > code).
    await page.waitForSelector('.detail-pane .station-sub code');
    const firstId = await page.locator('.detail-pane .station-sub code').first().innerText();

    // Pin it.
    await page.click('.detail-pane .pin-btn:has-text("Pin")');
    await page.waitForSelector('.split-pane');
    const paneCount = await page.locator('.detail-pane').count();
    if (paneCount !== 2) throw new Error(`expected 2 detail-panes after pin, got ${paneCount}`);

    // Click a different rail row.
    await railRows.nth(1).click();
    const leftId = await page.locator('.split-pane .split-half.left .station-sub code').innerText();
    const rightId = await page.locator('.split-pane .split-half.right .station-sub code').innerText();
    if (leftId === rightId) throw new Error(`left and right show the same record after switching: ${leftId}`);
    if (rightId !== firstId) throw new Error(`right pane should still show pinned id ${firstId}, got ${rightId}`);
    console.log('OK Pin to right + switch left');

    // Unpin.
    await page.click('.detail-pane.pinned .pin-btn:has-text("Unpin")');
    await page.waitForSelector('.detail-pane:not(.pinned)');
    const splitGone = await page.locator('.split-pane').count();
    if (splitGone !== 0) throw new Error('split-pane should be gone after unpin');
    console.log('OK Unpin');

    await browser.close();
    console.log('items-furniture-ui-smoke: ALL OK');
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
