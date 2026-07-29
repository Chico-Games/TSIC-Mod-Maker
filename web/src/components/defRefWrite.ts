// Pure write-back logic for DefRefSlot, split out so it can be unit-tested
// without importing React / dnd-kit.

/** Produce the value to write back into a ref cell, preserving the cell's
 *  existing representation (`curType`, as classified by DefRefSlot on read).
 *  This keeps the envelope→lean round-trip stable and never silently converts a
 *  `soft_asset_ref` into a `definition_ref`:
 *   - `string`      → `{type:'string', value}`   (schema-gap string envelope)
 *   - `bare_string` → the raw string             (untyped bare-string cell)
 *   - `definition_ref` → `{type:'definition_ref', class, value}`
 *   - anything else (incl. empty/unknown) → `soft_asset_ref` — the real schema
 *     type of the recipe-key / loot fields this slot serves. */
export function refWriteValue(curType: string, refClass: string, next: string): any {
  if (curType === 'string') return { type: 'string', value: next };
  if (curType === 'bare_string') return next;
  const writeType = curType === 'definition_ref' ? 'definition_ref' : 'soft_asset_ref';
  return { type: writeType, class: refClass, value: next };
}
