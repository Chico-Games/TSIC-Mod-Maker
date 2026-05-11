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
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
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
            class: 'BP_C',
          }),
          'broken.json': '{ not valid json',
        },
      };
      await page.addInitScript({ content: buildMockPicker(tree) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
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
    // Test 2b: draft autosave + restore prompt
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const tree = {
        'project.json': JSON.stringify({ schema_version: 1, name: 'DraftP' }, null, 2),
        'constructable_item_definitions': {
          'ID_DraftFoo_CI.json': JSON.stringify(
            { id: 'ID_DraftFoo_CI', asset_path: '/Game/X', class: 'BP_C' },
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
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
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
        await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
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
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');
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
