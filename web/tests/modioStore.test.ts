import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _deriveSyncState, bumpVersion } from '../src/store/modIoStore';
import type { ModioMod, ModioSidecar } from '../src/modio/types';
import type { PackedMod } from '../src/modio/packer';

function sidecar(p: Partial<ModioSidecar>): ModioSidecar {
  return {
    schema_version: 1,
    env: 'live',
    mod_id: null,
    name_id: null,
    draft: { name: '', summary: '', description_md: null, tags: [], logo_path: null, visible: 0, next_version: '0.1.0' },
    last_pushed: null,
    ...p,
  };
}
function mod(md5: string): ModioMod {
  return {
    id: 1, game_id: 1, status: 1, visible: 1, date_added: 0, date_updated: 0, date_live: 0,
    logo: { filename: '', original: '' }, name: 'm', name_id: 'm', summary: '', description: null, description_plaintext: null,
    profile_url: '', media: { youtube: [], sketchfab: [], images: [] }, tags: [],
    modfile: { id: 1, mod_id: 1, date_added: 0, date_scanned: 0, virus_status: 1, virus_positive: 0, filesize: 0, filename: 'x', version: '', changelog: '', filehash: { md5 }, download: null },
  };
}
function pack(md5: string): PackedMod {
  return { blob: new Blob([]), md5, size: 0, files: [], added: [], modified: [], unchangedCount: 0, manifestJson: '{}' };
}

test('syncState: unbound when no mod_id', () => {
  assert.equal(_deriveSyncState({ sidecar: sidecar({}), remoteMod: null, lastPack: null }), 'unbound');
});

test('syncState: unknown when no pack yet', () => {
  assert.equal(_deriveSyncState({
    sidecar: sidecar({ mod_id: 1, last_pushed: { modfile_id: 1, md5: 'A', size: 0, version: null, date: 0 } }),
    remoteMod: mod('A'),
    lastPack: null,
  }), 'unknown');
});

test('syncState: clean when all match', () => {
  assert.equal(_deriveSyncState({
    sidecar: sidecar({ mod_id: 1, last_pushed: { modfile_id: 1, md5: 'A', size: 0, version: null, date: 0 } }),
    remoteMod: mod('A'),
    lastPack: pack('A'),
  }), 'clean');
});

test('syncState: local-newer when only local diverges', () => {
  assert.equal(_deriveSyncState({
    sidecar: sidecar({ mod_id: 1, last_pushed: { modfile_id: 1, md5: 'A', size: 0, version: null, date: 0 } }),
    remoteMod: mod('A'),
    lastPack: pack('B'),
  }), 'local-newer');
});

test('syncState: remote-newer when only remote diverges', () => {
  assert.equal(_deriveSyncState({
    sidecar: sidecar({ mod_id: 1, last_pushed: { modfile_id: 1, md5: 'A', size: 0, version: null, date: 0 } }),
    remoteMod: mod('C'),
    lastPack: pack('A'),
  }), 'remote-newer');
});

test('syncState: diverged when both differ', () => {
  assert.equal(_deriveSyncState({
    sidecar: sidecar({ mod_id: 1, last_pushed: { modfile_id: 1, md5: 'A', size: 0, version: null, date: 0 } }),
    remoteMod: mod('C'),
    lastPack: pack('B'),
  }), 'diverged');
});

test('bumpVersion: increments patch', () => {
  assert.equal(bumpVersion('0.1.0'), '0.1.1');
  assert.equal(bumpVersion('1.2.99'), '1.2.100');
  assert.equal(bumpVersion('weird'), 'weird.1');
});
