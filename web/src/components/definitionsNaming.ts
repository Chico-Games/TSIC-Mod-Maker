// Naming helpers for the Definitions editor.
// Centralized so the typed editor, dropdowns, and reference viewer all
// present the same labels.

const ACRONYMS = new Set(['xp', 'ui', 'vfx', 'ai', 'fx', 'id', 'hp', 'sfx']);

/** Convert a snake_case property name into a human-friendly title.
 *  - drops the Hungarian-style `b_` prefix used for booleans
 *  - turns underscores into spaces
 *  - title-cases each word, with a few common acronyms upper-cased
 *  - replaces the verbose `apply_X` pattern with just `X` (the parent
 *    is_apply_X bool gates it; the bare X is the value).
 *
 *  Examples:
 *    "b_apply_max_health_increase" → "Apply Max Health Increase"
 *    "casts_shadow"                → "Casts Shadow"
 *    "ability_sets_to_grant"       → "Ability Sets To Grant"
 */
export function humanizeProperty(name: string): string {
  let s = name;
  if (s.startsWith('b_')) s = s.slice(2);
  return s
    .split('_')
    .map((w) => {
      if (!w) return w;
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** TSIC asset names follow a `<PREFIX>_<Stem>_<SUFFIX>` convention where the
 *  prefix tags the asset family (ID_/RD_/LD_/FD_/ED_/AS_/IRD_/ARR_/LSP_/ESP_/
 *  LYD_/SCP_) and the optional suffix tags the leaf class (_CN consumable,
 *  _CR craft recipe, _CM crafting material, _AM ammo, _EQ equippable, _SI
 *  static item, _PS production station, _CI constructable item, _GL glove,
 *  _SD seed, _CE containment, _DF cage, _CS crafting station). The prefix +
 *  suffix mostly duplicate type info already captured by the `class` field,
 *  so for display we strip them and show the bare stem.
 *
 *  Examples:
 *    "ID_BakedPotato_CN" → "BakedPotato"
 *    "RD_Bread_CR"       → "Bread"
 *    "FD_Cage_Basic_DF"  → "Cage_Basic"
 *    "AS_Chainsaw"       → "Chainsaw"  (no suffix)
 *    "SCP_DefaultGameData" → "DefaultGameData"
 */
const PREFIX_RE = /^[A-Z]{2,4}_/;
const SUFFIX_RE = /_[A-Z]{2,3}$/;

/** Strip the family prefix (`ID_`, `RD_`, `FD_`, …) and the leaf-class
 *  suffix (`_CR`, `_CM`, …) from an asset id, then insert spaces at
 *  camelCase / digit boundaries so `BenchTier1` reads `Bench Tier 1`.
 *  Underscores left over from rare multi-word stems become spaces too.
 *  The under-the-hood id never carries spaces — this is purely a
 *  visual transform; the `unhumanizeAssetId` inverse strips spaces
 *  back to camelCase before the rename pipeline writes the new id. */
export function humanizeAssetId(id: string): string {
  if (!id) return id;
  let s = id;
  if (PREFIX_RE.test(s)) s = s.replace(PREFIX_RE, '');
  if (SUFFIX_RE.test(s)) s = s.replace(SUFFIX_RE, '');
  if (!s) return id;
  // Underscores → spaces (rare in stems but data has e.g. "Cage_Basic").
  s = s.replace(/_/g, ' ');
  // Insert a space before each uppercase letter that follows a
  // lowercase letter, and around digit runs. The lookbehinds keep the
  // operation idempotent on already-spaced strings.
  s = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

/** Inverse of `humanizeAssetId` for the rename input — strip every
 *  whitespace run so a typed `"Bench Tier 2"` writes the disk id
 *  `BenchTier2`. The `renameAsset` pipeline then re-applies the
 *  per-class prefix/suffix to land on the full `FD_BenchTier2_CS`. */
export function unhumanizeAssetId(s: string): string {
  return s.replace(/\s+/g, '');
}

/** Property names that aren't meaningful for crafting/balance design. The
 *  Definitions editor hides these by default; a "Show all fields" toggle
 *  reveals them. Keep the rules narrow — anything that genuinely affects
 *  gameplay (drops, recipes, stats, prices) MUST stay visible. */
const HIDDEN_EXACT = new Set([
  'casts_shadow',
  'is_pingable',
  'restitution',
  'destruction_impulse_strength',
  'has_static_audio',
  'has_durability_widget',
  'has_world_space_widget',
  'has_progress_bar_widget',
]);
const HIDDEN_PREFIXES = ['interaction_', 'drag_', 'release_'];
const HIDDEN_SUBSTRINGS = ['widget'];

export function isNoisyProperty(name: string): boolean {
  if (HIDDEN_EXACT.has(name)) return true;
  for (const p of HIDDEN_PREFIXES) if (name.startsWith(p)) return true;
  for (const s of HIDDEN_SUBSTRINGS) if (name.includes(s)) return true;
  return false;
}
