// Visual test: load REAL lean DefaultProject data through the lean→envelope
// converter and screenshot every property type so we can eyeball correctness.
//
// Mocks showDirectoryPicker with a directory handle backed by real lean files
// + the pack's _schema.json, exercising FsaDataSource's converter end to end.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 5181;
const DP = 'C:/Users/Administrator/Documents/Unreal Projects/TSIC/Content/DefinitionPacks/DefaultProject';
const SHOTS = join(process.cwd(), '.tmp', 'shots');
mkdirSync(SHOTS, { recursive: true });

// Curated folders covering scalars, structs, arrays, maps, enums, tags, refs.
const FOLDERS = [
  'ammo_definitions', 'crafting_material_definitions', 'consumable_definitions',
  'storage_definitions', 'production_station_definitions', 'biome_definitions',
  'loot_spawn_point_definitions', 'craft_recipe_definitions', 'equippable_definitions',
  'hotkey_definitions', 'situation_definitions',
];

function buildFiles() {
  const FILES = {};
  for (const dot of ['_schema.json', '.gameplay-tags.json', '.asset-refs.json', '.class-hierarchy.json']) {
    if (existsSync(join(DP, dot))) FILES[dot] = readFileSync(join(DP, dot), 'utf8');
  }
  const picked = {};
  for (const folder of FOLDERS) {
    const dir = join(DP, folder);
    if (!existsSync(dir)) continue;
    const jsons = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort();
    if (!jsons.length) continue;
    const take = jsons.slice(0, 3);
    FILES[folder] = {};
    for (const f of take) FILES[folder][f] = readFileSync(join(dir, f), 'utf8');
    picked[folder] = take[0].replace(/\.json$/, '');
  }
  return { FILES, picked };
}

function startServer() {
  return spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
}
async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('server did not come up');
}

(async () => {
  const { FILES, picked } = buildFiles();
  console.log('picked first file per folder:', picked);
  const proc = startServer();
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const report = { files: [], consoleErrors: [] };
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => report.consoleErrors.push('pageerror: ' + e.message));

    await page.addInitScript((FILES) => {
      try { localStorage.setItem('tsic.def.skipBundled.v1', '1'); } catch {}
      function makeFileHandle(name, contents) {
        return {
          kind: 'file', name,
          async getFile() { return new File([contents[name] ?? ''], name); },
          async createWritable() { return { async write(d) { contents[name] = String(d); }, async close() {} }; },
        };
      }
      function makeDirHandle(name, contents) {
        return {
          kind: 'directory', name,
          async *entries() {
            for (const k of Object.keys(contents)) {
              yield typeof contents[k] === 'string'
                ? [k, makeFileHandle(k, contents)]
                : [k, makeDirHandle(k, contents[k])];
            }
          },
          async *values() { for await (const [, v] of this.entries()) yield v; },
          async getDirectoryHandle(n, o) {
            if (!contents[n]) { if (o?.create) contents[n] = {}; else throw new Error('NotFoundError'); }
            return makeDirHandle(n, contents[n]);
          },
          async getFileHandle(n, o) {
            if (!(n in contents)) { if (o?.create) contents[n] = ''; else throw new Error('NotFoundError'); }
            return makeFileHandle(n, contents);
          },
          async removeEntry(n) { delete contents[n]; },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; },
        };
      }
      window.showDirectoryPicker = async () => makeDirHandle('DefaultProject', FILES);
    }, FILES);

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.header .file-info');
    await page.getByRole('button', { name: 'Definitions' }).click();
    await page.locator('button.primary:has-text("Pick directory")').click();
    await page.waitForSelector('.def-grid', { timeout: 15000 });
    // Dismiss any non-blocking drift gate.
    for (let i = 0; i < 3; i++) {
      const cont = page.locator('.loadgate-actions button', { hasText: 'Continue anyway' });
      if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(200); } else break;
    }
    await page.waitForTimeout(500);

    const folders = await page.locator('.def-folders li .def-folder-name').allTextContents();
    console.log('folders loaded:', folders.length);

    // For each curated folder: open it, select its first file, screenshot, scan.
    let idx = 0;
    for (const folder of Object.keys(picked)) {
      idx++;
      const li = page.locator('.def-folders li').filter({ hasText: humanize(folder) }).first();
      if (!(await li.count())) { console.log('  (folder not in UI:', folder, ')'); continue; }
      await li.click();
      await page.waitForTimeout(250);
      const file = page.locator('.def-files li').first();
      if (!(await file.count())) { console.log('  (no files in', folder, ')'); continue; }
      await file.click();
      await page.waitForSelector('.def-properties', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(350);

      // Diagnostics: unknown fields + which type-color hooks rendered.
      const diag = await page.evaluate(() => {
        const unknowns = [...document.querySelectorAll('.def-type')]
          .map((e) => e.textContent || '').filter((t) => t.includes('unknown'));
        const colors = {};
        for (const c of ['bool', 'number', 'string', 'enum', 'tag', 'ref', 'struct', 'array', 'map']) {
          colors[c] = document.querySelectorAll('.def-type-color-' + c).length;
        }
        const fieldCount = document.querySelectorAll('.def-properties .def-field, .def-properties .def-field-row').length;
        const cls = document.querySelector('.def-editor-head .ss-trigger-label')?.textContent
          || document.querySelector('.def-class-select .ss-trigger-label')?.textContent || '';
        return { unknowns, colors, fieldCount, cls };
      });
      const shot = join(SHOTS, `${String(idx).padStart(2, '0')}-${folder}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      report.files.push({ folder, ...diag, shot });
      console.log(`  ${folder}: fields=${diag.fieldCount} unknowns=${diag.unknowns.length} colors=${JSON.stringify(diag.colors)}`);
      if (diag.unknowns.length) console.log('     UNKNOWN:', diag.unknowns.slice(0, 8));
    }

    // Grouped-by-category screenshot on a rich asset (storage).
    const storageLi = page.locator('.def-folders li').filter({ hasText: 'Storage Definitions' }).first();
    if (await storageLi.count()) {
      await storageLi.click(); await page.waitForTimeout(200);
      await page.locator('.def-files li').first().click();
      await page.waitForSelector('.def-properties').catch(() => {});
      const grp = page.locator('.def-prop-group select');
      if (await grp.count()) {
        await grp.selectOption('category'); await page.waitForTimeout(400);
        const heads = await page.locator('.def-group-head').allTextContents();
        console.log('category group heads:', heads);
        await page.screenshot({ path: join(SHOTS, '90-storage-by-category.png') });
        report.categoryHeads = heads;
        await grp.selectOption('type'); await page.waitForTimeout(400);
        await page.screenshot({ path: join(SHOTS, '91-storage-by-type.png') });
      }
    }

    // ClassBrowser (Furniture tab) detail screenshot.
    await page.getByRole('button', { name: 'Furniture', exact: true }).click().catch(() => {});
    await page.waitForTimeout(600);
    const railRow = page.locator('.rail-family-head, .cb-rail-row, .rail-row').first();
    if (await railRow.count()) { await railRow.click().catch(() => {}); await page.waitForTimeout(400); }
    await page.screenshot({ path: join(SHOTS, '95-classbrowser-furniture.png') });

    console.log('\nconsole errors:', report.consoleErrors.length);
    for (const e of report.consoleErrors.slice(0, 10)) console.log('  ', e);
    const totalUnknown = report.files.reduce((a, f) => a + f.unknowns.length, 0);
    console.log('TOTAL unknown fields across all screens:', totalUnknown);
    console.log('screenshots in', SHOTS);
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message, '\n', e.stack);
    console.error('server out (last 1500):', out.slice(-1500));
    process.exit(1);
  } finally {
    try { spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { shell: true }); } catch {}
    try { proc.kill(); } catch {}
  }
})();

function humanize(folder) {
  return folder.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
