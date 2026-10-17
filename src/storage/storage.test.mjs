import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  WorkspaceRevisionConflict,
  WorkspaceStorageError,
  createWorkspaceStorage,
} from './index.js';

const fixture = () => {
  let now = 100;
  const storage = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
    now: () => now++,
  });
  return storage;
};

test('memory fallback is labeled unsaved and enforces revision-checked commits', async (t) => {
  const storage = fixture();
  t.after(() => storage.destroy());
  assert.deepEqual(storage.getAvailability(), {
    mode: 'memory',
    savedByBrowser: false,
    message:
      'Workspace changes are in memory and will be lost when the app closes.',
  });
  await assert.rejects(
    storage.commitWorkspace({ id: 'case-1', document: { title: 'Case' } }),
    { code: 'revision-required' },
  );

  const first = await storage.commitWorkspace({
    id: 'case-1',
    expectedRevision: 0,
    document: { title: 'Case', version: 1 },
    chunks: { observations: [{ id: 'flight-a', timeMs: 1000 }] },
    assets: { thumbnail: new Uint8Array([1, 2, 3]) },
  });
  assert.equal(first.revision, 1);
  assert.equal(first.saved, false);
  const loaded = await storage.getWorkspace('case-1');
  assert.deepEqual(loaded.chunks.observations, [
    { id: 'flight-a', timeMs: 1000 },
  ]);
  assert.deepEqual([...loaded.assets.thumbnail], [1, 2, 3]);

  const second = await storage.commitWorkspace({
    id: 'case-1',
    expectedRevision: 1,
    document: { title: 'Case', version: 2 },
    chunks: { observations: [{ id: 'flight-b', timeMs: 2000 }] },
  });
  assert.equal(second.revision, 2);
  assert.equal(
    (await storage.getWorkspace('case-1', { revision: 1 })).document.version,
    1,
  );
  await assert.rejects(
    storage.commitWorkspace({
      id: 'case-1',
      expectedRevision: 1,
      document: { title: 'Stale tab' },
    }),
    (error) =>
      error instanceof WorkspaceRevisionConflict && error.actualRevision === 2,
  );
});

test('migration keeps the previous revision readable and returns its pre-migration export', async (t) => {
  const storage = fixture();
  t.after(() => storage.destroy());
  await storage.commitWorkspace({
    id: 'migration-case',
    expectedRevision: 0,
    document: { title: 'Migration', schemaVersion: 1 },
    chunks: { rows: [{ id: 'one' }] },
  });
  const result = await storage.migrateWorkspace(
    'migration-case',
    ({ document, chunks }) => ({
      document: { ...document, schemaVersion: 2 },
      chunks: { ...chunks, migrated: [{ id: 'one', schemaVersion: 2 }] },
    }),
    { expectedRevision: 1 },
  );
  assert.equal(result.before.document.schemaVersion, 1);
  assert.equal(result.after.revision, 2);
  assert.equal(
    (await storage.getWorkspace('migration-case')).document.schemaVersion,
    2,
  );
  assert.equal(
    (await storage.getWorkspace('migration-case', { revision: 1 })).document
      .schemaVersion,
    1,
  );
});

test('pinned workspaces cannot be deleted, and pin writes still check revisions', async (t) => {
  const storage = fixture();
  t.after(() => storage.destroy());
  const saved = await storage.commitWorkspace({
    id: 'pinned-case',
    expectedRevision: 0,
    document: { title: 'Pinned' },
  });
  const pinned = await storage.pinWorkspace('pinned-case', true, {
    expectedRevision: saved.revision,
  });
  assert.equal(pinned.pinned, true);
  await assert.rejects(
    storage.pinWorkspace('pinned-case', false, { expectedRevision: 0 }),
    WorkspaceRevisionConflict,
  );
  await assert.rejects(
    storage.deleteWorkspace('pinned-case', { expectedRevision: 1 }),
    { code: 'pinned' },
  );
  assert.equal((await storage.listWorkspaces())[0].pinned, true);
  await storage.pinWorkspace('pinned-case', false, { expectedRevision: 1 });
  assert.equal(
    await storage.deleteWorkspace('pinned-case', { expectedRevision: 1 }),
    true,
  );
  assert.equal(await storage.getWorkspace('pinned-case'), null);
});

test('bounded writes fail before publication and denied IndexedDB falls back to unsaved memory', async (t) => {
  const bounded = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
    maxBytes: 1024,
  });
  t.after(() => bounded.destroy());
  await bounded.commitWorkspace({
    id: 'large-case',
    expectedRevision: 0,
    document: { title: 'Saved before quota failure' },
  });
  await assert.rejects(
    bounded.commitWorkspace({
      id: 'large-case',
      expectedRevision: 1,
      document: { payload: 'x'.repeat(3000) },
    }),
    (error) => error instanceof WorkspaceStorageError && error.code === 'quota',
  );
  assert.equal(
    (await bounded.getWorkspace('large-case')).document.title,
    'Saved before quota failure',
  );

  const denied = createWorkspaceStorage({
    indexedDB: {
      open() {
        throw new DOMException('Blocked in this context', 'SecurityError');
      },
    },
    crypto: webcrypto,
  });
  t.after(() => denied.destroy());
  assert.equal(denied.mode, 'indexeddb');
  const saved = await denied.commitWorkspace({
    id: 'private-case',
    expectedRevision: 0,
    document: { title: 'Private context' },
  });
  assert.equal(saved.saved, false);
  assert.equal(denied.mode, 'memory');
  assert.match(denied.getAvailability().message, /will be lost/);
});
