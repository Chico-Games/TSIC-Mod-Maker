import { existsSync } from 'node:fs';

// Single source of truth for the definition pack that ALL tests read real data
// from. We deliberately point at the game's exported pack (the canonical
// `DefaultProject`) rather than the editor's bundled `public/starter-project`
// copy — the export is authoritative and always ships its `_schema.json`.
//
// Override with TSIC_PACK_DIR when the project lives elsewhere. Tests that read
// real pack data should gate on `PACK_AVAILABLE` (pass `{ skip: !PACK_AVAILABLE }`
// to `test`) so the suite degrades gracefully on a machine without the Unreal
// project checked out instead of throwing ENOENT.

export const PACK_DIR =
  process.env.TSIC_PACK_DIR ||
  'C:/Users/Administrator/Documents/Unreal Projects/TSIC/Content/DefinitionPacks/DefaultProject';

export const PACK_AVAILABLE = existsSync(PACK_DIR);
