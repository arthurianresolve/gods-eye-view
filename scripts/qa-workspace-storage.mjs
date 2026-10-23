#!/usr/bin/env node
/** Exercise transactional workspace storage against the browser's IndexedDB. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const firstTab = await browser.newPage();
  const secondTab = await browser.newPage();
  const pageErrors = [];
  for (const page of [firstTab, secondTab])
    page.on('pageerror', (error) =>
      pageErrors.push(error.stack || error.message),
    );
  for (const page of [firstTab, secondTab])
    page.setDefaultNavigationTimeout(90_000);
  await Promise.all(
    [firstTab, secondTab].map(async (page) => {
      const target = new URL('/src/storage/index.js', url);
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      await page.setContent('<!doctype html><html><body></body></html>');
    }),
  );
  const databaseName = `gev-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await firstTab.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const storage = createWorkspaceStorage({ name });
    window.__qaWorkspaceStorage = storage;
    const first = await storage.commitWorkspace({
      id: 'qa-case',
      expectedRevision: 0,
      document: { title: 'IndexedDB case', schemaVersion: 1 },
      chunks: {
        observations: [{ id: 'a1', timeMs: 1000 }],
        stableMetadata: { format: 1 },
      },
      assets: { thumbnail: new Uint8Array([7, 11, 19]) },
    });
    if (!first.saved || first.revision !== 1)
      throw new Error('First durable save failed');
    const second = await storage.commitWorkspace({
      id: 'qa-case',
      expectedRevision: 1,
      document: { title: 'IndexedDB case', schemaVersion: 2 },
      chunks: {
        observations: [{ id: 'a2', timeMs: 2000 }],
        stableMetadata: { format: 1 },
      },
      assets: { thumbnail: new Uint8Array([7, 11, 19]) },
    });
    if (!second.saved || second.revision !== 2)
      throw new Error('Second durable save failed');
  }, databaseName);

  const reload = await browser.newPage();
  reload.on('pageerror', (error) =>
    pageErrors.push(error.stack || error.message),
  );
  const reloadUrl = new URL('/src/storage/index.js', url);
  reload.setDefaultNavigationTimeout(90_000);
  await reload.goto(reloadUrl.href, { waitUntil: 'domcontentloaded' });
  await reload.setContent('<!doctype html><html><body></body></html>');
  const reloadError = await reload.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const storage = createWorkspaceStorage({ name });
    const loaded = await storage.getWorkspace('qa-case');
    return {
      saved: loaded?.saved,
      revision: loaded?.manifest.revision,
      version: loaded?.document.schemaVersion,
      row: loaded?.chunks.observations?.[0]?.id,
    };
  }, databaseName);
  assert.deepEqual(reloadError, {
    saved: true,
    revision: 2,
    version: 2,
    row: 'a2',
  });
  const deduplicated = await firstTab.evaluate(async () => {
    const storage = window.__qaWorkspaceStorage;
    const db = await storage.open();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('revisions', 'readonly');
      const store = transaction.objectStore('revisions');
      const first = store.get('qa-case:1');
      const second = store.get('qa-case:2');
      transaction.oncomplete = () =>
        resolve({
          sameChunk:
            first.result.chunkRefs.find((ref) => ref.name === 'stableMetadata')
              .key ===
            second.result.chunkRefs.find((ref) => ref.name === 'stableMetadata')
              .key,
          sameAsset:
            first.result.assetRefs[0].key === second.result.assetRefs[0].key,
        });
      transaction.onerror = () => reject(transaction.error);
    });
  });
  assert.deepEqual(deduplicated, { sameChunk: true, sameAsset: true });

  await secondTab.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    window.__qaWorkspaceStorage = createWorkspaceStorage({ name });
    const loaded = await window.__qaWorkspaceStorage.getWorkspace('qa-case');
    if (!loaded || loaded.manifest.revision !== 2)
      throw new Error('Second tab did not see the committed revision');
  }, databaseName);

  const contention = await Promise.all(
    [firstTab, secondTab].map((page, index) =>
      page.evaluate(async (writer) => {
        try {
          const result = await window.__qaWorkspaceStorage.commitWorkspace({
            id: 'qa-case',
            expectedRevision: 2,
            document: { title: `Writer ${writer}`, schemaVersion: 3 },
            chunks: {
              observations: [{ id: `winner-${writer}`, timeMs: 3000 }],
            },
          });
          return { status: 'saved', revision: result.revision };
        } catch (error) {
          return { status: error.code, actualRevision: error.actualRevision };
        }
      }, index),
    ),
  );
  assert.equal(
    contention.filter((result) => result.status === 'saved').length,
    1,
  );
  assert.equal(
    contention.filter((result) => result.status === 'revision-conflict').length,
    1,
  );
  assert.ok(
    contention.every(
      (result) => result.actualRevision === 3 || result.status === 'saved',
    ),
  );

  const recovery = await firstTab.evaluate(async () => {
    const storage = window.__qaWorkspaceStorage;
    const db = await storage.open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('chunks', 'readwrite');
      transaction.objectStore('chunks').put({
        key: 'interrupted-orphan',
        workspaceId: 'qa-case',
        value: [{ id: 'unpublished' }],
        bytes: 1,
        checksum: 'invalid',
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['workspaces', 'revisions', 'chunks'],
        'readwrite',
      );
      const current = transaction.objectStore('workspaces').get('qa-case');
      current.onsuccess = () => {
        transaction.objectStore('chunks').put({
          key: 'interrupted-write',
          workspaceId: 'qa-case',
          value: [{ id: 'partial' }],
          bytes: 1,
          checksum: 'invalid',
        });
        transaction.objectStore('revisions').put({
          key: 'interrupted-revision',
          id: 'qa-case',
          revision: 99,
          chunkRefs: [],
          assetRefs: [],
        });
        current.result && transaction.abort();
      };
      transaction.onabort = resolve;
      transaction.oncomplete = () =>
        reject(new Error('Interrupted write unexpectedly committed'));
      transaction.onerror = () => {};
    });
    const before = await storage.getWorkspace('qa-case');
    const orphanCount = await storage.cleanupOrphans();
    const after = await storage.getWorkspace('qa-case');
    const migrated = await storage.migrateWorkspace(
      'qa-case',
      ({ document, chunks }) => ({
        document: { ...document, schemaVersion: 4 },
        chunks: { ...chunks, migrationMarker: [{ from: 3, to: 4 }] },
      }),
      { expectedRevision: 3 },
    );
    const prior = await storage.getWorkspace('qa-case', { revision: 3 });
    const pinned = await storage.pinWorkspace('qa-case', true, {
      expectedRevision: 4,
    });
    let pinnedDeleteCode = '';
    try {
      await storage.deleteWorkspace('qa-case', { expectedRevision: 4 });
    } catch (error) {
      pinnedDeleteCode = error.code;
    }
    return {
      beforeRevision: before.manifest.revision,
      afterRevision: after.manifest.revision,
      interruptedDataVisible: after.chunks.observations.some(
        (row) => row.id === 'partial',
      ),
      orphanCount,
      migrationBefore: migrated.before.document.schemaVersion,
      migrationAfter: migrated.after.revision,
      priorVersion: prior.document.schemaVersion,
      pinned: pinned.pinned,
      pinnedDeleteCode,
    };
  });
  assert.equal(recovery.beforeRevision, 3);
  assert.equal(recovery.afterRevision, 3);
  assert.equal(recovery.interruptedDataVisible, false);
  assert.equal(recovery.orphanCount, 1);
  assert.equal(recovery.migrationBefore, 3);
  assert.equal(recovery.migrationAfter, 4);
  assert.equal(recovery.priorVersion, 3);
  assert.equal(recovery.pinned, true);
  assert.equal(recovery.pinnedDeleteCode, 'pinned');

  const integrity = await firstTab.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const storage = createWorkspaceStorage({ name });
    await storage.commitWorkspace({
      id: 'tamper-case',
      expectedRevision: 0,
      document: { title: 'Integrity case' },
      assets: { payload: new Uint8Array([1, 2, 3]) },
    });
    const db = await storage.open();
    const assetKey = await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspaces', 'readonly');
      const request = transaction.objectStore('workspaces').get('tamper-case');
      request.onsuccess = () => resolve(request.result.assetRefs[0].key);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.get(assetKey);
      request.onsuccess = () =>
        store.put({ ...request.result, value: new Uint8Array([9, 9, 9]) });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    try {
      await storage.getWorkspace('tamper-case');
      return 'missed-corruption';
    } catch (error) {
      return error.code;
    }
  }, databaseName);
  assert.equal(integrity, 'integrity');

  const bounded = await firstTab.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const storage = createWorkspaceStorage({
      name: `${name}-bounded`,
      maxBytes: 1024,
    });
    await storage.commitWorkspace({
      id: 'too-large',
      expectedRevision: 0,
      document: { title: 'Saved before quota failure' },
    });
    try {
      await storage.commitWorkspace({
        id: 'too-large',
        expectedRevision: 1,
        document: { payload: 'x'.repeat(3000) },
      });
      return { code: 'missed-limit' };
    } catch (error) {
      const loaded = await storage.getWorkspace('too-large');
      return {
        code: error.code,
        revision: loaded?.manifest.revision,
        title: loaded?.document.title,
      };
    }
  }, databaseName);
  assert.deepEqual(bounded, {
    code: 'quota',
    revision: 1,
    title: 'Saved before quota failure',
  });
  assert.deepEqual(pageErrors, []);
  console.log(
    'Workspace storage browser QA passed: reload, revisions, two-tab conflict, abort cleanup, migration, quota, pinning, and integrity.',
  );
} finally {
  await browser.close();
}
