import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Single source of truth for the definition pack that ALL tests read real data
// from.
//
// Resolution order:
//   1. TSIC_PACK_DIR, when the project lives elsewhere.
//   2. The game's exported pack, if this machine has the Unreal project.
//   3. vendor/default-mod — the pinned submodule, which IS a real pack (it ships
//      its own `_schema.json` and sidecars) and is present in every checkout.
//
// (3) matters: the external export dir no longer exists on the dev machine since
// the submodule became the source of truth, so PACK_AVAILABLE was false and
// every real-data test silently skipped — including the lean→envelope→lean proof
// harness. That is how a case-sensitive enum lookup shipped while rewriting
// EnemyDefinition variant tiers from Easy (1) to Base (0) on save. Falling back
// to the submodule restores that coverage everywhere, CI included.
//
// Tests reading real pack data should still gate on `PACK_AVAILABLE`
// (`{ skip: !PACK_AVAILABLE }`) so a checkout without submodules degrades
// gracefully rather than throwing ENOENT.

const EXTERNAL_EXPORT =
  'C:/Users/Administrator/Documents/Unreal Projects/TSIC/Content/DefinitionPacks/DefaultProject';
const SUBMODULE_PACK = join(import.meta.dirname, '..', '..', 'vendor', 'default-mod');

function resolvePackDir(): string {
  if (process.env.TSIC_PACK_DIR) return process.env.TSIC_PACK_DIR;
  if (existsSync(join(EXTERNAL_EXPORT, '_schema.json'))) return EXTERNAL_EXPORT;
  return SUBMODULE_PACK;
}

export const PACK_DIR = resolvePackDir();

// Require `_schema.json`, not just the directory: an uninitialised submodule
// leaves an empty dir behind, which would pass a bare existsSync and then fail
// every test with ENOENT instead of skipping.
export const PACK_AVAILABLE = existsSync(join(PACK_DIR, '_schema.json'));
