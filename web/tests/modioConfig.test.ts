import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFromEnv, switchEnv } from '../src/modio/config';

test('configFromEnv: builds live base URL from numeric game id', () => {
  const cfg = configFromEnv({ VITE_MODIO_GAME_ID: '13031', VITE_MODIO_API_KEY: 'abc', VITE_MODIO_ENV: 'live' });
  assert.ok(cfg);
  assert.equal(cfg!.gameId, 13031);
  assert.equal(cfg!.apiKey, 'abc');
  assert.equal(cfg!.env, 'live');
  assert.equal(cfg!.baseUrl, 'https://g-13031.modapi.io/v1');
});

test('configFromEnv: builds test base URL when env=test', () => {
  const cfg = configFromEnv({ VITE_MODIO_GAME_ID: '7', VITE_MODIO_API_KEY: 'k', VITE_MODIO_ENV: 'test' });
  assert.equal(cfg!.baseUrl, 'https://g-7.test.mod.io/v1');
});

test('configFromEnv: returns null on missing credentials', () => {
  assert.equal(configFromEnv({}), null);
  assert.equal(configFromEnv({ VITE_MODIO_GAME_ID: '1' }), null);
  assert.equal(configFromEnv({ VITE_MODIO_API_KEY: 'k' }), null);
  assert.equal(configFromEnv({ VITE_MODIO_GAME_ID: '0', VITE_MODIO_API_KEY: 'k' }), null);
  assert.equal(configFromEnv({ VITE_MODIO_GAME_ID: 'NaN', VITE_MODIO_API_KEY: 'k' }), null);
});

test('switchEnv: updates base URL', () => {
  const cfg = configFromEnv({ VITE_MODIO_GAME_ID: '1', VITE_MODIO_API_KEY: 'k', VITE_MODIO_ENV: 'live' })!;
  const t = switchEnv(cfg, 'test');
  assert.equal(t.env, 'test');
  assert.equal(t.baseUrl, 'https://g-1.test.mod.io/v1');
});
