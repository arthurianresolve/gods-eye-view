import { sha256 } from '../storage/codec.js';
import {
  parseSceneDocument,
  stringifySceneDocument,
} from '../director/document.js';
import { BUNDLE_SOURCE } from '../director/sharing/bundle.js';
import { PACK_LIMITS, validateAssetPath } from '../director/packs/manifest.js';

export const DIRECTOR_WORKSPACE_ID = 'director-project-v1';
export const DIRECTOR_PERSISTENCE_VERSION = 1;

const ASSET_ID = /^sha256-[a-f0-9]{64}$/;
const MIME_TYPES = new Set([
  'application/json',
  'application/geo+json',
  'image/png',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function pathsIn(project) {
  return project.scenes.flatMap((scene) =>
    (scene.dataPacks || [])
      .filter((pack) => pack.source.adapter === BUNDLE_SOURCE)
      .map((pack) => ({ path: pack.source.path, pack })),
  );
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value))
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  return null;
}

function validateMime(mimeType) {
  if (!MIME_TYPES.has(mimeType))
    fail(
      'invalid-asset',
      'Director bundle asset has an unsupported media type.',
    );
}

/** Persist authored scene data and only explicitly imported, referenced bundle bytes. */
export function createDirectorPersistence({
  storage,
  crypto: cryptoRef = globalThis.crypto,
  now = () => Date.now(),
  id = DIRECTOR_WORKSPACE_ID,
} = {}) {
  if (typeof storage?.getWorkspace !== 'function')
    throw new TypeError('Durable workspace storage is required.');
  if (typeof storage?.commitWorkspace !== 'function')
    throw new TypeError('Workspace storage must support revisioned commits.');

  async function save(projectInput, bundleAssets = new Map()) {
    let project;
    try {
      project = parseSceneDocument(stringifySceneDocument(projectInput));
    } catch (error) {
      fail('invalid-project', `Director project is invalid: ${error.message}`);
    }
    const assets = new Map();
    const assetIndex = Object.create(null);
    let totalBytes = 0;
    for (const { path, pack } of pathsIn(project)) {
      validateAssetPath(path);
      const previous = assetIndex[path];
      if (previous) {
        if (
          (pack.byteLength != null &&
            pack.byteLength !== previous.byteLength) ||
          (pack.sha256 != null && pack.sha256 !== previous.sha256)
        )
          fail(
            'integrity',
            `Scene packs disagree about asset content: ${path}.`,
          );
        continue;
      }
      const supplied = bundleAssets.get(path);
      const bytes = asBytes(supplied?.bytes);
      if (!bytes)
        fail(
          'missing-asset',
          `Saved scene asset is unavailable: ${path}. Reimport its bundle before saving.`,
        );
      if (!bytes.length || bytes.length > PACK_LIMITS.bytes)
        fail(
          'invalid-asset',
          `Saved scene asset exceeds its size limit: ${path}.`,
        );
      totalBytes += bytes.byteLength;
      if (totalBytes > PACK_LIMITS.totalBytes)
        fail(
          'invalid-asset',
          'Director bundle assets exceed their total size limit.',
        );
      validateMime(supplied.mimeType);
      const digest = await sha256(bytes, cryptoRef);
      if (
        (pack.byteLength != null && pack.byteLength !== bytes.byteLength) ||
        (pack.sha256 != null && pack.sha256 !== digest)
      )
        fail(
          'integrity',
          `Saved scene asset failed its integrity check: ${path}.`,
        );
      const assetId = `sha256-${digest}`;
      const existing = assets.get(assetId);
      if (
        existing &&
        (existing.byteLength !== bytes.byteLength || existing.sha256 !== digest)
      )
        fail('integrity', 'Conflicting Director asset content was supplied.');
      assets.set(assetId, {
        bytes,
        sha256: digest,
        byteLength: bytes.byteLength,
      });
      assetIndex[path] = {
        id: assetId,
        mimeType: supplied.mimeType,
        sha256: digest,
        byteLength: bytes.byteLength,
      };
    }

    const existing = await storage.getWorkspace(id);
    const revision = existing?.manifest?.revision || 0;
    const timestamp = new Date(now()).toISOString();
    const assetRefs = [...assets.entries()]
      .map(([assetId, item]) => ({
        id: assetId,
        sha256: item.sha256,
        byteLength: item.byteLength,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const document = {
      kind: 'director-project',
      schemaVersion: DIRECTOR_PERSISTENCE_VERSION,
      projectVersion: project.version,
      title: 'Director project',
      updatedAt: timestamp,
      assetRefs,
    };
    const storedAssets = Object.fromEntries(
      [...assets].map(([assetId, item]) => [assetId, item.bytes]),
    );
    const result = await storage.commitWorkspace({
      id,
      expectedRevision: revision,
      document,
      chunks: { project, assetIndex },
      assets: storedAssets,
    });
    return { ...result, assetCount: assets.size };
  }

  async function load() {
    const stored = await storage.getWorkspace(id);
    if (!stored) return null;
    const document = stored.document;
    if (document?.kind !== 'director-project')
      fail(
        'invalid-project',
        'Stored Director project has an unknown document kind.',
      );
    if (document.schemaVersion !== DIRECTOR_PERSISTENCE_VERSION)
      fail(
        'unsupported-version',
        `Stored Director project version ${document.schemaVersion} is not supported.`,
      );
    const project = parseSceneDocument(JSON.stringify(stored.chunks?.project));
    const paths = pathsIn(project);
    const index = stored.chunks?.assetIndex;
    if (!index || typeof index !== 'object' || Array.isArray(index))
      fail('integrity', 'Stored Director asset index is missing.');
    const expectedPaths = new Set(paths.map(({ path }) => path));
    if (Object.keys(index).some((path) => !expectedPaths.has(path)))
      fail('integrity', 'Stored Director asset index contains unused entries.');
    const expectedRefs = new Map();
    for (const ref of document.assetRefs || []) {
      if (
        !ASSET_ID.test(ref?.id) ||
        ref.id !== `sha256-${ref.sha256}` ||
        !Number.isSafeInteger(ref.byteLength) ||
        ref.byteLength < 1 ||
        expectedRefs.has(ref.id)
      )
        fail('integrity', 'Stored Director asset reference is invalid.');
      expectedRefs.set(ref.id, ref);
    }
    const assets = new Map();
    const seenIds = new Set();
    for (const { path, pack } of paths) {
      const ref = index[path];
      if (!ref || !ASSET_ID.test(ref.id))
        fail('missing-asset', `Saved scene asset is missing: ${path}.`);
      const declared = expectedRefs.get(ref.id);
      const bytes = asBytes(stored.assets?.[ref.id]);
      validateMime(ref.mimeType);
      if (!declared || !bytes)
        fail('missing-asset', `Saved scene asset is missing: ${path}.`);
      const digest = await sha256(bytes, cryptoRef);
      if (
        digest !== declared.sha256 ||
        digest !== ref.id.slice('sha256-'.length) ||
        bytes.byteLength !== declared.byteLength ||
        (pack.byteLength != null && pack.byteLength !== bytes.byteLength) ||
        (pack.sha256 != null && pack.sha256 !== digest)
      )
        fail(
          'integrity',
          `Saved scene asset failed its integrity check: ${path}.`,
        );
      seenIds.add(ref.id);
      assets.set(path, {
        bytes,
        mimeType: ref.mimeType,
        sha256: digest,
      });
    }
    if (
      seenIds.size !== expectedRefs.size ||
      Object.keys(index).length !== expectedPaths.size
    )
      fail(
        'integrity',
        'Stored Director asset references do not match the scene.',
      );
    return {
      project,
      assets,
      revision: stored.manifest?.revision || 0,
      saved: stored.saved === true,
    };
  }

  return Object.freeze({ save, load });
}
