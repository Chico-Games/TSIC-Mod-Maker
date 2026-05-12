// Debug probe: opens the dev app, waits up to 90s, and prints the
// header semantic chip + recent console output. Use it whenever the
// background indexer seems stuck — the captured console reveals
// model fetch / parse errors that the silent error path swallows.
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => consoleMsgs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

  await page.goto('http://localhost:5173/');
  await page.waitForSelector('.header .file-info');

  const start = Date.now();
  let lastChipText = '';
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    const chip = await page.locator('.header-semantic-chip').first().textContent().catch(() => null);
    if (chip !== lastChipText) {
      console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s  chip="${chip}"`);
      lastChipText = chip ?? '';
    }
    if (chip?.includes('ready')) break;
    if (chip?.includes('failed')) break;
  }

  console.log('--- recent console (last 60) ---');
  for (const m of consoleMsgs.slice(-60)) console.log(m);

  await browser.close();
})();
