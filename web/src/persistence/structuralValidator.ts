export type StructuralIssue =
  | { kind: 'invalid-json'; folder: string; file: string; error: string }
  | { kind: 'missing-field'; folder: string; file: string; field: 'id' | 'asset_path' | 'class' }
  | { kind: 'id-mismatch'; folder: string; file: string; json_id: string; file_id: string };

interface InputFile {
  folder: string;
  name: string;
  text: string;
}

export function validateBatch(files: InputFile[]): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.text);
    } catch (e) {
      issues.push({ kind: 'invalid-json', folder: f.folder, file: f.name, error: String(e) });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push({
        kind: 'invalid-json',
        folder: f.folder,
        file: f.name,
        error: 'top-level is not an object',
      });
      continue;
    }
    const r = parsed as Record<string, unknown>;
    // `id` and `class` are required. `asset_path` is OPTIONAL: some definition
    // packs ship hand-authored, data-only defs (e.g. hotkey/input/situation)
    // that have no backing .uasset and therefore no asset_path. The editor
    // synthesizes `/Game/Definitions/{folder}/{id}` on save when it's absent,
    // so a missing asset_path must not block loading.
    for (const field of ['id', 'class'] as const) {
      if (typeof r[field] !== 'string' || !r[field]) {
        issues.push({ kind: 'missing-field', folder: f.folder, file: f.name, field });
      }
    }
    if (typeof r.id === 'string' && r.id) {
      const fileId = f.name.replace(/\.json$/i, '');
      if (r.id !== fileId) {
        issues.push({
          kind: 'id-mismatch',
          folder: f.folder,
          file: f.name,
          json_id: r.id,
          file_id: fileId,
        });
      }
    }
  }
  return issues;
}

/** Convenience: returns the set of "folder/file" keys that have a blocking
 *  issue (invalid-json or missing-field). id-mismatch is non-blocking — the
 *  record still loads, it's just flagged. */
export function blockingKeys(issues: StructuralIssue[]): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.kind === 'invalid-json' || i.kind === 'missing-field') {
      out.add(`${i.folder}/${i.file}`);
    }
  }
  return out;
}
