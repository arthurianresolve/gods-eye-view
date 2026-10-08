import {
  cloneJson,
  stableJson,
  validateWorkspaceId,
} from '../storage/codec.js';
import { createView } from '../view/index.js';
import { validateEvidenceReferences } from '../evidence/evidence.js';

export const WORKSPACE_DOCUMENT_KIND = 'investigation-workspace';
export const WORKSPACE_DOCUMENT_VERSION = 1;
export const MAX_WORKSPACE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_EVIDENCE_ITEMS = 500;
export const MAX_WORKSPACE_ASSET_REFS = 128;

const FIELDS = Object.freeze([
  'kind',
  'schemaVersion',
  'id',
  'revision',
  'title',
  'createdAt',
  'updatedAt',
  'view',
  'temporalSource',
  'filters',
  'pinnedEvidence',
  'annotations',
  'assetRefs',
  'directorProjectRef',
]);
const DIGEST = /^[a-f0-9]{64}$/;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function timestamp(value, fallback, label) {
  const result =
    value == null
      ? fallback
      : typeof value === 'number'
        ? value
        : Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0)
    fail('invalid-workspace', `${label} must be a valid UTC timestamp.`);
  return result;
}

function plainClone(value, label) {
  let normalized;
  try {
    normalized = cloneJson(value);
  } catch (error) {
    fail(
      'invalid-workspace',
      `${label} must contain plain JSON data: ${error.message}`,
    );
  }
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    Array.isArray(normalized)
  )
    fail('invalid-workspace', `${label} must be an object.`);
  return normalized;
}

function validateNestedEvidence(value, depth = 0) {
  if (value == null) return;
  if (depth > 24)
    fail('invalid-workspace', 'Evidence metadata is nested too deeply.');
  if (Array.isArray(value)) {
    for (const entry of value) validateNestedEvidence(entry, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (value.entityRef) {
    try {
      validateEvidenceReferences(value);
    } catch (error) {
      fail('invalid-workspace', error.message);
    }
  }
  if (value.evidence) {
    try {
      validateEvidenceReferences(value.evidence);
    } catch (error) {
      fail('invalid-workspace', error.message);
    }
  }
  for (const entry of Object.values(value))
    validateNestedEvidence(entry, depth + 1);
}

function normalizeEvidence(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_WORKSPACE_EVIDENCE_ITEMS)
    fail('invalid-workspace', 'Pinned evidence must be a bounded list.');
  const ids = new Set();
  return rows.map((row) => {
    const entry = plainClone(row, 'Pinned evidence');
    validateNestedEvidence(entry);
    const id = String(entry.id || '').trim();
    const sourceId = String(entry.sourceId || '').trim();
    if (!id || id.length > 256 || !sourceId || sourceId.length > 128)
      fail(
        'invalid-workspace',
        'Pinned evidence needs a stable ID and source.',
      );
    if (ids.has(id))
      fail('invalid-workspace', 'Pinned evidence IDs must be unique.');
    ids.add(id);
    entry.id = id;
    entry.sourceId = sourceId;
    entry.capturedAt = timestamp(entry.capturedAt, null, 'Evidence time');
    return entry;
  });
}

function normalizeAssetRefs(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_WORKSPACE_ASSET_REFS)
    fail('invalid-workspace', 'Asset references must be a bounded list.');
  const ids = new Set();
  return rows.map((row) => {
    const entry = plainClone(row, 'Asset reference');
    if (
      typeof entry.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id) ||
      !DIGEST.test(entry.sha256) ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      entry.byteLength > 50 * 1024 * 1024
    )
      fail(
        'invalid-workspace',
        'Asset reference has invalid identity or integrity metadata.',
      );
    if (ids.has(entry.id))
      fail('invalid-workspace', 'Asset reference IDs must be unique.');
    ids.add(entry.id);
    return {
      id: entry.id,
      sha256: entry.sha256,
      byteLength: entry.byteLength,
      ...(typeof entry.mimeType === 'string'
        ? { mimeType: entry.mimeType.slice(0, 100) }
        : {}),
    };
  });
}

/** Create a durable JSON-only workspace document from a validated canonical view. */
export function createWorkspaceDocument(
  input,
  { now = () => Date.now() } = {},
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('invalid-workspace', 'A workspace document object is required.');
  const id = validateWorkspaceId(input.id);
  const title = String(input.title || '').trim();
  if (!title || title.length > 160)
    fail('invalid-workspace', 'Workspace title must be 1 to 160 characters.');
  if (
    input.schemaVersion != null &&
    input.schemaVersion !== WORKSPACE_DOCUMENT_VERSION
  )
    fail(
      'unsupported-version',
      `Workspace schema version ${input.schemaVersion} is not supported.`,
    );
  const createdAt = timestamp(
    input.createdAt,
    timestamp(now(), null, 'Creation time'),
    'Creation time',
  );
  const updatedAt = timestamp(input.updatedAt, createdAt, 'Update time');
  if (updatedAt < createdAt)
    fail('invalid-workspace', 'Update time cannot precede creation time.');
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1)
    fail('invalid-workspace', 'Workspace revision must be a positive integer.');
  let view;
  try {
    view = createView(input.view || {});
  } catch (error) {
    fail('invalid-workspace', `Saved view is invalid: ${error.message}`);
  }
  const filters = plainClone(input.filters || {}, 'Workspace filters');
  if (Object.keys(filters).length > 64)
    fail('invalid-workspace', 'Workspace filters are too numerous.');
  const annotations = Array.isArray(input.annotations)
    ? cloneJson(input.annotations)
    : [...view.annotations];
  const canonicalView = createView({ ...view, annotations });
  const temporalSource = canonicalView.temporal?.source || 'live';
  const document = {
    kind: WORKSPACE_DOCUMENT_KIND,
    schemaVersion: WORKSPACE_DOCUMENT_VERSION,
    id,
    revision,
    title,
    createdAt,
    updatedAt,
    view: canonicalView,
    temporalSource,
    filters,
    pinnedEvidence: normalizeEvidence(input.pinnedEvidence || []),
    annotations: [...canonicalView.annotations],
    assetRefs: normalizeAssetRefs(input.assetRefs || []),
    directorProjectRef:
      input.directorProjectRef == null
        ? null
        : validateWorkspaceId(input.directorProjectRef),
  };
  const normalized = cloneJson(document);
  if (
    new TextEncoder().encode(stableJson(normalized)).byteLength >
    MAX_WORKSPACE_DOCUMENT_BYTES
  )
    fail('workspace-too-large', 'Workspace document exceeds the 10 MiB limit.');
  return Object.freeze(normalized);
}

/** Validate a saved workspace and migrate the original unversioned draft shape. */
export function parseWorkspaceDocument(input, options = {}) {
  let value = input;
  if (typeof input === 'string') {
    if (
      new TextEncoder().encode(input).byteLength > MAX_WORKSPACE_DOCUMENT_BYTES
    )
      fail(
        'workspace-too-large',
        'Workspace document exceeds the 10 MiB limit.',
      );
    try {
      value = JSON.parse(input);
    } catch {
      fail('invalid-workspace', 'Workspace document is not valid JSON.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('invalid-workspace', 'Workspace document must be an object.');
  if (value.schemaVersion === 0) {
    return createWorkspaceDocument(
      {
        id: value.id,
        title: value.title,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        view: value.view,
        filters: value.filters,
      },
      options,
    );
  }
  if (value.schemaVersion !== WORKSPACE_DOCUMENT_VERSION)
    fail(
      'unsupported-version',
      `Workspace schema version ${value.schemaVersion} is not supported.`,
    );
  if (value.kind !== WORKSPACE_DOCUMENT_KIND)
    fail('invalid-workspace', 'Document is not an investigation workspace.');
  if (Object.keys(value).some((key) => !FIELDS.includes(key)))
    fail(
      'invalid-workspace',
      'Workspace document contains unsupported fields.',
    );
  if (FIELDS.some((key) => !Object.hasOwn(value, key)))
    fail('invalid-workspace', 'Workspace document is missing required fields.');
  const document = createWorkspaceDocument(value, options);
  if (value.temporalSource !== document.temporalSource)
    fail(
      'invalid-workspace',
      'Workspace temporal source does not match its saved view.',
    );
  if (
    new TextEncoder().encode(stableJson(document)).byteLength >
    MAX_WORKSPACE_DOCUMENT_BYTES
  )
    fail('workspace-too-large', 'Workspace document exceeds the 10 MiB limit.');
  return document;
}
