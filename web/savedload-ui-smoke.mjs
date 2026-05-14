// Headed Playwright smoke for save/load improvements:
//   1. Future schema_version refusal (Task 1)
//   2. Structural validator gate + Continue path (Task 2)
//   3. Draft autosave + restore prompt (Task 3)
//   4. Recent-projects dropdown (Task 4)
//
// Uses the same mock-picker pattern as projects-ui-smoke.mjs.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4243;

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

function buildMockPicker(initialContents) {
  return `(() => {
    try { localStorage.setItem('tsic.def.skipBundled.v1', '1'); } catch {}
    const contents = ${JSON.stringify(initialContents)};
    const writes = {};
    function makeFileHandle(name, parent) {
      return {
        kind: 'file', name,
        async getFile() { return new File([parent[name] || ''], name, { type: 'application/json' }); },
        async createWritable() {
          return {
            async write(data) {
              const s = (data && typeof data === 'object' && 'text' in data) ? await data.text() : String(data);
              parent[name] = s;
              writes[name] = s;
            },
            async close() {},
          };
        },
      };
    }
    function makeDirHandle(name, c) {
      return {
        kind: 'directory', name,
        async *entries() {
          for (const k of Object.keys(c)) {
            const v = c[k];
            yield typeof v === 'string'
              ? [k, makeFileHandle(k, c)]
              : [k, makeDirHandle(k, v)];
          }
        },
        async getDirectoryHandle(sub, opts) {
          if (!(sub in c)) {
            if (opts?.create) c[sub] = {};
            else throw new Error('NotFoundError');
          }
          return makeDirHandle(sub, c[sub]);
        },
        async getFileHandle(fn, opts) {
          if (!(fn in c)) {
            if (opts?.create) c[fn] = '';
            else throw new Error('NotFoundError');
          }
          return makeFileHandle(fn, c);
        },
        async removeEntry(n) { delete c[n]; },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; },
      };
    }
    const root = makeDirHandle('MockRoot', contents);
    window._mockRoot = root;
    window._mockContents = contents;
    window._mockWrites = writes;
    window.showDirectoryPicker = async () => root;
  })();`;
}

(async () => {
  const proc = startServer();
  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  let browser;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await chromium.launch();

    // ====================================================================
    // Test 1: future-version refusal
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 999, name: 'From The Future' }, null, 2),
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal h2:has-text("newer editor")');
      assert(true, 'Future-version: LoadGate refusal modal appears');
      const shown = await page.locator('.file-info:has-text("Project: From The Future")').count();
      assert(shown === 0, 'Future-version: no records loaded (file-info does NOT show project name)');
      await page.locator('.loadgate-modal button:has-text("Got it")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await ctx.close();
    }

    // ====================================================================
    // Test 2: structural validator gate — Continue path
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'P' }, null, 2),
        'constructable_item_definitions': {
          'ID_OK_CI.json': JSON.stringify({
            id: 'ID_OK_CI',
            asset_path: '/Game/X',
            class: 'UConstructableItemDefinition',
          }),
          'broken.json': '{ not valid json',
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal:has-text("problem")');
      assert(true, 'Structural: LoadGate appears with issues');
      const issuesText = await page.locator('.loadgate-issues').textContent();
      assert(
        issuesText && issuesText.includes('broken.json'),
        'Structural: broken file is listed in the modal',
      );
      await page.locator('.loadgate-modal button:has-text("Continue anyway")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await page.waitForSelector('.file-info:has-text("Project: P")');
      assert(true, 'Structural: project loads after Continue (good record committed)');
      await ctx.close();
    }

    // ====================================================================
    // Test 2c: schema drift gate — Continue path
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'DriftP' }, null, 2),
        'consumable_definitions': {
          'ID_Mystery_CN.json': JSON.stringify({
            id: 'ID_Mystery_CN',
            asset_path: '/Game/X/ID_Mystery_CN',
            class: 'UFakeClass_QYZ', // intentionally unknown
            properties: {},
          }),
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal h2:has-text("Schema drift detected")');
      assert(true, 'Drift: LoadGate appears with drift heading');
      const driftText = await page.locator('.loadgate-issues').textContent();
      assert(
        driftText && driftText.includes('UFakeClass_QYZ'),
        'Drift: unknown class is listed in the modal',
      );
      await page.locator('.loadgate-modal button:has-text("Continue anyway")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await page.waitForSelector('.file-info:has-text("Project: DriftP")');
      assert(true, 'Drift: project loads after Continue');
      await ctx.close();
    }

    // ====================================================================
    // Test 2b: draft autosave + restore prompt
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'DraftP' }, null, 2),
        'constructable_item_definitions': {
          'ID_DraftFoo_CI.json': JSON.stringify(
            { id: 'ID_DraftFoo_CI', asset_path: '/Game/X', class: 'UConstructableItemDefinition' },
            null,
            2,
          ),
        },
      };
      const initScript = buildMockPicker(tree);

      // Visit 1: open + mutate + flush + close
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: DraftP")');
        // Force a dirty record + flush drafts synchronously (bypasses the
        // 1-second debounce so the test doesn't have to wait).
        await page.evaluate(async () => {
          const w = window;
          w.__forceDirty();
          await w.__flushDraftsNow();
        });
        await page.close();
      }

      // Visit 2: re-open same project, expect RestoreDraftPrompt.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.loadgate-modal h2:has-text("Restore unsaved")');
        assert(true, 'Draft: RestoreDraftPrompt appears on second open');
        await page.locator('.loadgate-modal button:has-text("Restore")').click();
        await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
        await page.waitForSelector('.file-info:has-text("unsaved")');
        assert(true, 'Draft: after Restore, header shows unsaved badge');
        await page.close();
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 3: structural validator gate — Cancel path
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'P2' }, null, 2),
        'constructable_item_definitions': {
          'broken.json': '{ also bad',
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal:has-text("problem")');
      await page.locator('.loadgate-modal button:has-text("Cancel")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      // Cancel keeps the existing file-info ("bundled defaults") since no
      // records were committed.
      const projectShown = await page.locator('.file-info:has-text("Project: P2")').count();
      assert(projectShown === 0, 'Structural: Cancel does NOT commit any records');
      await ctx.close();
    }

    // ====================================================================
    // Test 3b: legacy folder (no project.json) loads with v1 default
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        // No project.json — legacy folder. The store should fall back to
        // handle.name as the project name and treat the version as 1.
        'constructable_item_definitions': {
          'ID_Legacy_CI.json': JSON.stringify(
            { id: 'ID_Legacy_CI', asset_path: '/Game/L', class: 'UConstructableItemDefinition' },
            null,
            2,
          ),
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      // No LoadGate should appear; the project name falls back to "MockRoot".
      await page.waitForSelector('.file-info:has-text("Project: MockRoot")');
      assert(true, 'Legacy: folder without project.json still loads (name = folder name)');
      const futureModal = await page.locator('.loadgate-modal').count();
      assert(futureModal === 0, 'Legacy: no LoadGate appears for valid records without project.json');
      await ctx.close();
    }

    // ====================================================================
    // Test 3c: structural gate flags missing-field issues
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'MF' }, null, 2),
        'constructable_item_definitions': {
          // Missing required `class` field.
          'ID_NoClass_CI.json': JSON.stringify({ id: 'ID_NoClass_CI', asset_path: '/Game/X' }),
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.loadgate-modal:has-text("problem")');
      const text = await page.locator('.loadgate-issues').textContent();
      assert(text && text.includes('missing required field'), 'Structural: missing-field rendered in LoadGate');
      assert(text && text.includes('class'), 'Structural: the missing field name is shown');
      // Cancel so the next test starts clean.
      await page.locator('.loadgate-modal button:has-text("Cancel")').click();
      await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      await ctx.close();
    }

    // ====================================================================
    // Test 3d: draft Discard clears the cache and doesn't restore
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'DiscardP' }, null, 2),
        'constructable_item_definitions': {
          'ID_DiscardFoo_CI.json': JSON.stringify(
            { id: 'ID_DiscardFoo_CI', asset_path: '/Game/X', class: 'UConstructableItemDefinition' },
            null,
            2,
          ),
        },
      };
      const initScript = buildMockPicker(tree);

      // Visit 1: edit + flush + close
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: DiscardP")');
        await page.evaluate(async () => {
          window.__forceDirty();
          await window.__flushDraftsNow();
        });
        await page.close();
      }
      // Visit 2: prompt appears → Discard → no unsaved badge
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.loadgate-modal h2:has-text("Restore unsaved")');
        await page.locator('.loadgate-modal button:has-text("Discard")').click();
        await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
        // file-info should show the project but NO "unsaved" badge.
        await page.waitForSelector('.file-info:has-text("Project: DiscardP")');
        const unsaved = await page.locator('.file-info:has-text("unsaved")').count();
        assert(unsaved === 0, 'Draft Discard: no unsaved badge after declining');
        await page.close();
      }
      // Visit 3: re-open same project — the prompt should NOT appear again
      // because Discard cleared the IndexedDB record.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: DiscardP")');
        const promptCount = await page.locator('.loadgate-modal h2:has-text("Restore unsaved")').count();
        assert(promptCount === 0, 'Draft Discard: prompt is gone on the next open (cleared)');
        await page.close();
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 3e: drafts are isolated per project (no cross-contamination)
    // ====================================================================
    {
      // Project A has a draft; opening project B (different name) must
      // NOT show a restore prompt.
      const ctx = await browser.newContext();
      const treeA = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'IsoA' }, null, 2),
        'constructable_item_definitions': {
          'ID_IsoA_CI.json': JSON.stringify(
            { id: 'ID_IsoA_CI', asset_path: '/Game/X', class: 'UConstructableItemDefinition' },
            null,
            2,
          ),
        },
      };
      const treeB = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'IsoB' }, null, 2),
        'constructable_item_definitions': {
          'ID_IsoB_CI.json': JSON.stringify(
            { id: 'ID_IsoB_CI', asset_path: '/Game/X', class: 'UConstructableItemDefinition' },
            null,
            2,
          ),
        },
      };

      // Visit 1: open A, mark dirty, flush, close.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: buildMockPicker(treeA) });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: IsoA")');
        await page.evaluate(async () => {
          window.__forceDirty();
          await window.__flushDraftsNow();
        });
        await page.close();
      }
      // Visit 2: open B (different project) — NO prompt should appear.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: buildMockPicker(treeB) });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: IsoB")');
        const promptCount = await page.locator('.loadgate-modal h2:has-text("Restore unsaved")').count();
        assert(promptCount === 0, 'Draft isolation: opening project B does NOT restore project A drafts');
        await page.close();
      }
      // Cleanup: open A again and discard so later tests start clean.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: buildMockPicker(treeA) });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        const hasPrompt = await page
          .locator('.loadgate-modal h2:has-text("Restore unsaved")')
          .waitFor({ timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        if (hasPrompt) {
          await page.locator('.loadgate-modal button:has-text("Discard")').click();
          await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
        }
        await page.close();
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 4: recent projects dropdown
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'RecentP' }, null, 2),
      };
      const initScript = buildMockPicker(tree);

      // Visit 1: open the project. The recents-DB should record it.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('button:has-text("Open project")').click();
        await page.waitForSelector('.file-info:has-text("Project: RecentP")');
        await page.close();
      }

      // Visit 2: a fresh page; the chevron dropdown should list RecentP.
      // We don't assert a click-to-reopen because the mock handle does NOT
      // survive structured-clone (real Chromium FSA handles do); in that
      // fallback path openRecent routes to the picker, which we verify
      // separately by clicking the entry and seeing the project reopen
      // through the picker mock.
      {
        const page = await ctx.newPage();
        await page.addInitScript({ content: initScript });
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector('.header .file-info');
        await page.locator('.open-project-chevron').click();
        await page.waitForSelector('.recents-dropdown .recents-name:has-text("RecentP")');
        assert(true, 'Recents: dropdown lists RecentP after first open');
        await page.locator('.recents-item:has(.recents-name:has-text("RecentP"))').click();
        // In the smoke this falls back to the picker; either way the
        // project reopens to the same MockRoot tree.
        await page.waitForSelector('.file-info:has-text("Project: RecentP")');
        assert(true, 'Recents: clicking the entry reopens the project');
        await page.close();
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 5: recents dropdown shows empty state on first run
    // ====================================================================
    {
      // A brand-new browser context starts with zero recents.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.addInitScript({ content: buildMockPicker({}) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');
      await page.locator('.open-project-chevron').click();
      await page.waitForSelector('.recents-dropdown');
      const empty = await page.locator('.recents-empty').count();
      assert(empty === 1, 'Recents: empty state shown when no projects have been opened');
      await ctx.close();
    }

    // ====================================================================
    // Test 6: AssetRefPicker renders soft_asset_ref envelope (read-side)
    // ====================================================================
    // FD_Floor_Gardening in the bundled starter-project has a non-null
    // `static_mesh` soft_asset_ref envelope. Opening that asset in the
    // Definitions tab should render an AssetRefPicker showing the
    // [StaticMesh] class label and the existing path / catalog name.
    // We don't round-trip a value change — Playwright click sequences
    // for in-page popovers are brittle. The unit tests already cover
    // the read↔write round-trip; this scenario only asserts the
    // picker mounts with the existing value.
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // No mock picker — let the app auto-load the bundled starter
      // project over HTTP (HttpDataSource). The bootstrap path runs
      // `loadBundledDefaults()` when no FSA handle is saved.
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');

      // The starter project trips the schema-drift gate on load (the
      // bundled defs reference some classes that aren't in the bundled
      // schema yet). Dismiss with "Continue anyway" so the records still
      // commit and we can navigate the Definitions tab.
      const driftHeading = page.locator('.loadgate-modal h2:has-text("Schema drift detected")');
      const sawDrift = await driftHeading
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (sawDrift) {
        await page.locator('.loadgate-modal button:has-text("Continue anyway")').click();
        await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      }

      await page.waitForSelector('.file-info:has-text("Project: Default Project")');
      assert(true, 'AssetRefPicker: starter project loaded');

      // Switch to the Definitions tab.
      await page.locator('.tabs button.tab:has-text("Definitions")').click();
      await page.waitForSelector('.def-grid');

      // Open furniture_definitions (exact match — there are siblings
      // like "Furniture Upgrade Recipe" and "Furniture With Components
      // Definitions") and pick FD_Floor_Gardening.
      await page
        .locator('.def-folders li .def-folder-name', { hasText: /^Furniture Definitions$/ })
        .click();
      await page.locator('.def-files li[title="FD_Floor_Gardening"]').click();
      await page.waitForSelector('.def-editor-inner');

      // The AssetRefPicker should render for the `static_mesh` row.
      const trigger = page.locator('.assetrefpicker-trigger').first();
      await trigger.waitFor({ state: 'visible', timeout: 5000 });

      const classLabel = await trigger.locator('.assetrefpicker-class').textContent();
      assert(
        !!classLabel && classLabel.includes('StaticMesh'),
        `AssetRefPicker: class label shows [StaticMesh] (got "${classLabel}")`,
      );

      const valueLabel = await trigger.locator('.assetrefpicker-label').textContent();
      assert(
        !!valueLabel && !valueLabel.includes('(none)'),
        `AssetRefPicker: value label is not "(none)" (got "${valueLabel}")`,
      );
      // The label is either the catalog "name" (if the catalog has it)
      // or the raw soft path. FD_Floor_Gardening's mesh is
      // SM_Floor_Gardening — assert the name appears somewhere.
      assert(
        !!valueLabel && valueLabel.includes('SM_Floor_Gardening'),
        `AssetRefPicker: value label references SM_Floor_Gardening (got "${valueLabel}")`,
      );
      await ctx.close();
    }

    // ====================================================================
    // Test 7: Layouts tab loads LYD_Bathroom_All with outliner + details
    // ====================================================================
    // Mirrors the AssetRefPicker scenario's setup: load the bundled starter
    // project over HTTP (HttpDataSource path, no folder picker) and dismiss
    // the schema-drift LoadGate. Then switch to the Layouts tab, pick
    // LYD_Bathroom_All, assert the outliner populates, click the first row
    // and assert the Details panel renders a property field.
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('.header .file-info');

      // Dismiss schema-drift gate if it appears (same as Test 6).
      const driftHeading = page.locator('.loadgate-modal h2:has-text("Schema drift detected")');
      const sawDrift = await driftHeading
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (sawDrift) {
        await page.locator('.loadgate-modal button:has-text("Continue anyway")').click();
        await page.waitForSelector('.loadgate-modal', { state: 'hidden' });
      }
      await page.waitForSelector('.file-info:has-text("Project: Default Project")');

      // Switch to the Layouts tab.
      await page.locator('.tabs button.tab:has-text("Layouts")').click();
      await page.waitForSelector('.layouts-tab', { timeout: 5000 });

      // Pick LYD_Bathroom_All in the toolbar select.
      await page.selectOption('.layouts-toolbar select', 'LYD_Bathroom_All');

      // Outliner should populate. LYD_Bathroom_All has ~38 rows; tolerate drift.
      await page.waitForSelector('.outliner-row', { timeout: 10000 });
      const rowCount = await page.locator('.outliner-row').count();
      assert(
        rowCount >= 10 && rowCount <= 50,
        `Layouts: expected 10-50 outliner rows for LYD_Bathroom_All, got ${rowCount}`,
      );

      // Click the first row.
      await page.locator('.outliner-row').first().click();

      // Details panel should render TypedPropertiesEditor output (.def-field).
      await page.waitForSelector('.layouts-details .def-field', { timeout: 5000 });
      assert(true, 'Layouts: details panel renders TypedPropertiesEditor for first row');
      await ctx.close();
    }

    console.log('\n=== ALL SAVE/LOAD SMOKE TESTS PASSED ===\n');
  } catch (err) {
    console.error('Test failed:', err);
    console.error('--- server stdout ---\n', stdoutBuf.slice(-1500));
    console.error('--- server stderr ---\n', stderrBuf.slice(-1500));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }
})();
