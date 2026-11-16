// Headless Playwright smoke for Recipes & Loot > Loot, against the bundled
// default project (no directory pick needed).
//
// It walks the job the tab exists for, start to finish:
//   - the default project opens with NO load-gate modal
//   - a new drop table can be made, filled by clicking items, and tuned
//   - it can be attached to a furniture without leaving the tab
//   - what would be written to disk is exactly the game's lean shape
//   - world loot shows tiers, inherited rows and shares that sum to 100%
//   - the Biome sub-tab opens promptly and its "Edit loot" lands on the table
//   - every definition folder in the project is reachable from a tab
//
// Run: npm run smoke:loottab

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { autoStopOnExit } from './smoke-server.mjs';

const PORT = 4251;
const BASE = `http://localhost:${PORT}/`;

let failed = 0;
function check(cond, msg) {
  if (cond) console.log(`OK: ${msg}`);
  else { console.error(`FAIL: ${msg}`); failed += 1; }
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server didn't come up in ${timeoutMs}ms`);
}

async function main() {
  if (!process.env.SMOKE_SKIP_BUILD) {
    console.log('Building...');
    const build = spawn('npx', ['vite', 'build'], { cwd: process.cwd(), stdio: 'inherit', shell: true });
    check((await new Promise((r) => build.on('exit', r))) === 0, 'vite build succeeded');
    if (failed) return 1;
  }
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
  autoStopOnExit(server);
  await waitForServer(BASE);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 880 } });
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE);
  await page.addStyleTag({ content: '#tsic-host-back,#tsic-boot{display:none!important}' });

  // ── boot: the default project must open without a warning modal ──
  let sawGate = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    if (await page.locator('.loadgate-modal').count()) { sawGate = true; break; }
    const n = await page.evaluate(() => window.__tsicDefs?.getState().definitions.size ?? 0);
    if (n > 0 && !(await page.evaluate(() => window.__tsicDefs.getState().loading))) break;
  }
  // The asset-ref drift pass lands a few seconds after the records do.
  for (let i = 0; i < 20 && !sawGate; i++) {
    await page.waitForTimeout(500);
    if (await page.locator('.loadgate-modal').count()) sawGate = true;
  }
  check(!sawGate, 'default project loads with no load-gate modal');
  if (sawGate) {
    console.error((await page.locator('.loadgate-modal').innerText()).slice(0, 600));
    await page.getByRole('button', { name: 'Continue anyway' }).click();
  }

  const tab = async (name) => { await page.locator('.header .tab', { hasText: name }).first().click(); await page.waitForTimeout(600); };
  const sub = async (name) => { await page.locator('.subtab', { hasText: name }).click(); await page.waitForTimeout(600); };
  const rows = (cls) => page.locator(`.lt-row.${cls}:not(.lt-head)`);

  // ── drop table: create, fill, tune ──
  await tab('Recipes');
  await sub('Loot');
  await page.locator('.lt-kind', { hasText: 'Drop tables' }).click();
  await page.getByRole('button', { name: /New drop table/ }).click();
  await page.waitForTimeout(400);
  check((await page.locator('.lt-id').innerText()).startsWith('LD_New'), 'a new drop table is created and selected');
  check((await rows('drop').count()) === 0, 'a new drop table starts with no rows (not a copy of its template)');

  for (const q of ['scrap metal', 'metal screws']) {
    await page.locator('.lt-picker input').first().fill(q);
    await page.waitForTimeout(500);
    await page.locator('.lt-picker .lt-pick').first().click();
    await page.waitForTimeout(150);
  }
  check((await rows('drop').count()) === 2, 'clicking two items in the picker adds two rows');

  const second = rows('drop').nth(1);
  await second.locator('.lt-num input').first().fill('3');
  await second.locator('.lt-num input').first().blur();
  await second.locator('.lt-percent .lt-num input').fill('40');
  await second.locator('.lt-percent .lt-num input').blur();
  await page.waitForTimeout(300);
  const summary = (await page.locator('.lt-summary').innerText()).replace(/\s+/g, ' ');
  check(/1\.2× Metal Screws/.test(summary), `average yield is computed (3 × 40% = 1.2) — "${summary}"`);

  // ── attach to a furniture from the same screen ──
  check((await page.locator('.lt-usedby.empty').count()) === 1, 'an unattached table says nothing drops it');
  await page.getByRole('button', { name: /Use on furniture/ }).click();
  await page.locator('.lt-attach-pop input').fill('vending');
  await page.waitForTimeout(500);
  await page.locator('.lt-attach-list .lt-pick').first().click();
  await page.waitForTimeout(400);
  check(/Dropped by 1/.test(await page.locator('.lt-usedby').innerText()), 'after attaching, the table lists the furniture that drops it');

  // ── what would hit disk ──
  const disk = await page.evaluate(async () => {
    const s = window.__tsicDefs.getState();
    const table = [...s.definitions.values()].find((r) => r.id.startsWith('LD_New'));
    const lean = JSON.parse(await s.dataSource.toLeanText(JSON.stringify(table.json)));
    const furnKey = [...s.dirty].find((k) => !k.startsWith('loot_definitions/'));
    const furn = JSON.parse(await s.dataSource.toLeanText(JSON.stringify(s.definitions.get(furnKey).json)));
    return { id: table.id, props: lean.properties, dirty: s.dirty.size, furnitureLoot: furn.properties.loot_dropped_on_death };
  });
  check(
    JSON.stringify(disk.props.items_to_drop) === JSON.stringify([
      { item_to_drop: 'ID_ScrapMetal_CM', count: 1, chance_to_drop: 1 },
      { item_to_drop: 'ID_MetalScrews_CM', count: 3, chance_to_drop: 0.4 },
    ]),
    'the table saves as the game\'s lean items_to_drop rows',
  );
  check(disk.props.weighted_chance === 1000 && disk.props.world_gen_priority === 1000, 'a new table gets the class-default world-gen dials, not zeroes');
  check(disk.dirty === 2, `exactly two files are dirty: the table and the furniture (got ${disk.dirty})`);
  check(Array.isArray(disk.furnitureLoot) && disk.furnitureLoot.at(-1) === disk.id, 'the furniture\'s death loot ends with the new table id');

  // ── world loot ──
  await page.locator('.lt-kind', { hasText: 'World loot' }).click();
  await page.locator('.lt-rail-row', { hasText: 'Warehouse Container' }).click();
  await page.locator('.lt-tier-tab', { hasText: 'Hard' }).click();
  await page.waitForTimeout(400);
  check((await page.locator('.lt-row.weighted.inherited').count()) > 0, 'a harder tier shows the rows it inherits from easier tiers');
  const shareSum = (await page.locator('.lt-row.weighted:not(.lt-head) .lt-share-bar > span').evaluateAll(
    (els) => els.reduce((s, e) => s + parseFloat(e.style.width || '0'), 0),
  ));
  check(Math.abs(shareSum - 100) < 0.5, `shares of picks sum to 100% (got ${shareSum.toFixed(2)})`);
  const before = await rows('weighted').count();
  await page.locator('.lt-picker .lt-pick').first().click();
  await page.waitForTimeout(300);
  check((await rows('weighted').count()) === before + 1, 'clicking an item adds it to the open tier');

  // ── biome ──
  const t0 = Date.now();
  await sub('Biome');
  await page.waitForSelector('.bm-slot');
  const biomeMs = Date.now() - t0;
  check(biomeMs < 5000, `Biome sub-tab opens promptly (${biomeMs}ms; it took ~54s before large tables were folded)`);
  await page.locator('.bm-slot .bm-slot-table').first().click();
  await page.waitForTimeout(600);
  check((await page.locator('.subtab.active').innerText()).includes('Loot'), 'a biome loot card opens the Loot tab');
  check((await page.locator('.lt-id').innerText()).startsWith('LSP_'), 'with that biome\'s world loot table selected');

  // ── coverage ──
  const reach = await page.evaluate(() => [...new Set([...window.__tsicDefs.getState().definitions.values()].map((r) => r.folder))]);
  const railText = [];
  for (const name of ['Items', 'Furniture', 'Systems']) {
    await tab(name);
    railText.push(...(await page.locator('.vertical-subtab').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''))));
  }
  const inRails = new Set(railText.map((t) => t.split(' — ')[0]));
  const elsewhere = new Set([
    'layout_definitions', 'craft_recipe_definitions', 'plant_recipe_definitions', 'furniture_upgrade_recipe',
    'available_recipe_rules_definitions', 'loot_definitions', 'loot_spawn_point_definitions', 'enemy_definitions',
    'biome_definitions', 'behavior_definitions', 'perception_definitions',
  ]);
  const homeless = reach.filter((f) => !inRails.has(f) && !elsewhere.has(f));
  check(homeless.length === 0, `every loaded folder has a tab (${reach.length} folders${homeless.length ? `; missing: ${homeless.join(', ')}` : ''})`);

  check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);
  await browser.close();
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
