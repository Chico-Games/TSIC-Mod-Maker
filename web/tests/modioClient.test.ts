import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/modio/client';
import { ModioError } from '../src/modio/errors';
import { configFromEnv } from '../src/modio/config';

function makeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return ((req: any) => Promise.resolve(handler(req))) as any;
}

const cfg = configFromEnv({ VITE_MODIO_GAME_ID: '1', VITE_MODIO_API_KEY: 'KEY', VITE_MODIO_ENV: 'live' })!;

test('client.get: uses api_key when no token', async () => {
  const seen: string[] = [];
  const c = createClient(cfg, () => null, {
    fetcher: makeFetch((req) => {
      seen.push(req.url);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  });
  await c.get('/ping');
  const url = new URL(seen[0]);
  assert.equal(url.searchParams.get('api_key'), 'KEY');
});

test('client.get: uses Bearer when token is set and auth: true', async () => {
  let seenAuth: string | null = null;
  let seenUrl = '';
  const c = createClient(cfg, () => 'TOK', {
    fetcher: makeFetch((req) => {
      seenAuth = req.headers.get('authorization');
      seenUrl = req.url;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  });
  await c.get('/me');
  assert.equal(seenAuth, 'Bearer TOK');
  assert.ok(!new URL(seenUrl).searchParams.has('api_key'));
});

test('client.post: form-encoded body + retry on 429', async () => {
  let attempt = 0;
  const c = createClient(cfg, () => 'TOK', {
    fetcher: makeFetch(async (req) => {
      attempt++;
      if (attempt === 1) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      }
      const body = await req.text();
      assert.equal(req.headers.get('content-type'), 'application/x-www-form-urlencoded');
      assert.match(body, /foo=bar/);
      return new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  });
  const r = await c.post<{ id: number }>('/x', { foo: 'bar' });
  assert.equal(r.id, 1);
  assert.equal(attempt, 2);
});

test('client.get: throws ModioError on 4xx with envelope', async () => {
  const c = createClient(cfg, () => null, {
    fetcher: makeFetch(() => new Response(JSON.stringify({
      error: { code: 422, error_ref: 13009, message: 'Validation Failed', errors: { name: 'too short' } },
    }), { status: 422, headers: { 'content-type': 'application/json' } })),
  });
  await assert.rejects(c.get('/x'), (e: unknown) => {
    if (!(e instanceof ModioError)) return false;
    assert.equal(e.http, 422);
    assert.equal(e.errorRef, 13009);
    assert.equal(e.fieldErrors?.name, 'too short');
    return true;
  });
});

test('client.post: refuses to send without token when auth required', async () => {
  const c = createClient(cfg, () => null, {
    fetcher: makeFetch(() => new Response('{}', { status: 200 })),
  });
  await assert.rejects(c.post('/x', { a: '1' }), (e: unknown) => e instanceof ModioError && (e as ModioError).errorRef === 11005);
});
