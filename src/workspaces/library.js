import {
  WorkspaceRevisionConflict,
  validateWorkspaceId,
} from '../storage/codec.js';
import { createWorkspaceDocument, parseWorkspaceDocument } from './document.js';
import { exportWorkspaceBundle, parseWorkspaceBundle } from './portable.js';

const MAX_HISTORY = 5;
const timestamp = (now) => now();

function randomId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `investigation-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Revision-aware workspace operations; callers own UI and restore semantics. */
export function createWorkspaceLibrary({
  storage,
  now = () => Date.now(),
  makeId = randomId,
  crypto: cryptoRef = globalThis.crypto,
} = {}) {
  if (typeof storage?.listWorkspaces !== 'function')
    throw new TypeError('Workspace storage is required.');
  if (typeof storage?.commitWorkspace !== 'function')
    throw new TypeError('Revisioned workspace commits are required.');

  async function list() {
    const rows = await storage.listWorkspaces();
    const items = [];
    for (const row of rows) {
      if (row.kind !== 'investigation-workspace') continue;
      const saved = await storage.getWorkspace(row.id);
      if (!saved) continue;
      const document = parseWorkspaceDocument(saved.document);
      items.push({
        id: document.id,
        title: document.title,
        revision: saved.manifest.revision,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        temporalSource: document.temporalSource,
        pinned: saved.manifest.pinned === true,
        saved: saved.saved === true,
      });
    }
    return items.sort(
      (a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title),
    );
  }

  async function save(snapshot, { id, title, expectedRevision } = {}) {
    const existing = id ? await storage.getWorkspace(id) : null;
    if (id && !existing)
      throw Object.assign(new Error('Workspace no longer exists.'), {
        code: 'missing-workspace',
      });
    const currentRevision = existing?.manifest?.revision || 0;
    if (
      existing &&
      expectedRevision != null &&
      expectedRevision !== currentRevision
    )
      throw new WorkspaceRevisionConflict(
        id,
        expectedRevision,
        currentRevision,
      );
    const key = id ? validateWorkspaceId(id) : validateWorkspaceId(makeId());
    const createdAt = existing?.document?.createdAt ?? timestamp(now);
    const document = createWorkspaceDocument(
      {
        ...snapshot,
        id: key,
        title: title ?? existing?.document?.title ?? snapshot.title,
        createdAt,
        updatedAt: timestamp(now),
        revision: currentRevision + 1,
      },
      { now },
    );
    const result = await storage.commitWorkspace({
      id: key,
      expectedRevision: currentRevision,
      document,
      chunks: snapshot.chunks ?? existing?.chunks ?? {},
      assets: snapshot.assets ?? existing?.assets ?? {},
    });
    return { document, manifest: result, saved: result.saved === true };
  }

  async function duplicate(id, { title } = {}) {
    const source = await storage.getWorkspace(id);
    if (!source) return null;
    const duplicateId = validateWorkspaceId(makeId());
    const document = createWorkspaceDocument({
      ...source.document,
      id: duplicateId,
      title: title || `${source.document.title} copy`,
      revision: 1,
      createdAt: timestamp(now),
      updatedAt: timestamp(now),
    });
    const manifest = await storage.commitWorkspace({
      id: duplicateId,
      expectedRevision: 0,
      document,
      chunks: source.chunks,
      assets: source.assets,
    });
    return { document, manifest, saved: manifest.saved === true };
  }

  async function history(id, { limit = MAX_HISTORY } = {}) {
    const current = await storage.getWorkspace(id);
    if (!current) return [];
    const count = Math.max(0, Math.min(MAX_HISTORY, Math.floor(limit) || 0));
    const revisions = [];
    for (
      let revision = current.manifest.revision - 1;
      revision > 0 && revisions.length < count;
      revision--
    ) {
      const saved = await storage.getWorkspace(id, { revision });
      if (!saved) break;
      revisions.push({
        revision,
        title: saved.document.title,
        updatedAt: saved.document.updatedAt,
      });
    }
    return revisions;
  }

  async function recover(id, revision, { expectedRevision } = {}) {
    const current = await storage.getWorkspace(id);
    if (!current) return null;
    const expected = expectedRevision ?? current.manifest.revision;
    if (expected !== current.manifest.revision)
      throw new WorkspaceRevisionConflict(
        id,
        expected,
        current.manifest.revision,
      );
    const source = await storage.getWorkspace(id, { revision });
    if (!source) return null;
    const document = createWorkspaceDocument({
      ...source.document,
      revision: current.manifest.revision + 1,
      createdAt: current.document.createdAt,
      updatedAt: timestamp(now),
    });
    const manifest = await storage.commitWorkspace({
      id,
      expectedRevision: current.manifest.revision,
      document,
      chunks: source.chunks,
      assets: source.assets,
    });
    return { document, manifest, saved: manifest.saved === true };
  }

  async function remove(id, { expectedRevision } = {}) {
    const current = await storage.getWorkspace(id);
    if (!current) return false;
    if (
      expectedRevision != null &&
      expectedRevision !== current.manifest.revision
    )
      throw new WorkspaceRevisionConflict(
        id,
        expectedRevision,
        current.manifest.revision,
      );
    return storage.deleteWorkspace(id, {
      expectedRevision: current.manifest.revision,
    });
  }

  async function exportBackup(id) {
    const record = await storage.getWorkspace(id);
    return record ? exportWorkspaceBundle(record, { crypto: cryptoRef }) : null;
  }

  async function importBackup(input, { title } = {}) {
    const parsed = await parseWorkspaceBundle(input, { crypto: cryptoRef });
    const id = validateWorkspaceId(makeId());
    const document = createWorkspaceDocument({
      ...parsed.document,
      id,
      title: title || parsed.document.title,
      revision: 1,
      createdAt: timestamp(now),
      updatedAt: timestamp(now),
    });
    const manifest = await storage.commitWorkspace({
      id,
      expectedRevision: 0,
      document,
      chunks: parsed.chunks,
      assets: parsed.assets,
    });
    return { document, manifest, saved: manifest.saved === true };
  }

  return Object.freeze({
    list,
    save,
    duplicate,
    history,
    recover,
    remove,
    exportBackup,
    importBackup,
    getWorkspace: (id, options) => storage.getWorkspace(id, options),
    getAvailability: () => storage.getAvailability?.() || null,
    estimate: () => storage.estimate?.() || null,
    cleanupOrphans: () => storage.cleanupOrphans?.() ?? 0,
  });
}
