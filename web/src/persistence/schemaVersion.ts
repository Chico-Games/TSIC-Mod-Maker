import type { ProjectMeta } from '../store/definitionsStore';

export const SUPPORTED_VERSION = 1;

export function isSupported(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= SUPPORTED_VERSION;
}

export function isFuture(v: number): boolean {
  return Number.isInteger(v) && v > SUPPORTED_VERSION;
}

export type ParseResult =
  | { ok: true; meta: ProjectMeta }
  | { ok: false; reason: 'malformed' | 'no-version' };

export function parseMeta(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' };
  }
  const r = raw as Record<string, unknown>;
  if (!('schema_version' in r) || typeof r.schema_version !== 'number') {
    return { ok: false, reason: 'no-version' };
  }
  if (typeof r.name !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, meta: raw as ProjectMeta };
}
