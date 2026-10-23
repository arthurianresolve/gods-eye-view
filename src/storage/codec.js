export const DEFAULT_WORKSPACE_DB = 'gods-eye-view-workspaces';
export const WORKSPACE_SCHEMA_VERSION = 1;

export class WorkspaceStorageError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'WorkspaceStorageError';
    this.code = code;
  }
}

export class WorkspaceRevisionConflict extends WorkspaceStorageError {
  constructor(id, expected, actual) {
    super(
      'revision-conflict',
      `Workspace ${id} changed from revision ${expected} to ${actual}`,
    );
    this.name = 'WorkspaceRevisionConflict';
    this.workspaceId = id;
    this.expectedRevision = expected;
    this.actualRevision = actual;
  }
}

export function validateWorkspaceId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
    throw new WorkspaceStorageError('invalid-id', 'Invalid workspace id');
  return id;
}

export function validateRecordName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name))
    throw new WorkspaceStorageError(
      'invalid-record-name',
      'Invalid record name',
    );
  return name;
}

function normalizeJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new WorkspaceStorageError(
        'invalid-data',
        'Non-finite numbers are not supported',
      );
    return value;
  }
  if (typeof value !== 'object')
    throw new WorkspaceStorageError(
      'invalid-data',
      'Workspace data must be JSON-compatible',
    );
  if (seen.has(value))
    throw new WorkspaceStorageError(
      'invalid-data',
      'Circular workspace data is not supported',
    );
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map((item) => normalizeJson(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new WorkspaceStorageError(
        'invalid-data',
        'Workspace documents must contain plain objects',
      );
    output = Object.create(null);
    for (const key of Object.keys(value).sort())
      output[key] = normalizeJson(value[key], seen);
  }
  seen.delete(value);
  return output;
}

export function stableJson(value) {
  return JSON.stringify(normalizeJson(value));
}

export function cloneJson(value) {
  return JSON.parse(stableJson(value));
}

export async function payloadBytes(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value))
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  return new TextEncoder().encode(stableJson(value));
}

export async function sha256(value, cryptoRef = globalThis.crypto) {
  if (!cryptoRef?.subtle?.digest)
    throw new WorkspaceStorageError(
      'crypto-unavailable',
      'SHA-256 is not available in this browser',
    );
  const digest = new Uint8Array(
    await cryptoRef.subtle.digest('SHA-256', await payloadBytes(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function revisionKey(id, revision) {
  return `${encodeURIComponent(id)}:${revision}`;
}

export function contentKey(id, revision, name) {
  return `${encodeURIComponent(id)}:${revision}:${encodeURIComponent(name)}`;
}

export function storageError(error, fallback = 'transaction') {
  if (error instanceof WorkspaceStorageError) return error;
  if (error?.name === 'QuotaExceededError')
    return new WorkspaceStorageError(
      'quota',
      'Browser storage quota was exceeded',
      { cause: error },
    );
  return new WorkspaceStorageError(
    fallback,
    error?.message || 'Workspace storage operation failed',
    { cause: error },
  );
}
