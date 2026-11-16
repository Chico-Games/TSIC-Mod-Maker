#!/usr/bin/env node
/**
 * build-icons — shrink the default mod's item icons into the bundled
 * starter-project so the editor can show the real artwork next to item names.
 *
 * The pack ships 256px PNGs (~21 MB for ~500 icons) under `icons/`; item
 * definitions point at them as `"thumbnail": "mod:icons/<name>"`. The editor
 * only ever draws them at 20-40px, so they are re-encoded as 96px WebP
 * (roughly a tenth of the size) into `public/starter-project/icons/`.
 *
 * Usage:  node scripts/build-icons.mjs [--source <pack dir>]
 * Called by refresh-schema; safe to run on its own. Needs `sharp`, which is
 * already installed as a dependency of @huggingface/transformers — if it is
 * missing the step is skipped and the editor falls back to folder glyphs.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = dirname(HERE);
const argv = process.argv.slice(2);
const i = argv.indexOf('--source');
const PACK_DIR = i >= 0 ? argv[i + 1] : join(WEB_DIR, '..', 'vendor', 'default-mod');
const SRC = join(PACK_DIR, 'icons');
const OUT = join(WEB_DIR, 'public', 'starter-project', 'icons');
const SIZE = 96;

if (!existsSync(SRC)) {
  console.log(`build-icons: no icons/ folder in ${PACK_DIR} — nothing to do`);
  process.exit(0);
}
let sharp;
try { sharp = (await import('sharp')).default; } catch {
  console.warn('build-icons: `sharp` is not installed — skipping (editor will show folder glyphs)');
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = readdirSync(SRC).filter((f) => /\.png$/i.test(f));
let done = 0;
let failed = 0;
const queue = files.slice();
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) {
    const f = queue.pop();
    if (!f) return;
    try {
      await sharp(join(SRC, f))
        .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 82 })
        .toFile(join(OUT, f.replace(/\.png$/i, '.webp').toLowerCase()));
      done++;
    } catch (e) {
      failed++;
      console.warn(`  ⚠ ${f}: ${e.message}`);
    }
  }
}));
console.log(`build-icons: wrote ${done} icon(s) at ${SIZE}px to public/starter-project/icons${failed ? ` (${failed} failed)` : ''}`);
