import type { ModioEnv } from './types';

export interface ModioConfig {
  gameId: number;
  apiKey: string;
  env: ModioEnv;
  baseUrl: string;
}

function parseEnv(raw: string | undefined): ModioEnv {
  return raw === 'test' ? 'test' : 'live';
}

function baseUrlFor(gameId: number, env: ModioEnv): string {
  // Use the per-game subdomain — recommended by mod.io and what the
  // upload-to-modio reference script targets.
  return env === 'test'
    ? `https://g-${gameId}.test.mod.io/v1`
    : `https://g-${gameId}.modapi.io/v1`;
}

/** Read config from Vite env. Returns null when either credential is missing
 *  (so the UI can disable mod.io features instead of crashing). */
export function loadModioConfig(): ModioConfig | null {
  // import.meta.env is injected by Vite at build time.
  const env = (import.meta as any).env ?? {};
  const idRaw = String(env.VITE_MODIO_GAME_ID ?? '').trim();
  const apiKey = String(env.VITE_MODIO_API_KEY ?? '').trim();
  const envName = parseEnv(String(env.VITE_MODIO_ENV ?? '').trim() || undefined);
  if (!idRaw || !apiKey) return null;
  const gameId = Number(idRaw);
  if (!Number.isFinite(gameId) || gameId <= 0) return null;
  return { gameId, apiKey, env: envName, baseUrl: baseUrlFor(gameId, envName) };
}

/** Same as `loadModioConfig` but accepts an explicit env block — used in tests. */
export function configFromEnv(env: Record<string, string | undefined>): ModioConfig | null {
  const idRaw = String(env.VITE_MODIO_GAME_ID ?? '').trim();
  const apiKey = String(env.VITE_MODIO_API_KEY ?? '').trim();
  const envName = parseEnv(env.VITE_MODIO_ENV);
  if (!idRaw || !apiKey) return null;
  const gameId = Number(idRaw);
  if (!Number.isFinite(gameId) || gameId <= 0) return null;
  return { gameId, apiKey, env: envName, baseUrl: baseUrlFor(gameId, envName) };
}

export function switchEnv(cfg: ModioConfig, env: ModioEnv): ModioConfig {
  return { ...cfg, env, baseUrl: baseUrlFor(cfg.gameId, env) };
}
