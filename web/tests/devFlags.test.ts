import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getShowDeveloperActions, setShowDeveloperActions } from '../src/persistence/devFlags';

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

test('devFlags persist via localStorage', () => {
  (globalThis as any).localStorage = new FakeStorage();
  assert.equal(getShowDeveloperActions(), false);
  setShowDeveloperActions(true);
  assert.equal(getShowDeveloperActions(), true);
  setShowDeveloperActions(false);
  assert.equal(getShowDeveloperActions(), false);
});
