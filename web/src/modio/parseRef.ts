// Parse anything-the-user-might-paste into a structured mod.io reference.
//
// Accepts:
//   - Numeric mod ID: "12345"
//   - Bare name_id slug: "my-cool-mod" (lowercase letters, digits, hyphens)
//   - Full profile URL: https://mod.io/g/<game-slug>/m/<mod-slug>
//   - ID redirect URL: https://mod.io/search/mods/<id>  (or http://, no scheme)
//   - URLs with trailing path/query — tolerated
//
// Verified mod.io URL forms via docs:
//   profile_url = https://mod.io/g/<game-name_id>/m/<mod-name_id>
//   https://docs.mod.io/restapi/search-by-id  (search/mods/<id>)

export type ModioRef =
  | { kind: 'id'; modId: number }
  | { kind: 'slug'; modSlug: string }
  | { kind: 'url'; gameSlug: string; modSlug: string };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export function parseModioRef(input: string): ModioRef | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // Pure numeric → mod id
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return { kind: 'id', modId: n };
    return null;
  }

  // Looks like a URL? Either scheme prefix or contains "mod.io/".
  if (/^https?:\/\//i.test(raw) || /\bmod\.io\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    // strip leading and trailing slashes, split path
    const parts = url.pathname.split('/').filter(Boolean);
    // /g/<game>/m/<mod>[/...]
    const gIdx = parts.indexOf('g');
    const mIdx = parts.indexOf('m');
    if (gIdx >= 0 && mIdx === gIdx + 2 && parts[gIdx + 1] && parts[mIdx + 1]) {
      const gameSlug = parts[gIdx + 1].toLowerCase();
      const modSlug = parts[mIdx + 1].toLowerCase();
      if (SLUG_RE.test(gameSlug) && SLUG_RE.test(modSlug)) {
        return { kind: 'url', gameSlug, modSlug };
      }
    }
    // /search/mods/<id>
    const sIdx = parts.indexOf('search');
    if (sIdx >= 0 && parts[sIdx + 1] === 'mods' && parts[sIdx + 2] && /^\d+$/.test(parts[sIdx + 2])) {
      return { kind: 'id', modId: Number(parts[sIdx + 2]) };
    }
    // /m/<mod>
    if (parts[0] === 'm' && parts[1] && SLUG_RE.test(parts[1].toLowerCase())) {
      return { kind: 'slug', modSlug: parts[1].toLowerCase() };
    }
    return null;
  }

  // Bare slug
  const lower = raw.toLowerCase();
  if (SLUG_RE.test(lower)) return { kind: 'slug', modSlug: lower };
  return null;
}
