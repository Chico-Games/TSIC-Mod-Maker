// Headless Playwright smoke for the AI > Scenarios view:
//   - the sub-tab mounts and lists the catalogue
//   - "Run" produces verdicts, and the summary chips add up to the list
//   - a scenario can be loaded into the Sandbox and actually advances there
//   - no React/console errors along the way
//
// Runs against the bundled default project, so no directory pick is needed.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4247;

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

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
    return;
  }
  console.log(`OK: ${msg}`);
}

async function main() {
  console.log('Building...');
  const build = spawn('npx', ['vite', 'build'], { cwd: process.cwd(), stdio: 'inherit', shell: true });
  assert((await new Promise((res) => build.on('exit', res))) === 0, 'vite build succeeded');
  if (failed) return 1;

  const server = startServer();
  await waitForServer(`http://localhost:${PORT}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Cannot read properties of undefined|Minified React error|scenario ".*" failed to build/.test(text)) {
      errors.push(text);
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  try {
    await page.goto(`http://localhost:${PORT}/?bundled=1`);
    await page.waitForLoadState('networkidle');

    // Gates can appear late, after the definitions finish loading — keep clearing them
    // until the page has been overlay-free for a moment.
    const clearOverlays = async () => {
      for (let i = 0, quiet = 0; i < 40 && quiet < 4; i += 1) {
        const overlay = page.locator('.loadgate-overlay, .restore-draft-overlay');
        if ((await overlay.count()) === 0) {
          quiet += 1;
          await page.waitForTimeout(250);
          continue;
        }
        quiet = 0;
        const buttons = overlay.locator('button');
        const labels = await buttons.allInnerTexts();
        const preferred = labels.findIndex((t) => /continue|got it|restore|ok|proceed/i.test(t));
        await buttons.nth(preferred >= 0 ? preferred : 0).click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    };
    await clearOverlays();

    await page.waitForFunction(() => {
      const m = /(\d+)\s+defs/.exec(document.body.innerText || '');
      return m && parseInt(m[1], 10) > 100;
    }, { timeout: 20000 }).catch(() => {});
    await clearOverlays();

    await page.locator('button.tab', { hasText: /^AI$/ }).first().click();
    await page.waitForTimeout(400);

    const scenariosTab = page.locator('button.subtab', { hasText: /^Scenarios$/ });
    await scenariosTab.waitFor({ state: 'visible', timeout: 10000 });
    await scenariosTab.click();
    await page.waitForSelector('.ai-scenarios-bar', { timeout: 5000 });

    const listed = await page.locator('.ai-scenario').count();
    assert(listed > 40, `the catalogue is listed (${listed} scenarios)`);

    const tagCount = await page.locator('.ai-scenarios-tags .tag').count();
    assert(tagCount > 5, `tag filters are rendered (${tagCount})`);

    // Run the whole suite in-browser.
    await page.locator('.ai-scenarios-bar button.primary').click();
    await page.waitForSelector('.ai-scenarios-summary', { timeout: 120000 });

    const summary = (await page.locator('.ai-scenarios-summary').innerText()).replace(/\s+/g, ' ');
    console.log(`   summary: ${summary}`);
    assert(/PASS/.test(summary), 'the run produced passing scenarios');
    assert(!/\bFAIL\b/.test(summary), `no failures in the browser run — ${summary}`);
    assert(/KNOWN/.test(summary), 'known-bug scenarios are reported separately');
    assert(/realtime/.test(summary), 'throughput is reported');

    const verdicts = await page.locator('.ai-scenario .badge:not(.idle)').count();
    assert(verdicts === listed, `every listed scenario got a verdict (${verdicts}/${listed})`);

    // Expand a known-bug scenario and check the explanation is there.
    await page.locator('.ai-scenario.known .ai-scenario-head').first().click();
    await page.waitForSelector('.ai-scenario-known', { timeout: 3000 });
    const known = await page.locator('.ai-scenario-known').first().innerText();
    assert(known.length > 80, 'the known-bug rationale is shown in full');
    const checks = await page.locator('.ai-scenario-checks li').count();
    assert(checks > 0, `per-check verdicts are listed (${checks})`);

    // Load a scenario into the Sandbox and confirm it advances there.
    await page.locator('.ai-scenario .ai-scenario-head button', { hasText: /watch/ }).first().click();
    await page.waitForTimeout(200);
    assert(
      (await page.locator('.ai-scenarios-bar button', { hasText: /unload/ }).count()) === 1,
      'the scenario is mounted in the sandbox',
    );

    const t0 = await page.evaluate(() => window.__aiLab?.world?.time ?? -1);
    await page.waitForTimeout(1200);
    const t1 = await page.evaluate(() => window.__aiLab?.world?.time ?? -1);
    assert(t1 > t0, `the mounted scenario is ticking (${t0.toFixed(2)}s -> ${t1.toFixed(2)}s)`);

    const mounted = await page.evaluate(() => ({
      scene: window.__aiLab?.world?.sceneName ?? null,
      enemies: window.__aiLab?.world?.enemies?.length ?? 0,
    }));
    assert(mounted.enemies > 0, `the scenario's enemies are in the world (${mounted.enemies})`);
    assert(Boolean(mounted.scene), `the sandbox world is the scenario's (${mounted.scene})`);

    // Hand it back.
    await page.locator('.ai-scenarios-bar button', { hasText: /unload/ }).click();
    await page.waitForTimeout(200);
    assert(
      (await page.locator('.ai-scenarios-bar button', { hasText: /unload/ }).count()) === 0,
      'unloading returns the sandbox to free play',
    );

    assert(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ') || 'none'})`);
  } finally {
    await browser.close();
    server.kill();
  }
  return failed ? 1 : 0;
}

process.exit(await main());
