import {
  DEFAULT_WORKSPACE_DB,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceRevisionConflict,
  WorkspaceStorageError,
  cloneJson,
  contentKey,
  payloadBytes,
  revisionKey,
  sha256,
  stableJson,
  storageError,
  validateRecordName,
  validateWorkspaceId,
} from './codec.js';

const STORE_NAMES = Object.freeze([
  'workspaces',
  'revisions',
  'chunks',
  'assets',
]);
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

function namedEntries(value, validateName) {
  const entries =
    value instanceof Map ? [...value] : Object.entries(value || {});
  const names = new Set();
  return entries.map(([rawName, data]) => {
    const name = validateName(rawName);
    if (names.has(name))
      throw new WorkspaceStorageError(
        'duplicate-record',
        `Duplicate record name: ${name}`,
      );
    names.add(name);
    return [name, data];
  });
}

async function prepareWrite({
  id,
  document,
  chunks,
  assets,
  maxBytes,
  cryptoRef,
}) {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new WorkspaceStorageError(
      'invalid-data',
      'A workspace document object is required',
    );
  const normalizedDocument = JSON.parse(stableJson(document));
  const documentChecksum = await sha256(normalizedDocument, cryptoRef);
  const documentBytes = new TextEncoder().encode(
    stableJson(normalizedDocument),
  ).byteLength;
  const preparedChunks = [];
  const preparedAssets = [];
  let totalBytes = documentBytes;

  for (const [name, value] of namedEntries(chunks, validateRecordName)) {
    const normalized = JSON.parse(stableJson(value));
    const bytes = new TextEncoder().encode(stableJson(normalized)).byteLength;
    const checksum = await sha256(normalized, cryptoRef);
    totalBytes += bytes;
    preparedChunks.push({ name, value: normalized, bytes, checksum });
  }
  for (const [name, value] of namedEntries(assets, validateRecordName)) {
    const bytes = await payloadBytes(value);
    const checksum = await sha256(bytes, cryptoRef);
    totalBytes += bytes.byteLength;
    const storedValue =
      value instanceof ArrayBuffer
        ? value.slice(0)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(
              value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
              ),
            )
          : value;
    preparedAssets.push({
      name,
      value: storedValue,
      bytes: bytes.byteLength,
      checksum,
    });
  }

  if (totalBytes > maxBytes)
    throw new WorkspaceStorageError(
      'quota',
      `Workspace is ${totalBytes} bytes; the configured limit is ${maxBytes}`,
    );
  return {
    id,
    document: normalizedDocument,
    documentChecksum,
    documentBytes,
    chunks: preparedChunks,
    assets: preparedAssets,
    bytes: totalBytes,
  };
}

function summarize(manifest) {
  const { document, chunkRefs, assetRefs, documentChecksum, ...summary } =
    manifest;
  return {
    ...summary,
    title: String(document?.title || '').slice(0, 200),
    kind: String(document?.kind || ''),
    schemaVersion: Number.isInteger(document?.schemaVersion)
      ? document.schemaVersion
      : null,
    status: String(document?.status || ''),
  };
}

function createMemoryState() {
  return {
    workspaces: new Map(),
    revisions: new Map(),
    chunks: new Map(),
    assets: new Map(),
  };
}

/** IndexedDB workspace storage with optimistic writes and an explicit unsaved fallback. */
export function createWorkspaceStorage({
  indexedDB: indexedDBRef = globalThis.indexedDB,
  storage = globalThis.navigator?.storage,
  crypto: cryptoRef = globalThis.crypto,
  now = () => Date.now(),
  name = DEFAULT_WORKSPACE_DB,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  let persistent = typeof indexedDBRef?.open === 'function';
  const byteLimit = Math.max(
    1024,
    Math.min(DEFAULT_MAX_BYTES, Number(maxBytes) || DEFAULT_MAX_BYTES),
  );
  const memory = createMemoryState();
  let database = null;
  let opening = null;
  let destroyed = false;
  let fallbackMessage = '';

  const assertOpen = () => {
    if (destroyed)
      throw new WorkspaceStorageError(
        'closed',
        'Workspace storage has been destroyed',
      );
  };

  function open() {
    assertOpen();
    if (!persistent) return Promise.resolve(null);
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDBRef.open(name, WORKSPACE_SCHEMA_VERSION);
      } catch (error) {
        reject(storageError(error, 'open'));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('workspaces'))
          db.createObjectStore('workspaces', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('revisions'))
          db.createObjectStore('revisions', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('chunks'))
          db.createObjectStore('chunks', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('assets'))
          db.createObjectStore('assets', { keyPath: 'key' });
      };
      request.onerror = () => reject(storageError(request.error, 'open'));
      request.onblocked = () =>
        reject(
          new WorkspaceStorageError(
            'blocked',
            'Workspace database upgrade is blocked by another tab',
          ),
        );
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => {
          database.close();
          database = null;
          opening = null;
        };
        resolve(database);
      };
    })
      .catch((error) => {
        const cause = error?.cause || error;
        if (
          ['SecurityError', 'InvalidStateError', 'NotAllowedError'].includes(
            cause?.name,
          )
        ) {
          persistent = false;
          fallbackMessage =
            'Browser storage is unavailable; workspace changes are in memory and will be lost when the app closes.';
          return null;
        }
        throw error;
      })
      .finally(() => {
        opening = null;
      });
    return opening;
  }

  function makeManifest(prepared, previous, revision) {
    const refsFor = (records, previousRefs = []) =>
      records.map(({ name, checksum, bytes }) => {
        const unchanged = previousRefs.find(
          (ref) =>
            ref.name === name &&
            ref.checksum === checksum &&
            ref.bytes === bytes,
        );
        return {
          name,
          key: unchanged?.key || contentKey(prepared.id, revision, name),
          checksum,
          bytes,
        };
      });
    const chunkRefs = refsFor(prepared.chunks, previous?.chunkRefs);
    const assetRefs = refsFor(prepared.assets, previous?.assetRefs);
    return {
      id: prepared.id,
      revision,
      previousRevision: previous?.revision || null,
      updatedAt: now(),
      document: prepared.document,
      documentChecksum: prepared.documentChecksum,
      chunkRefs,
      assetRefs,
      bytes: prepared.bytes,
      pinned: Boolean(previous?.pinned),
    };
  }

  function commitMemory(prepared, expectedRevision) {
    const previous = memory.workspaces.get(prepared.id) || null;
    const actual = previous?.revision || 0;
    if (actual !== expectedRevision)
      throw new WorkspaceRevisionConflict(
        prepared.id,
        expectedRevision,
        actual,
      );
    const revision = actual + 1;
    const manifest = makeManifest(prepared, previous, revision);
    for (const [index, record] of prepared.chunks.entries()) {
      const key = manifest.chunkRefs[index].key;
      if (!memory.chunks.has(key))
        memory.chunks.set(key, { key, workspaceId: prepared.id, ...record });
    }
    for (const [index, record] of prepared.assets.entries()) {
      const key = manifest.assetRefs[index].key;
      if (!memory.assets.has(key))
        memory.assets.set(key, { key, workspaceId: prepared.id, ...record });
    }
    memory.revisions.set(revisionKey(prepared.id, revision), {
      key: revisionKey(prepared.id, revision),
      ...manifest,
    });
    memory.workspaces.set(prepared.id, manifest);
    return { ...summarize(manifest), saved: false };
  }

  async function memoryWorkspace(id, revision, verify) {
    const manifest =
      revision === undefined
        ? memory.workspaces.get(id)
        : memory.revisions.get(revisionKey(id, revision));
    if (!manifest) return null;
    return materialize(manifest, memory.chunks, memory.assets, verify, false);
  }

  function mutateMemoryManifest(id, expectedRevision, mutation) {
    const current = memory.workspaces.get(id);
    const actual = current?.revision || 0;
    if (actual !== expectedRevision)
      throw new WorkspaceRevisionConflict(id, expectedRevision, actual);
    if (!current) return null;
    const next = mutation({ ...current });
    memory.workspaces.set(id, next);
    const revision = memory.revisions.get(revisionKey(id, current.revision));
    if (revision)
      memory.revisions.set(revision.key, { ...revision, pinned: next.pinned });
    return { ...summarize(next), saved: false };
  }

  function deleteFromMemory(id, expectedRevision) {
    const current = memory.workspaces.get(id);
    const actual = current?.revision || 0;
    if (actual !== expectedRevision)
      throw new WorkspaceRevisionConflict(id, expectedRevision, actual);
    if (!current) return false;
    if (current.pinned)
      throw new WorkspaceStorageError(
        'pinned',
        'Unpin this workspace before deleting it',
      );
    for (const storeName of ['revisions', 'chunks', 'assets'])
      for (const [recordKey, value] of memory[storeName])
        if (value.id === id || value.workspaceId === id)
          memory[storeName].delete(recordKey);
    memory.workspaces.delete(id);
    return true;
  }

  function cleanupMemoryOrphans() {
    const retainedChunks = new Set();
    const retainedAssets = new Set();
    for (const revision of memory.revisions.values()) {
      for (const ref of revision.chunkRefs || []) retainedChunks.add(ref.key);
      for (const ref of revision.assetRefs || []) retainedAssets.add(ref.key);
    }
    let removed = 0;
    for (const key of memory.chunks.keys())
      if (!retainedChunks.has(key)) {
        memory.chunks.delete(key);
        removed++;
      }
    for (const key of memory.assets.keys())
      if (!retainedAssets.has(key)) {
        memory.assets.delete(key);
        removed++;
      }
    return removed;
  }

  async function commitIndexedDb(db, prepared, expectedRevision) {
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE_NAMES, 'readwrite');
      } catch (error) {
        reject(storageError(error));
        return;
      }
      const workspaces = transaction.objectStore('workspaces');
      let conflict = null;
      let result = null;
      const current = workspaces.get(prepared.id);
      current.onerror = () => transaction.abort();
      current.onsuccess = () => {
        const previous = current.result || null;
        const actual = previous?.revision || 0;
        if (actual !== expectedRevision) {
          conflict = new WorkspaceRevisionConflict(
            prepared.id,
            expectedRevision,
            actual,
          );
          transaction.abort();
          return;
        }
        const revision = actual + 1;
        const manifest = makeManifest(prepared, previous, revision);
        const revisionRow = {
          key: revisionKey(prepared.id, revision),
          ...manifest,
        };
        for (const [index, record] of prepared.chunks.entries()) {
          const key = manifest.chunkRefs[index].key;
          if (key === contentKey(prepared.id, revision, record.name))
            transaction
              .objectStore('chunks')
              .put({ key, workspaceId: prepared.id, ...record });
        }
        for (const [index, record] of prepared.assets.entries()) {
          const key = manifest.assetRefs[index].key;
          if (key === contentKey(prepared.id, revision, record.name))
            transaction
              .objectStore('assets')
              .put({ key, workspaceId: prepared.id, ...record });
        }
        transaction.objectStore('revisions').put(revisionRow);
        workspaces.put(manifest);
        result = { ...summarize(manifest), saved: true };
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(conflict || storageError(transaction.error, 'transaction'));
      transaction.onerror = () => {};
    });
  }

  async function readWorkspace(id, { revision, verify = true } = {}) {
    assertOpen();
    const key = validateWorkspaceId(id);
    if (!persistent) return memoryWorkspace(key, revision, verify);
    const db = await open();
    if (!db) return memoryWorkspace(key, revision, verify);
    return await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(
          ['workspaces', 'revisions', 'chunks', 'assets'],
          'readonly',
        );
      } catch (error) {
        reject(storageError(error));
        return;
      }
      let manifest = null;
      let failed = null;
      const chunks = new Map();
      const assets = new Map();
      let contentCount = 0;
      let received = 0;
      const root =
        revision === undefined
          ? transaction.objectStore('workspaces').get(key)
          : transaction
              .objectStore('revisions')
              .get(revisionKey(key, revision));
      root.onerror = () => {
        failed = storageError(root.error);
        transaction.abort();
      };
      root.onsuccess = () => {
        manifest = root.result || null;
        if (!manifest) return;
        const enqueue = (storeName, refs, output) => {
          for (const ref of refs || []) {
            contentCount++;
            const request = transaction.objectStore(storeName).get(ref.key);
            request.onerror = () => {
              failed = storageError(request.error);
              transaction.abort();
            };
            request.onsuccess = () => {
              output.set(ref.name, request.result || null);
              received++;
            };
          }
        };
        enqueue('chunks', manifest.chunkRefs, chunks);
        enqueue('assets', manifest.assetRefs, assets);
      };
      transaction.oncomplete = async () => {
        if (failed) {
          reject(failed);
          return;
        }
        if (!manifest) {
          resolve(null);
          return;
        }
        if (received !== contentCount) {
          reject(
            new WorkspaceStorageError(
              'integrity',
              'Workspace content references are incomplete',
            ),
          );
          return;
        }
        try {
          resolve(await materialize(manifest, chunks, assets, verify, true));
        } catch (error) {
          reject(storageError(error, 'integrity'));
        }
      };
      transaction.onabort = () =>
        reject(failed || storageError(transaction.error));
      transaction.onerror = () => {};
    });
  }

  async function materialize(manifest, chunkMap, assetMap, verify, saved) {
    if (
      verify &&
      (await sha256(manifest.document, cryptoRef)) !== manifest.documentChecksum
    )
      throw new WorkspaceStorageError(
        'integrity',
        `Workspace ${manifest.id} manifest checksum failed`,
      );
    const chunks = {};
    const assets = {};
    for (const ref of manifest.chunkRefs || []) {
      const record = chunkMap.get(ref.name) || chunkMap.get(ref.key);
      if (!record)
        throw new WorkspaceStorageError(
          'integrity',
          `Workspace chunk is missing: ${ref.name}`,
        );
      if (verify && (await sha256(record.value, cryptoRef)) !== ref.checksum)
        throw new WorkspaceStorageError(
          'integrity',
          `Workspace chunk checksum failed: ${ref.name}`,
        );
      chunks[ref.name] = cloneJson(record.value);
    }
    for (const ref of manifest.assetRefs || []) {
      const record = assetMap.get(ref.name) || assetMap.get(ref.key);
      if (!record)
        throw new WorkspaceStorageError(
          'integrity',
          `Workspace asset is missing: ${ref.name}`,
        );
      if (verify && (await sha256(record.value, cryptoRef)) !== ref.checksum)
        throw new WorkspaceStorageError(
          'integrity',
          `Workspace asset checksum failed: ${ref.name}`,
        );
      assets[ref.name] = record.value;
    }
    return {
      manifest: summarize(manifest),
      document: cloneJson(manifest.document),
      chunks,
      assets,
      saved,
    };
  }

  async function mutateManifest(id, expectedRevision, mutation) {
    if (!persistent)
      return mutateMemoryManifest(id, expectedRevision, mutation);
    const db = await open();
    if (!db) return mutateMemoryManifest(id, expectedRevision, mutation);
    return await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(['workspaces', 'revisions'], 'readwrite');
      } catch (error) {
        reject(storageError(error));
        return;
      }
      const store = transaction.objectStore('workspaces');
      let result = null;
      let failure = null;
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result || null;
        const actual = current?.revision || 0;
        if (actual !== expectedRevision) {
          failure = new WorkspaceRevisionConflict(id, expectedRevision, actual);
          transaction.abort();
          return;
        }
        if (!current) return;
        const next = mutation({ ...current });
        store.put(next);
        const revisions = transaction.objectStore('revisions');
        const revisionRequest = revisions.get(
          revisionKey(id, current.revision),
        );
        revisionRequest.onsuccess = () => {
          if (!revisionRequest.result) {
            failure = new WorkspaceStorageError(
              'integrity',
              'Workspace revision record is missing',
            );
            transaction.abort();
            return;
          }
          revisions.put({ ...revisionRequest.result, pinned: next.pinned });
        };
        revisionRequest.onerror = () => transaction.abort();
        result = { ...summarize(next), saved: true };
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(failure || storageError(transaction.error));
      transaction.onerror = () => {};
    });
  }

  async function pinWorkspace(id, pinned, { expectedRevision } = {}) {
    assertOpen();
    const key = validateWorkspaceId(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
      throw new WorkspaceStorageError(
        'revision-required',
        'An expected workspace revision is required',
      );
    return mutateManifest(key, expectedRevision, (current) => ({
      ...current,
      pinned: Boolean(pinned),
      updatedAt: now(),
    }));
  }

  async function deleteWorkspace(id, { expectedRevision } = {}) {
    assertOpen();
    const key = validateWorkspaceId(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
      throw new WorkspaceStorageError(
        'revision-required',
        'An expected workspace revision is required',
      );
    if (!persistent) return deleteFromMemory(key, expectedRevision);
    const db = await open();
    if (!db) return deleteFromMemory(key, expectedRevision);
    return await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE_NAMES, 'readwrite');
      } catch (error) {
        reject(storageError(error));
        return;
      }
      const workspaces = transaction.objectStore('workspaces');
      let result = false;
      let failure = null;
      const request = workspaces.get(key);
      request.onsuccess = () => {
        const current = request.result || null;
        const actual = current?.revision || 0;
        if (actual !== expectedRevision) {
          failure = new WorkspaceRevisionConflict(
            key,
            expectedRevision,
            actual,
          );
          transaction.abort();
          return;
        }
        if (!current) return;
        if (current.pinned) {
          failure = new WorkspaceStorageError(
            'pinned',
            'Unpin this workspace before deleting it',
          );
          transaction.abort();
          return;
        }
        const cleanup = (storeName, isOwned) => {
          const store = transaction.objectStore(storeName);
          const all = store.getAll();
          all.onsuccess = () => {
            for (const record of all.result)
              if (isOwned(record)) store.delete(record.key);
          };
        };
        cleanup('revisions', (record) => record.id === key);
        cleanup('chunks', (record) => record.workspaceId === key);
        cleanup('assets', (record) => record.workspaceId === key);
        workspaces.delete(key);
        result = true;
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(failure || storageError(transaction.error));
      transaction.onerror = () => {};
    });
  }

  async function listWorkspaces() {
    assertOpen();
    if (!persistent)
      return [...memory.workspaces.values()]
        .map(summarize)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const db = await open();
    if (!db)
      return [...memory.workspaces.values()]
        .map(summarize)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspaces', 'readonly');
      const request = transaction.objectStore('workspaces').getAll();
      request.onsuccess = () =>
        resolve(
          request.result
            .map(summarize)
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      request.onerror = () => reject(storageError(request.error));
    });
  }

  async function cleanupOrphans() {
    assertOpen();
    if (!persistent) {
      return cleanupMemoryOrphans();
    }
    const db = await open();
    if (!db) return cleanupMemoryOrphans();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ['revisions', 'chunks', 'assets'],
        'readwrite',
      );
      const revisions = transaction.objectStore('revisions').getAll();
      const chunks = transaction.objectStore('chunks');
      const assets = transaction.objectStore('assets');
      const chunkRows = chunks.getAll();
      const assetRows = assets.getAll();
      let data = null;
      let chunkRecords = null;
      let assetRecords = null;
      let removed = 0;
      const compact = () => {
        if (!data || !chunkRecords || !assetRecords) return;
        const retainedChunks = new Set(
          data.flatMap((row) => (row.chunkRefs || []).map((ref) => ref.key)),
        );
        const retainedAssets = new Set(
          data.flatMap((row) => (row.assetRefs || []).map((ref) => ref.key)),
        );
        for (const record of chunkRecords)
          if (!retainedChunks.has(record.key)) {
            chunks.delete(record.key);
            removed++;
          }
        for (const record of assetRecords)
          if (!retainedAssets.has(record.key)) {
            assets.delete(record.key);
            removed++;
          }
      };
      revisions.onsuccess = () => {
        data = revisions.result;
        compact();
      };
      chunkRows.onsuccess = () => {
        chunkRecords = chunkRows.result;
        compact();
      };
      assetRows.onsuccess = () => {
        assetRecords = assetRows.result;
        compact();
      };
      for (const request of [revisions, chunkRows, assetRows])
        request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(removed);
      transaction.onabort = () => reject(storageError(transaction.error));
    });
  }

  async function estimate() {
    assertOpen();
    if (persistent && typeof storage?.estimate === 'function') {
      try {
        const result = await storage.estimate();
        return {
          mode: 'indexeddb',
          usage: result.usage ?? null,
          quota: result.quota ?? null,
        };
      } catch {
        return { mode: 'indexeddb', usage: null, quota: null };
      }
    }
    const bytes = [...memory.workspaces.values()].reduce(
      (sum, record) => sum + record.bytes,
      0,
    );
    return { mode: 'memory', usage: bytes, quota: null };
  }

  async function commitWorkspace({
    id,
    expectedRevision,
    document,
    chunks = {},
    assets = {},
  } = {}) {
    assertOpen();
    const key = validateWorkspaceId(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
      throw new WorkspaceStorageError(
        'revision-required',
        'An expected workspace revision is required',
      );
    const prepared = await prepareWrite({
      id: key,
      document,
      chunks,
      assets,
      maxBytes: byteLimit,
      cryptoRef,
    });
    const db = await open();
    if (!db) return commitMemory(prepared, expectedRevision);
    return commitIndexedDb(db, prepared, expectedRevision);
  }

  return Object.freeze({
    get mode() {
      return persistent ? 'indexeddb' : 'memory';
    },
    get savedByBrowser() {
      return persistent;
    },
    getAvailability: () => ({
      mode: persistent ? 'indexeddb' : 'memory',
      savedByBrowser: persistent,
      message: persistent
        ? ''
        : fallbackMessage ||
          'Workspace changes are in memory and will be lost when the app closes.',
    }),
    open,
    commitWorkspace,
    getWorkspace: readWorkspace,
    listWorkspaces,
    pinWorkspace,
    deleteWorkspace,
    cleanupOrphans,
    async migrateWorkspace(id, migrate, { expectedRevision } = {}) {
      if (typeof migrate !== 'function')
        throw new TypeError('A workspace migration function is required');
      const before = await readWorkspace(id);
      if (!before) return null;
      if (expectedRevision !== before.manifest.revision)
        throw new WorkspaceRevisionConflict(
          id,
          expectedRevision,
          before.manifest.revision,
        );
      const migrated = await migrate({
        document: cloneJson(before.document),
        chunks: cloneJson(before.chunks),
      });
      const after = await commitWorkspace({
        id,
        expectedRevision,
        document: migrated?.document,
        chunks: migrated?.chunks,
        assets: before.assets,
      });
      return { before, after };
    },
    estimate,
    async requestPersistence() {
      assertOpen();
      if (!persistent || typeof storage?.persist !== 'function')
        return { supported: false, persisted: false };
      try {
        return { supported: true, persisted: await storage.persist() };
      } catch {
        return { supported: true, persisted: false };
      }
    },
    close() {
      database?.close();
      database = null;
      opening = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      database?.close();
      database = null;
    },
  });
}
