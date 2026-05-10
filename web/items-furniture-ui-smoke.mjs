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

    // ---- Spreadsheet view ----
    await page.click('.vertical-subtab:has-text("Crafting Materials")');
    await page.click('.mode-toggle button:has-text("Spreadsheet")');
    await page.waitForSelector('.spreadsheet');
    // Sort by Wt.
    await page.click('.spreadsheet-h:has-text("Wt")');
    console.log('OK Spreadsheet sort');

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

    await browser.close();
    console.log('items-furniture-ui-smoke: ALL OK');
  } finally {
    proc.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
