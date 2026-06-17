import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLastOpened,
  setLastOpenedStarter,
  setLastOpenedFsa,
  clearLastOpened,
} from '../src/persistence/lastOpenedProject';

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

test('lastOpenedProject round-trips starter and fsa markers', () => {
  (globalThis as any).localStorage = new FakeStorage();

  // Nothing recorded yet → null, which bootstrap treats as "first launch".
  assert.equal(getLastOpened(), null);

  setLastOpenedStarter();
  assert.deepEqual(getLastOpened(), { kind: 'starter' });

  // Opening a folder overrides the starter marker.
  setLastOpenedFsa('MyProject');
  assert.deepEqual(getLastOpened(), { kind: 'fsa', name: 'MyProject' });

  // Re-opening the starter overrides again — most recent wins.
  setLastOpenedStarter();
  assert.deepEqual(getLastOpened(), { kind: 'starter' });

  clearLastOpened();
  assert.equal(getLastOpened(), null);
});

test('getLastOpened tolerates malformed storage', () => {
  (globalThis as any).localStorage = new FakeStorage();
  localStorage.setItem('tsic.last-opened.v1', 'not json');
  assert.equal(getLastOpened(), null);
  localStorage.setItem('tsic.last-opened.v1', JSON.stringify({ kind: 'fsa' })); // missing name
  assert.equal(getLastOpened(), null);
  localStorage.setItem('tsic.last-opened.v1', JSON.stringify({ kind: 'bogus' }));
  assert.equal(getLastOpened(), null);
});
