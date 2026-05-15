import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublish } from '../src/modio/validation';
import { emptySidecar } from '../src/modio/sidecar';
import type { PackedMod } from '../src/modio/packer';

function pack(files: Array<{ folder: string; id: string; md5: string; size: number }>): PackedMod {
  return {
    blob: new Blob([]),
    md5: 'abc',
    size: 0,
    files,
    added: files,
    modified: [],
    unchangedCount: 0,
    manifestJson: '{}',
  };
}

test('validatePublish: new mod with no logo errors', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Cool mod';
  sc.draft.summary = 'Some summary here that is long enough to skip the warning.';
  const issues = validatePublish({ sidecar: sc, isNew: true });
  assert.ok(issues.find((i) => i.field === 'logo' && i.severity === 'error'));
});

test('validatePublish: missing name + summary errors', () => {
  const sc = emptySidecar();
  const issues = validatePublish({ sidecar: sc, isNew: false });
  assert.ok(issues.find((i) => i.field === 'name' && i.severity === 'error'));
  assert.ok(issues.find((i) => i.field === 'summary' && i.severity === 'error'));
});

test('validatePublish: name >80 chars errors', () => {
  const sc = emptySidecar();
  sc.draft.name = 'x'.repeat(81);
  sc.draft.summary = 'summary that is long enough to not warn about being short';
  const issues = validatePublish({ sidecar: sc, isNew: false });
  assert.ok(issues.find((i) => i.field === 'name' && i.severity === 'error'));
});

test('validatePublish: summary <20 chars warns (not errors)', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'too short';
  const issues = validatePublish({ sidecar: sc, isNew: false });
  const s = issues.find((i) => i.field === 'summary');
  assert.ok(s);
  assert.equal(s!.severity, 'warning');
});

test('validatePublish: no tags warns', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'A long enough summary to skip the short-summary warning.';
  const issues = validatePublish({ sidecar: sc, isNew: false });
  assert.ok(issues.find((i) => i.field === 'tags' && i.severity === 'warning'));
});

test('validatePublish: pushing modfile with no pack errors', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'A long enough summary to skip the short-summary warning.';
  sc.draft.tags = ['Gameplay'];
  const issues = validatePublish({ sidecar: sc, isNew: false, willPushModfile: true, pendingVersion: '0.1.0' });
  assert.ok(issues.find((i) => i.field === 'modfile' && i.severity === 'error'));
});

test('validatePublish: pushing modfile with empty delta errors', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'A long enough summary to skip the short-summary warning.';
  sc.draft.tags = ['Gameplay'];
  const issues = validatePublish({
    sidecar: sc, isNew: false, willPushModfile: true, pendingVersion: '0.1.0',
    lastPack: pack([]),
  });
  assert.ok(issues.find((i) => i.field === 'modfile' && i.severity === 'error'));
});

test('validatePublish: missing version errors', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'A long enough summary to skip the short-summary warning.';
  sc.draft.tags = ['Gameplay'];
  const issues = validatePublish({
    sidecar: sc, isNew: false, willPushModfile: true, pendingVersion: '',
    lastPack: pack([{ folder: 'a', id: 'b', md5: 'x', size: 1 }]),
  });
  assert.ok(issues.find((i) => i.field === 'version' && i.severity === 'error'));
});

test('validatePublish: non-semver version warns (not errors)', () => {
  const sc = emptySidecar();
  sc.draft.name = 'Mod';
  sc.draft.summary = 'A long enough summary to skip the short-summary warning.';
  sc.draft.tags = ['Gameplay'];
  const issues = validatePublish({
    sidecar: sc, isNew: false, willPushModfile: true, pendingVersion: 'banana',
    lastPack: pack([{ folder: 'a', id: 'b', md5: 'x', size: 1 }]),
  });
  const v = issues.find((i) => i.field === 'version');
  assert.ok(v);
  assert.equal(v!.severity, 'warning');
});

test('validatePublish: clean inputs return no issues', () => {
  const sc = emptySidecar();
  sc.draft.name = 'My Mod';
  sc.draft.summary = 'This is a long enough summary that no warnings will fire.';
  sc.draft.tags = ['Gameplay'];
  sc.draft.logo_path = '.modio/logo.png';
  const issues = validatePublish({
    sidecar: sc, isNew: false, willPushModfile: true, pendingVersion: '0.1.0',
    lastPack: pack([{ folder: 'a', id: 'b', md5: 'x', size: 1 }]),
  });
  assert.deepEqual(issues, []);
});
