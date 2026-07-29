// Minimal liveness check for the definition editor: does the app boot and
// render the bundled starter project's definitions? The repo's own
// definitions-ui-smoke.mjs still asserts a "Pick a Definitions root" empty
// state that no longer exists (the app auto-loads the starter project since
// the default-mod submodule change), so it fails before reaching anything real.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4321;
const CWD = 'C:/Users/Administrator/Documents/Projects/tsic-definition-editor/web';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'], shell: true,
});

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('server never came up');
}

let code = 0;
try {
  await waitForServer(`http://localhost:${PORT}/`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.header .file-info', { timeout: 30000 });
  console.log('OK: app shell rendered');

  const fileInfo = (await page.locator('.header .file-info').first().textContent())?.trim();
  console.log(`OK: project label = "${fileInfo}"`);

  await page.getByRole('button', { name: 'Definitions' }).click();
  await page.waitForSelector('.def-grid', { timeout: 30000 });
  const folders = await page.locator('.def-folders li').count();
  console.log(`OK: Definitions tab lists ${folders} folders`);
  if (folders === 0) throw new Error('starter project loaded no definition folders');

  await page.locator('.def-folders li').first().click();
  await page.waitForTimeout(500);
  const files = await page.locator('.def-files li').count();
  console.log(`OK: first folder lists ${files} records`);
  if (files === 0) throw new Error('first folder had no records');

  await page.locator('.def-files li').first().click();
  await page.waitForSelector('.def-editor-head .def-name-input', { timeout: 15000 });
  const name = await page.locator('.def-name-input').inputValue();
  console.log(`OK: typed editor opened on "${name}"`);

  for (const tab of ['Items', 'Furniture', 'Validations']) {
    await page.getByRole('button', { name: tab }).click();
    await page.waitForTimeout(800);
    console.log(`OK: ${tab} tab rendered`);
  }

  if (consoleErrors.length) {
    console.log(`WARN: ${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 8)) console.log('   ', e.slice(0, 200));
  } else {
    console.log('OK: no console errors');
  }
  await browser.close();
} catch (e) {
  console.log('FAILED:', e.message);
  code = 1;
} finally {
  server.kill('SIGKILL');
  process.exit(code);
}
