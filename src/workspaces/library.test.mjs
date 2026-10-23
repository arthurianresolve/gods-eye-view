import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { createWorkspaceStorage } from '../storage/index.js';
import { createWorkspaceLibrary } from './library.js';

const bytes = new Uint8Array([10, 20, 30]);
const digest = createHash('sha256').update(bytes).digest('hex');
function snapshot(overrides = {}) {
  return {
    title: 'North Pacific investigation',
    view: {
      camera: { lat: 35, lon: 145, altitude_m: 200_000 },
      layers: ['flights'],
      temporal: {
        source: 'provider-history',
        targetMs: 1000,
        recordingId: null,
      },
    },
    filters: { callsign: 'TEST' },
    annotations: [{ type: 'pin', target: 'Tokyo' }],
    pinnedEvidence: [],
    assetRefs: [{ id: 'asset-one', sha256: digest, byteLength: bytes.length }],
    directorProjectRef: 'director-project-v1',
    chunks: { notes: [{ id: 'note-one' }] },
    assets: { 'asset-one': bytes },
    ...overrides,
  };
}

function fixture() {
  const storage = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
  });
  let nextId = 0;
  const library = createWorkspaceLibrary({
    storage,
    crypto: webcrypto,
    now: (() => {
      let time = 10_000;
      return () => time++;
    })(),
    makeId: () => `investigation-${++nextId}`,
  });
  return { storage, library };
}

test('workspace library creates, lists, revises, duplicates and deletes with optimistic revisions', async (t) => {
  const { storage, library } = fixture();
  t.after(() => storage.destroy());
  const first = await library.save(snapshot());
  assert.equal(first.document.id, 'investigation-1');
  assert.equal(first.document.revision, 1);
  assert.equal(first.document.temporalSource, 'provider-history');
  assert.equal(first.saved, false, 'memory fallback remains clearly unsaved');

  const updated = await library.save(
    snapshot({ view: { camera: { lat: 36, lon: 146 } } }),
    { id: first.document.id, expectedRevision: 1 },
  );
  assert.equal(updated.document.revision, 2);
  assert.equal(updated.document.title, 'North Pacific investigation');
  assert.equal(updated.document.view.camera.lat, 36);
  assert.deepEqual(
    (await library.history(first.document.id)).map((row) => row.revision),
    [1],
  );
  await assert.rejects(
    library.save(snapshot(), { id: first.document.id, expectedRevision: 1 }),
    { code: 'revision-conflict' },
  );

  const recovered = await library.recover(first.document.id, 1, {
    expectedRevision: 2,
  });
  assert.equal(recovered.document.revision, 3);
  assert.equal(recovered.document.view.camera.lat, 35);
  const duplicate = await library.duplicate(first.document.id);
  assert.equal(duplicate.document.id, 'investigation-2');
  assert.equal(duplicate.document.title, 'North Pacific investigation copy');
  assert.deepEqual(
    (await storage.getWorkspace(duplicate.document.id)).chunks.notes,
    [{ id: 'note-one' }],
  );
  assert.equal(
    await library.remove(first.document.id, { expectedRevision: 3 }),
    true,
  );
  assert.deepEqual(
    (await library.list()).map((row) => row.id),
    ['investigation-2'],
  );
});

test('workspace bundles export and import verified bytes into a new identity', async (t) => {
  const { storage, library } = fixture();
  t.after(() => storage.destroy());
  const saved = await library.save(snapshot());
  const backup = await library.exportBackup(saved.document.id);
  const parsed = JSON.parse(backup);
  assert.equal(parsed.format, 'gev-workspace-bundle');
  assert.equal(parsed.assets.length, 1);
  const imported = await library.importBackup(backup, {
    title: 'Recovered case',
  });
  assert.equal(imported.document.id, 'investigation-2');
  assert.equal(imported.document.title, 'Recovered case');
  assert.deepEqual(
    [...(await storage.getWorkspace(imported.document.id)).assets['asset-one']],
    [...bytes],
  );

  parsed.assets[0].base64 = 'AAAA';
  await assert.rejects(library.importBackup(JSON.stringify(parsed)), {
    code: 'integrity',
  });
  assert.equal(
    (await library.list()).length,
    2,
    'corrupt imports do not write a workspace',
  );
});

test('imported workspace backup rejects future formats and missing referenced assets', async (t) => {
  const { storage, library } = fixture();
  t.after(() => storage.destroy());
  const backup = JSON.parse(
    await library.exportBackup((await library.save(snapshot())).document.id),
  );
  assert.equal(backup.format, 'gev-workspace-bundle');
  backup.assets = [];
  await assert.rejects(library.importBackup(JSON.stringify(backup)), {
    code: 'integrity',
  });
  backup.version = 99;
  await assert.rejects(library.importBackup(JSON.stringify(backup)), {
    code: 'unsupported-version',
  });
});
