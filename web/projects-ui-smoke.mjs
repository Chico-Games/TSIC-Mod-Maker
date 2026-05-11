// Headed Playwright smoke for the Projects flow (Open project / New project).
//
// The browser's File System Access API can't be driven headlessly, so we
// install a mock `showDirectoryPicker` whose returned handle is an
// in-memory tree we can later inspect for what got written.
//
// Coverage:
//   1. New project: pick empty folder → fill form → Create → project.json
//      written with the right shape, file-info shows "Project: <name>".
//   2. Open legacy folder (no project.json): "Project: <folder name>"
//      fallback.
//   3. Open project folder (with project.json): "Project: <meta.name>".

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4242;

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
  // Returns an init script that installs window.showDirectoryPicker and
  // exposes window._mockRoot / _mockWrites for assertions.
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
    // Test 1: New project flow
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`); });
      page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

      // Empty folder — no project.json.
      await page.addInitScript({ content: buildMockPicker({}) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');

      // Verify Sync button is disabled with the right tooltip BEFORE opening anything.
      const syncBtn = page.locator('button:has-text("Sync to Unreal")');
      await syncBtn.waitFor();
      const disabledInitial = await syncBtn.isDisabled();
      assert(disabledInitial, 'Sync button is disabled when no project is open');
      const titleInitial = await syncBtn.getAttribute('title');
      // editor may be unreachable in this test, so accept either "No project" or "Unreal Editor" reason
      assert(
        titleInitial && (titleInitial.includes('No project') || titleInitial.includes('Unreal Editor')),
        `Sync tooltip is informative when blocked (got: ${titleInitial?.slice(0, 80)}…)`,
      );

      // Open New Project modal.
      await page.locator('button:has-text("New project")').click();
      await page.waitForSelector('.new-project-form');
      assert(true, 'New project modal opens');

      // Pick folder (triggers the mock).
      await page.locator('.new-project-form button:has-text("Choose folder")').click();
      await page.waitForSelector('.np-form-row span:has-text("MockRoot")');
      assert(true, 'Folder picker fires + folder name shown');

      // Fill name + sync path.
      await page.locator('.np-form-row input[placeholder*="TSIC Project"]').fill('My Test Project');
      await page.locator('.np-form-row input[placeholder*="Tools"]').fill('C:/test/sync/path');

      // Uncheck the seed-from-bundled (faster test).
      await page.locator('.np-form-row input[type=checkbox]').uncheck();

      // Create.
      await page.locator('.new-project-form button:has-text("Create project")').click();

      // Modal should close.
      await page.waitForSelector('.new-project-form', { state: 'hidden' });
      assert(true, 'Modal closes on create');

      // File-info should show "Project: My Test Project".
      await page.waitForSelector('.file-info:has-text("Project: My Test Project")');
      assert(true, 'file-info shows "Project: My Test Project"');

      // Mock writes should contain project.json with the right shape.
      const projectJson = await page.evaluate(() => window._mockWrites?.['project.json'] ?? null);
      assert(projectJson, 'project.json was written to the mock root');
      const parsed = JSON.parse(projectJson);
      assert(parsed.schema_version === 1, 'project.json schema_version=1');
      assert(parsed.name === 'My Test Project', 'project.json.name preserved');
      assert(parsed.ue_sync_path === 'C:/test/sync/path', 'project.json.ue_sync_path preserved');
      assert(typeof parsed.created_at === 'string', 'project.json.created_at is a string');

      // The sync path should also be reflected in the store's unrealSyncPath
      // and thus disappear the "set path first" blocker — but Unreal isn't
      // running in this test so we won't check the Sync button itself here.
      // Instead, verify the gear shows the right path by opening the path
      // editor and reading the input.
      await page.locator('button:has-text("⚙")').click();
      await page.waitForSelector('.path-editor input');
      const pathVal = await page.locator('.path-editor input').inputValue();
      assert(pathVal === 'C:/test/sync/path', `gear path editor shows the project's sync path (got: ${pathVal})`);

      // Close the path editor.
      await page.keyboard.press('Escape');
      await page.waitForSelector('.path-editor', { state: 'hidden' });

      if (errors.length) {
        console.error('Console errors during test 1:');
        for (const e of errors) console.error('  ' + e);
        process.exit(1);
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 2: Open a folder that HAS a project.json
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`); });
      page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

      const existingProject = {
        'project.json': JSON.stringify({
          schema_version: 1,
          name: 'Existing Project',
          ue_sync_path: 'D:/somewhere/Definitions',
          created_at: '2025-01-01T00:00:00.000Z',
        }, null, 2),
      };
      await page.addInitScript({ content: buildMockPicker(existingProject) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');

      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.file-info:has-text("Project: Existing Project")');
      assert(true, 'Open project: file-info shows project name from project.json');

      // Verify gear shows the project's sync path.
      await page.locator('button:has-text("⚙")').click();
      await page.waitForSelector('.path-editor input');
      const pathVal = await page.locator('.path-editor input').inputValue();
      assert(pathVal === 'D:/somewhere/Definitions', `gear shows project's sync path (got: ${pathVal})`);
      await page.keyboard.press('Escape');

      if (errors.length) {
        console.error('Console errors during test 2:');
        for (const e of errors) console.error('  ' + e);
        process.exit(1);
      }
      await ctx.close();
    }

    // ====================================================================
    // Test 3: Open a legacy folder (no project.json) — fallback to folder name
    // ====================================================================
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`); });
      page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

      await page.addInitScript({ content: buildMockPicker({}) });
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector('h1:has-text("TSIC Definition Editor")');

      await page.locator('button:has-text("Open project")').click();
      await page.waitForSelector('.file-info:has-text("Project: MockRoot")');
      assert(true, 'Legacy folder: file-info shows "Project: <folder name>" fallback');

      // Set a sync path — should NOW write project.json (since the user
      // is configuring a previously-legacy folder, our store auto-creates one).
      await page.locator('button:has-text("⚙")').click();
      await page.waitForSelector('.path-editor input');
      await page.locator('.path-editor input').fill('E:/new/path');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.path-editor', { state: 'hidden' });

      // Did project.json get written?
      const written = await page.evaluate(() => window._mockWrites?.['project.json'] ?? null);
      assert(written, 'Setting sync path on a legacy folder creates project.json');
      const meta = written ? JSON.parse(written) : {};
      assert(meta.ue_sync_path === 'E:/new/path', `project.json.ue_sync_path matches (got: ${meta.ue_sync_path})`);

      if (errors.length) {
        console.error('Console errors during test 3:');
        for (const e of errors) console.error('  ' + e);
        process.exit(1);
      }
      await ctx.close();
    }

    console.log('\n=== ALL PROJECTS SMOKE TESTS PASSED ===\n');
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
