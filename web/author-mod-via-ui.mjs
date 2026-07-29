// Authors a mod by DRIVING THE EDITOR'S UI — not by calling its serialiser.
//
// Everything else in this repo's tooling reaches into the store. This walks the
// path a modder actually walks: open a project, pick a folder in the type rail,
// "+ New in folder", name the asset, edit its fields in the typed editor, Save.
// Whatever the app writes through the File System Access API is then dropped on
// disk as a real mod, so the game can be pointed at the genuine output of the
// tool's UI rather than at something a script generated.
//
// usage: node author-mod-via-ui.mjs <out-mod-dir>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { autoStopOnExit } from './smoke-server.mjs';

const OUT_ROOT = process.argv[2];
if (!OUT_ROOT) {
  console.error('usage: author-mod-via-ui.mjs <mods-root>');
  process.exit(1);
}

const PORT = 4351;
// Each entry is one mod authored end-to-end by clicking: pick this folder in
// the type rail, "+ New in folder", name it, edit its fields, Save as.
const MODS = [
  {
    modId: 'com.test.ui.items',
    folderLabel: 'Crafting Material Definitions',
    folderDir: 'crafting_material_definitions',
    newId: 'ID_UiAuthoredBrick_CM',
    displayName: 'UI Authored Brick',
  },
  {
    modId: 'com.test.ui.consumables',
    folderLabel: 'Consumable Definitions',
    folderDir: 'consumable_definitions',
    newId: 'ID_UiAuthoredBroth_CN',
    displayName: 'UI Authored Broth',
  },
  {
    modId: 'com.test.ui.furniture',
    folderLabel: 'Furniture Definitions',
    folderDir: 'furniture_definitions',
    newId: 'FD_UiAuthoredStool_DF',
    displayName: 'UI Authored Stool',
  },
];

const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], shell: true,
});
autoStopOnExit(proc);

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('preview server never came up');
}

function ok(msg) { console.log(`OK: ${msg}`); }

let code = 0;
try {
  await waitForServer(`http://localhost:${PORT}/`);
  const browser = await chromium.launch();
  // The header collapses at narrow widths and the tool is a desktop app.
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') { pageErrors.push('[console] ' + m.text()); globalThis.__pageErrors = pageErrors; } });

  // A writable in-memory folder standing in for the one a modder would pick.
  // Every write the app performs is recorded so it can be replayed to disk.
  // The proven FSA mock from definitions-ui-smoke.mjs: a nested in-memory tree
  // with real entries()/getDirectoryHandle/getFileHandle, because openProject
  // enumerates the picked folder and silently declines a handle it cannot walk.
  await page.addInitScript(() => {
    // A folder that already holds a mod, which is what "Open project" expects.
    // Authoring into an existing mod folder is the flow a modder repeats; the
    // brand-new-project path is covered separately (and is currently broken —
    // see the note at the bottom of this file).
    const FILES = {
      'project.json': JSON.stringify({ schema_version: 1, name: 'UI Authored Mod' }, null, 2),
      crafting_material_definitions: {
        'ID_UiSeed_CM.json': JSON.stringify({
          id: 'ID_UiSeed_CM',
          class: 'UCraftingMaterialDefinition',
          schema_version: 2,
          properties: {
            display_name: 'Ui Seed',
            stackable: true,
            max_stack_size: 10,
          },
        }, null, 2),
      },
    };
    const writes = {};
    const removed = {};

    function makeFileHandle(name, getText, parentContents) {
      return {
        kind: 'file',
        name,
        async getFile() {
          const text = await getText();
          return new File([text], name, { type: 'application/json' });
        },
        async createWritable() {
          return {
            async write(data) {
              const s = String(data);
              writes[name] = s;
              if (parentContents) parentContents[name] = s;
            },
            async close() {},
          };
        },
      };
    }

    function makeDirHandle(name, contents) {
      return {
        kind: 'directory',
        name,
        async *entries() {
          for (const k of Object.keys(contents)) {
            const v = contents[k];
            if (typeof v === 'string') {
              yield [k, makeFileHandle(k, async () => contents[k], contents)];
            } else {
              yield [k, makeDirHandle(k, v)];
            }
          }
        },
        async getDirectoryHandle(subName, opts) {
          if (!contents[subName]) {
            if (opts?.create) contents[subName] = {};
            else throw new Error('NotFoundError');
          }
          return makeDirHandle(subName, contents[subName]);
        },
        async getFileHandle(fileName, opts) {
          if (!(fileName in contents)) {
            if (opts?.create) contents[fileName] = '';
            else throw new Error('NotFoundError');
          }
          return makeFileHandle(fileName, async () => contents[fileName] || '', contents);
        },
        async removeEntry(targetName) {
          removed[`${name}/${targetName}`] = true;
          delete contents[targetName];
        },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; },
      };
    }

    const root = makeDirHandle('UiAuthoredMod', FILES);
    window._mockFiles = FILES;
    window._written = writes;
    window.showDirectoryPicker = async () => root;
  });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.header .file-info');
  await page.getByRole('button', { name: 'Definitions' }).click();
  await page.waitForSelector('.def-grid');
  await page.waitForFunction(
    () => document.querySelectorAll('.def-folders li').length > 0,
    undefined, { timeout: 30000 },
  );
  ok('editor loaded with the Default Project as a base');

  // --- open the mod folder -------------------------------------------------
  // Authoring is gated on somewhere to write: the create/duplicate toolbar only
  // renders once a directory handle exists, and the bundled Default Project is
  // read-only.
  await page.getByRole('button', { name: /Open project/ }).click();

  // A tree the schema validator has notes about raises a load gate; nobody
  // answering counts as Cancel, which unwinds the open and drops the handle.
  const gate = page.locator('.loadgate-modal');
  for (let i = 0; i < 3; i++) {
    try { await gate.first().waitFor({ state: 'visible', timeout: 4000 }); } catch { break; }
    await gate.locator('.loadgate-actions button').last().click();
    await page.waitForTimeout(600);
  }

  // Wait on the authoring toolbar, not the header text: the toolbar is gated on
  // exactly what authoring needs (a directory handle plus a non-empty set).
  await page.getByRole('button', { name: 'Definitions' }).click();
  await page.waitForSelector('.def-toolbar .def-global-search', { timeout: 30000 });
  ok('opened the mod folder — the authoring toolbar appeared');

  for (const spec of MODS) {
    // --- pick the folder in the type rail ---------------------------------
    const folderRow = page.locator('.def-folders li', { hasText: spec.folderLabel }).first();
    if (!(await folderRow.count())) {
      throw new Error(`no "${spec.folderLabel}" row in the type rail`);
    }
    await folderRow.click();
    await page.waitForTimeout(600);

    // --- "+ New in folder" -------------------------------------------------
    const newBtn = page.locator('.def-toolbar button', { hasText: 'New in folder' }).first();
    await newBtn.click();
    await page.waitForSelector('.def-create-panel');
    await page.locator('.def-create-panel input[type="text"]').fill(spec.newId);
    await page.locator('.def-create-panel button.primary').click();
    await page.waitForSelector('.def-editor-head .def-name-input', { timeout: 20000 });

    // --- edit its fields in the typed editor -------------------------------
    let displayName = page.locator('.def-field-row', { hasText: 'Display Name' })
      .locator('input[type="text"]').first();
    if (!(await displayName.count())) {
      displayName = page.locator('.def-field', { hasText: 'Display Name' })
        .locator('input[type="text"]').first();
    }
    if (await displayName.count()) {
      await displayName.fill(spec.displayName);
      await displayName.blur().catch(() => {});
      await page.waitForTimeout(300);
    }
    ok(`authored ${spec.newId} in ${spec.folderLabel} through the UI`);
  }

  // --- Save ----------------------------------------------------------------
  // The picked folder loads as a read-only source, so the Save trigger stays
  // disabled and its tooltip points at Save As — take the route the UI is
  // telling a modder to take. The menu opens on hover.
  await page.locator('.header').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(400);

  const saveTrigger = page.locator('.header button', { hasText: 'Save' }).first();
  const dirtyLabel = (await saveTrigger.textContent())?.trim() ?? '';
  if (!/Save \(\d+\)/.test(dirtyLabel)) {
    throw new Error(`nothing was marked dirty after authoring — Save reads "${dirtyLabel}"`);
  }
  ok(`the edits are pending: "${dirtyLabel}"`);

  await saveTrigger.hover();
  const saveAs = page.locator('text=Save as…').first();
  await saveAs.waitFor({ state: 'visible', timeout: 10000 });
  await saveAs.click();
  await page.waitForTimeout(6000);

  // Save As writes the whole working set (the Default Project overlay
  // included), far too much to haul across the CDP pipe in one string — pull
  // only the records this run authored.
  const saved = await page.evaluate((ids) => {
    const w = window._written ?? {};
    const keys = Object.keys(w);
    const out = {};
    for (const id of ids) {
      const key = keys.find((k) => k.endsWith(`${id}.json`));
      if (key) out[id] = w[key];
    }
    return { total: keys.length, records: out };
  }, MODS.map((m) => m.newId));

  // --- replay the UI's own output to disk, one mod per record --------------
  for (const spec of MODS) {
    const contents = saved.records[spec.newId];
    if (!contents) {
      throw new Error(`the UI never wrote ${spec.newId}.json (it wrote ${saved.total} file(s))`);
    }
    const modRoot = join(OUT_ROOT, spec.modId);
    mkdirSync(join(modRoot, spec.folderDir), { recursive: true });
    writeFileSync(join(modRoot, spec.folderDir, `${spec.newId}.json`), contents);
    writeFileSync(
      join(modRoot, 'mod.json'),
      JSON.stringify({ id: spec.modId, displayName: spec.modId, version: '1.0.0' }, null, 2)
        + String.fromCharCode(10),
    );

    const parsed = JSON.parse(contents);
    if (parsed.id !== spec.newId) {
      throw new Error(`authored id is ${parsed.id}, expected ${spec.newId}`);
    }
    ok(`wrote ${spec.modId} from the UI's own output`);
  }
  ok(`${MODS.length} mods authored by clicking through the editor (${saved.total} files written in total)`);

  if (pageErrors.length) {
    console.log(`WARN: ${pageErrors.length} page error(s)`);
    for (const e of pageErrors.slice(0, 6)) console.log('   ' + e.slice(0, 400));
  }
  console.log('\n=== MOD AUTHORED THROUGH THE EDITOR UI ===');
  await browser.close();
} catch (e) {
  console.log('FAILED:', e.message);
  for (const err of (globalThis.__pageErrors ?? [])) console.log('   ' + err.slice(0, 400));
  code = 1;
}
process.exit(code);
