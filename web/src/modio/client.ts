import type { ModioConfig } from './config';
import type { ModioErrorEnvelope } from './types';
import { ModioError } from './errors';

export type TokenGetter = () => string | null;

export interface ModioClientOptions {
  /** Override the global fetch (used by tests). */
  fetcher?: typeof fetch;
  /** X-Modio-Platform header. Defaults to 'windows'. */
  platform?: string;
  /** X-Modio-Portal header. Defaults to 'itchio'. */
  portal?: string;
}

export interface ModioClient {
  readonly cfg: ModioConfig;
  /** GET with optional query params. When `auth: false` always uses
   *  `?api_key`; when `auth: true` (default) attaches Bearer if a token is
   *  available, else falls back to api_key. */
  get<T>(path: string, opts?: GetOpts): Promise<T>;
  /** POST a form-urlencoded body. */
  post<T>(path: string, body: Record<string, string | number | boolean> | Array<[string, string | number | boolean]>, opts?: WriteOpts): Promise<T>;
  /** PUT a form-urlencoded body. mod.io's "edit modfile" endpoint uses PUT. */
  put<T>(path: string, body: Record<string, string | number | boolean> | Array<[string, string | number | boolean]>, opts?: WriteOpts): Promise<T>;
  /** POST a multipart/form-data body (files + fields). */
  postMultipart<T>(path: string, form: FormData, opts?: WriteOpts): Promise<T>;
  /** DELETE — mod.io requires a Content-Type header (or it returns 415).
   *  Optional `body` is form-encoded; useful for endpoints that take a
   *  dependencies[] list to remove. */
  delete<T = void>(path: string, opts?: WriteOpts & { body?: Record<string, string | number | boolean> | Array<[string, string | number | boolean]> }): Promise<T>;
}

export interface GetOpts {
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export interface WriteOpts {
  /** Auth is REQUIRED for writes — defaults true and we throw if there's no
   *  token. Pass `auth: false` to use `?api_key` (only valid for /oauth/* endpoints). */
  auth?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_PLATFORM = 'windows';
const DEFAULT_PORTAL = 'itchio';

export function createClient(
  cfg: ModioConfig,
  getToken: TokenGetter,
  opts: ModioClientOptions = {},
): ModioClient {
  const fetcher = opts.fetcher ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (() => { throw new Error('no fetch'); }) as any);
  const platform = opts.platform ?? DEFAULT_PLATFORM;
  const portal = opts.portal ?? DEFAULT_PORTAL;

  function buildUrl(path: string, query?: GetOpts['query'], useApiKey?: boolean): string {
    const url = new URL(cfg.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    if (useApiKey) url.searchParams.set('api_key', cfg.apiKey);
    return url.toString();
  }

  function authHeaders(useToken: boolean): HeadersInit {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'X-Modio-Platform': platform,
      'X-Modio-Portal': portal,
    };
    if (useToken) {
      const t = getToken();
      if (t) h['Authorization'] = `Bearer ${t}`;
    }
    return h;
  }

  async function send<T>(req: Request): Promise<T> {
    let attempts = 0;
    for (;;) {
      attempts++;
      const resp = await fetcher(req);
      if (resp.status === 429 && attempts === 1) {
        const ra = Number(resp.headers.get('retry-after') ?? '0');
        const ms = Math.max(0, Math.min(60, ra)) * 1000;
        await new Promise((r) => setTimeout(r, ms));
        continue;
      }
      if (resp.ok) {
        if (resp.status === 204) return undefined as unknown as T;
        const ct = resp.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) return (await resp.json()) as T;
        return (await resp.text()) as unknown as T;
      }
      let envelope: ModioErrorEnvelope | null = null;
      try { envelope = await resp.json(); } catch { /* non-JSON 4xx */ }
      const ref = envelope?.error?.error_ref ?? (Number(resp.headers.get('x-modio-error-ref')) || undefined);
      const reqId = resp.headers.get('x-modio-request-id') ?? undefined;
      const message = envelope?.error?.message ?? `HTTP ${resp.status}`;
      throw new ModioError(resp.status, ref, message, envelope?.error?.errors, reqId);
    }
  }

  function encodeForm(body: Record<string, string | number | boolean> | Array<[string, string | number | boolean]>): string {
    const params = new URLSearchParams();
    const entries = Array.isArray(body) ? body : Object.entries(body);
    for (const [k, v] of entries) {
      params.append(k, String(v));
    }
    return params.toString();
  }

  return {
    cfg,
    async get<T>(path: string, opts: GetOpts = {}): Promise<T> {
      const useToken = opts.auth !== false;
      const token = getToken();
      const useApiKey = !useToken || !token;
      const url = buildUrl(path, opts.query, useApiKey);
      const req = new Request(url, {
        method: 'GET',
        headers: authHeaders(useToken && !!token),
        signal: opts.signal,
      });
      return send<T>(req);
    },
    async post<T>(path: string, body: Record<string, string | number | boolean> | Array<[string, string | number | boolean]>, opts: WriteOpts = {}): Promise<T> {
      const useToken = opts.auth !== false;
      const token = getToken();
      // For non-oauth writes a token is required; fail fast with a clear error
      // so callers don't see a confusing 401 from the server.
      if (useToken && !token) {
        throw new ModioError(0, 11005, 'Not signed in to mod.io.');
      }
      const useApiKey = !useToken; // e.g. /oauth/* uses api_key in the body, but we send it via query
      const url = buildUrl(path, undefined, useApiKey);
      const headers = {
        ...authHeaders(useToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      } as Record<string, string>;
      const req = new Request(url, {
        method: 'POST',
        headers,
        body: encodeForm(body),
        signal: opts.signal,
      });
      return send<T>(req);
    },
    async put<T>(path: string, body: Record<string, string | number | boolean> | Array<[string, string | number | boolean]>, opts: WriteOpts = {}): Promise<T> {
      const useToken = opts.auth !== false;
      const token = getToken();
      if (useToken && !token) {
        throw new ModioError(0, 11005, 'Not signed in to mod.io.');
      }
      const url = buildUrl(path);
      const headers = {
        ...authHeaders(useToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      } as Record<string, string>;
      const req = new Request(url, {
        method: 'PUT',
        headers,
        body: encodeForm(body),
        signal: opts.signal,
      });
      return send<T>(req);
    },
    async postMultipart<T>(path: string, form: FormData, opts: WriteOpts = {}): Promise<T> {
      const useToken = opts.auth !== false;
      const token = getToken();
      if (useToken && !token) {
        throw new ModioError(0, 11005, 'Not signed in to mod.io.');
      }
      const url = buildUrl(path);
      const req = new Request(url, {
        method: 'POST',
        headers: authHeaders(useToken),
        body: form,
        signal: opts.signal,
      });
      return send<T>(req);
    },
    async delete<T>(path: string, opts: WriteOpts & { body?: Record<string, string | number | boolean> | Array<[string, string | number | boolean]> } = {}): Promise<T> {
      const useToken = opts.auth !== false;
      const token = getToken();
      if (useToken && !token) {
        throw new ModioError(0, 11005, 'Not signed in to mod.io.');
      }
      const url = buildUrl(path);
      const headers = {
        ...authHeaders(useToken),
        // mod.io returns 415 for DELETE without a Content-Type header even
        // when the body is empty.
        'Content-Type': 'application/x-www-form-urlencoded',
      } as Record<string, string>;
      let body = '';
      if (opts.body) {
        const params = new URLSearchParams();
        const entries = Array.isArray(opts.body) ? opts.body : Object.entries(opts.body);
        for (const [k, v] of entries) params.append(k, String(v));
        body = params.toString();
      }
      const req = new Request(url, {
        method: 'DELETE',
        headers,
        body,
        signal: opts.signal,
      });
      return send<T>(req);
    },
  };
}
