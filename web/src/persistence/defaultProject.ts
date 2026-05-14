export interface DefaultProjectMeta {
  schema_version: number;
  version: number;
  label: string;
  published_at: string;
}

export type ParseMetaResult =
  | { ok: true; meta: DefaultProjectMeta }
  | { ok: false; reason: 'malformed' | 'bad-version' };

export function parseDefaultProjectMeta(raw: unknown): ParseMetaResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  const sv = r.schema_version;
  const v = r.version;
  if (typeof sv !== 'number' || !Number.isInteger(sv)) return { ok: false, reason: 'bad-version' };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { ok: false, reason: 'bad-version' };
  const label = typeof r.label === 'string' ? r.label : '';
  const published_at = typeof r.published_at === 'string' ? r.published_at : new Date(0).toISOString();
  return { ok: true, meta: { schema_version: sv, version: v, label, published_at } };
}
