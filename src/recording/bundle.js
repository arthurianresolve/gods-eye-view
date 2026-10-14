import { sha256, stableJson, validateWorkspaceId } from '../storage/codec.js';

export const RECORDING_BUNDLE_FORMAT = 'gods-eye-view-recording-bundle';
export const RECORDING_BUNDLE_VERSION = 1;
export const MAX_RECORDING_BUNDLE_BYTES = 120 * 1024 * 1024;

const RECORDING_FORMATS = Object.freeze({
  'gods-eye-view-aircraft-recording': 'aircraft-recording',
  'gods-eye-view-vessel-recording': 'vessel-recording',
});
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const encoder = new TextEncoder();

function byteBudget(value) {
  const requested = Number(value);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_RECORDING_BUNDLE_BYTES, Math.floor(requested))
    : MAX_RECORDING_BUNDLE_BYTES;
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function jsonBytes(value) {
  return encoder.encode(stableJson(value)).byteLength;
}

function entriesOf(chunks) {
  return chunks instanceof Map ? [...chunks] : Object.entries(chunks || {});
}

function validateRecording(recording) {
  const format = recording?.format;
  const kind = RECORDING_FORMATS[format];
  if (!kind || recording?.schemaVersion !== 1)
    fail('unsupported-recording', 'Unsupported recording format or version.');
  const document = recording.document;
  if (
    !document ||
    typeof document !== 'object' ||
    document.kind !== kind ||
    typeof document.id !== 'string' ||
    !document.sourcePolicy?.policyId ||
    document.sourcePolicy.retentionAllowed !== true ||
    document.sourcePolicy.exportAllowed !== true ||
    !['complete', 'interrupted'].includes(document.status)
  )
    fail(
      'recording-policy',
      'This recording is incomplete or its source policy does not allow export.',
    );
  return { kind, document };
}

function rootPayload(document, chunks) {
  return {
    format: RECORDING_BUNDLE_FORMAT,
    version: RECORDING_BUNDLE_VERSION,
    document,
    chunks: chunks.map(({ name, bytes, sha256: checksum }) => ({
      name,
      bytes,
      sha256: checksum,
    })),
  };
}

/** Validate and checksum a normalized aircraft or vessel recording export. */
export async function createRecordingBundle(
  recording,
  {
    crypto: cryptoRef = globalThis.crypto,
    maxBytes = MAX_RECORDING_BUNDLE_BYTES,
  } = {},
) {
  validateRecording(recording);
  const limit = byteBudget(maxBytes);
  const document = JSON.parse(stableJson(recording.document));
  const chunks = [];
  const names = new Set();
  let totalBytes = jsonBytes(document);
  if (totalBytes > limit)
    fail('recording-too-large', 'Recording bundle exceeds the 120 MiB limit.');
  for (const [name, value] of entriesOf(recording.chunks)) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || names.has(name))
      fail(
        'invalid-recording',
        'Recording has an invalid or duplicate chunk name.',
      );
    names.add(name);
    const normalized = JSON.parse(stableJson(value));
    const bytes = jsonBytes(normalized);
    totalBytes += bytes;
    if (totalBytes > limit)
      fail(
        'recording-too-large',
        'Recording bundle exceeds the 120 MiB limit.',
      );
    chunks.push({
      name,
      bytes,
      sha256: await sha256(normalized, cryptoRef),
      value: normalized,
    });
  }
  chunks.sort((a, b) => a.name.localeCompare(b.name));
  const root = rootPayload(document, chunks);
  const manifest = Object.freeze({
    kind: recording.document.kind,
    sourceFormat: recording.format,
    schemaVersion: recording.schemaVersion,
    contentBytes: totalBytes,
    sha256: await sha256(root, cryptoRef),
  });
  return Object.freeze({
    format: RECORDING_BUNDLE_FORMAT,
    version: RECORDING_BUNDLE_VERSION,
    document,
    chunks: Object.freeze(chunks.map((entry) => Object.freeze(entry))),
    manifest,
  });
}

/** Demand-driven JSON stream; large observation chunks are emitted one at a time. */
export function recordingBundleStream(bundle) {
  if (
    bundle?.format !== RECORDING_BUNDLE_FORMAT ||
    bundle?.version !== RECORDING_BUNDLE_VERSION ||
    !bundle.manifest?.sha256
  )
    fail('invalid-bundle', 'A validated recording bundle is required.');
  const parts = (function* () {
    yield '{"format":';
    yield JSON.stringify(bundle.format);
    yield ',"version":1,"document":';
    yield stableJson(bundle.document);
    yield ',"chunks":[';
    for (let index = 0; index < bundle.chunks.length; index++) {
      if (index) yield ',';
      const { name, bytes, sha256: checksum, value } = bundle.chunks[index];
      yield `{"name":${JSON.stringify(name)},"bytes":${bytes},"sha256":${JSON.stringify(checksum)},"value":`;
      yield stableJson(value);
      yield '}';
    }
    yield '],"manifest":';
    yield stableJson(bundle.manifest);
    yield '}';
  })();
  const stream = globalThis.ReadableStream;
  if (typeof stream !== 'function')
    fail(
      'stream-unavailable',
      'Streaming export is unavailable in this browser.',
    );
  const textEncoder = new TextEncoder();
  return new stream({
    pull(controller) {
      try {
        const next = parts.next();
        if (next.done) controller.close();
        else controller.enqueue(textEncoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** Parse and verify a portable recording bundle before changing local storage. */
export async function parseRecordingBundle(
  input,
  {
    crypto: cryptoRef = globalThis.crypto,
    maxBytes = MAX_RECORDING_BUNDLE_BYTES,
  } = {},
) {
  const limit = byteBudget(maxBytes);
  let parsed = input;
  if (typeof input === 'string') {
    if (encoder.encode(input).byteLength > limit)
      fail(
        'recording-too-large',
        'Recording bundle exceeds the 120 MiB limit.',
      );
    try {
      parsed = JSON.parse(input);
    } catch {
      fail('invalid-bundle', 'Recording bundle is not valid JSON.');
    }
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > limit)
      fail(
        'recording-too-large',
        'Recording bundle exceeds the 120 MiB limit.',
      );
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(input),
      );
    } catch {
      fail('invalid-bundle', 'Recording bundle is not valid UTF-8 JSON.');
    }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some(
      (key) =>
        !['format', 'version', 'document', 'chunks', 'manifest'].includes(key),
    ) ||
    parsed.format !== RECORDING_BUNDLE_FORMAT ||
    parsed.version !== RECORDING_BUNDLE_VERSION ||
    !Array.isArray(parsed.chunks) ||
    parsed.chunks.length > 100_000
  )
    fail('unsupported-bundle', 'Unsupported or malformed recording bundle.');
  let serializedBytes;
  try {
    serializedBytes = jsonBytes(parsed);
  } catch {
    fail('invalid-bundle', 'Recording bundle contains unsupported data.');
  }
  if (serializedBytes > limit)
    fail('recording-too-large', 'Recording bundle exceeds the 120 MiB limit.');
  const manifestKeys = Object.keys(parsed.manifest || {}).sort();
  if (
    manifestKeys.join(',') !==
    'contentBytes,kind,schemaVersion,sha256,sourceFormat'
  )
    fail('invalid-bundle', 'Recording bundle manifest has unsupported fields.');
  const recording = {
    format: parsed.manifest?.sourceFormat,
    schemaVersion: parsed.manifest?.schemaVersion,
    document: parsed.document,
  };
  const { kind } = validateRecording(recording);
  if (parsed.manifest?.kind !== kind)
    fail('invalid-bundle', 'Recording manifest does not match its document.');
  const names = new Set();
  const chunks = {};
  let totalBytes = jsonBytes(parsed.document);
  const normalizedEntries = [];
  for (const entry of parsed.chunks) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).some(
        (key) => !['name', 'bytes', 'sha256', 'value'].includes(key),
      ) ||
      typeof entry.name !== 'string' ||
      !NAME_PATTERN.test(entry.name) ||
      names.has(entry.name) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      fail('invalid-bundle', 'Recording bundle contains an invalid chunk.');
    names.add(entry.name);
    const value = JSON.parse(stableJson(entry.value));
    const bytes = jsonBytes(value);
    if (
      bytes !== entry.bytes ||
      (await sha256(value, cryptoRef)) !== entry.sha256
    )
      fail('integrity', `Recording chunk ${entry.name} failed its checksum.`);
    totalBytes += bytes;
    if (totalBytes > limit)
      fail(
        'recording-too-large',
        'Recording bundle exceeds the 120 MiB limit.',
      );
    chunks[entry.name] = value;
    normalizedEntries.push({ ...entry, value });
  }
  normalizedEntries.sort((a, b) => a.name.localeCompare(b.name));
  if (
    parsed.manifest.contentBytes !== totalBytes ||
    !/^[a-f0-9]{64}$/.test(parsed.manifest.sha256) ||
    (await sha256(
      rootPayload(parsed.document, normalizedEntries),
      cryptoRef,
    )) !== parsed.manifest.sha256
  )
    fail('integrity', 'Recording bundle manifest failed its checksum.');
  return Object.freeze({
    format: parsed.manifest.sourceFormat,
    schemaVersion: parsed.manifest.schemaVersion,
    document: JSON.parse(stableJson(parsed.document)),
    chunks,
    byteLength: totalBytes,
    kind,
  });
}

/** Read a selected file only after checking its declared size. */
export async function readRecordingBundle(file, options) {
  const limit = byteBudget(options?.maxBytes);
  if (!file || !Number.isFinite(file.size) || file.size > limit)
    fail('recording-too-large', 'Recording bundle exceeds the 120 MiB limit.');
  return parseRecordingBundle(await file.text(), options);
}

/** Import a fully verified recording as a new, independent local workspace. */
export async function importRecordingBundle(
  input,
  {
    storage,
    id = null,
    idFactory = () =>
      `imported-recording-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    now = () => Date.now(),
    crypto: cryptoRef = globalThis.crypto,
  } = {},
) {
  if (typeof storage?.commitWorkspace !== 'function')
    throw new TypeError('Workspace storage is required to import a recording.');
  const recording = await parseRecordingBundle(input, { crypto: cryptoRef });
  const destinationId = validateWorkspaceId(id || idFactory());
  const document = {
    ...recording.document,
    id: destinationId,
    title: `${String(recording.document.title || recording.document.id).slice(0, 180)} (imported)`,
    importedAt: now(),
  };
  const saved = await storage.commitWorkspace({
    id: destinationId,
    expectedRevision: 0,
    document,
    chunks: recording.chunks,
    assets: {},
  });
  return Object.freeze({ ...saved, id: destinationId, kind: recording.kind });
}
