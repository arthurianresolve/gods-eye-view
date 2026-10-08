import {
  cloneJson,
  payloadBytes,
  sha256,
  stableJson,
} from '../storage/codec.js';
import {
  MAX_WORKSPACE_ASSET_REFS,
  parseWorkspaceDocument,
} from './document.js';

export const WORKSPACE_BUNDLE_FORMAT = 'gev-workspace-bundle';
export const WORKSPACE_BUNDLE_VERSION = 1;
export const MAX_WORKSPACE_BUNDLE_BYTES = 50 * 1024 * 1024;
export const MAX_WORKSPACE_BUNDLE_ASSET_BYTES = 32 * 1024 * 1024;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function encode(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

function decode(value) {
  if (
    typeof value !== 'string' ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value) ||
    (value.includes('=') && !/^[A-Za-z0-9+/]+={1,2}$/.test(value))
  )
    fail('invalid-bundle', 'Workspace asset encoding is invalid.');
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Serialize one verified workspace record, including its bytes, for local backup. */
export async function exportWorkspaceBundle(
  record,
  { crypto: cryptoRef = globalThis.crypto } = {},
) {
  const document = parseWorkspaceDocument(record?.document);
  const assets = [];
  let total = 0;
  for (const [name, value] of Object.entries(record.assets || {}).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const bytes = await payloadBytes(value);
    total += bytes.byteLength;
    if (!bytes.byteLength || total > MAX_WORKSPACE_BUNDLE_ASSET_BYTES)
      fail('workspace-too-large', 'Workspace bundle assets exceed 32 MiB.');
    assets.push({
      name,
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes, cryptoRef),
      base64: encode(bytes),
    });
  }
  const payload = {
    format: WORKSPACE_BUNDLE_FORMAT,
    version: WORKSPACE_BUNDLE_VERSION,
    document,
    chunks: cloneJson(record.chunks || {}),
    assets,
  };
  const text = stableJson(payload);
  if (new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_BUNDLE_BYTES)
    fail('workspace-too-large', 'Workspace export exceeds 50 MiB.');
  await parseWorkspaceBundle(text, { crypto: cryptoRef });
  return text;
}

/** Parse an inert workspace backup and verify every included asset before admission. */
export async function parseWorkspaceBundle(
  input,
  { crypto: cryptoRef = globalThis.crypto } = {},
) {
  let value = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_WORKSPACE_BUNDLE_BYTES)
      fail('workspace-too-large', 'Workspace bundle exceeds 50 MiB.');
    try {
      value = JSON.parse(input);
    } catch {
      fail('invalid-bundle', 'Workspace bundle is not valid JSON.');
    }
  } else {
    try {
      if (
        new TextEncoder().encode(stableJson(input)).byteLength >
        MAX_WORKSPACE_BUNDLE_BYTES
      )
        fail('workspace-too-large', 'Workspace bundle exceeds 50 MiB.');
    } catch (error) {
      if (error?.code) throw error;
      fail('invalid-bundle', 'Workspace bundle must contain plain JSON data.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('invalid-bundle', 'Workspace bundle must be an object.');
  if (
    Object.keys(value).some(
      (key) =>
        !['format', 'version', 'document', 'chunks', 'assets'].includes(key),
    ) ||
    value.format !== WORKSPACE_BUNDLE_FORMAT ||
    value.version !== WORKSPACE_BUNDLE_VERSION
  )
    fail('unsupported-version', 'Workspace bundle format is not supported.');
  const document = parseWorkspaceDocument(value.document);
  if (
    !value.chunks ||
    typeof value.chunks !== 'object' ||
    Array.isArray(value.chunks)
  )
    fail('invalid-bundle', 'Workspace bundle chunks must be an object.');
  if (
    !Array.isArray(value.assets) ||
    value.assets.length > MAX_WORKSPACE_ASSET_REFS
  )
    fail('invalid-bundle', 'Workspace bundle assets must be a list.');
  const assets = {};
  let total = 0;
  for (const entry of value.assets) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).some(
        (key) => !['name', 'byteLength', 'sha256', 'base64'].includes(key),
      ) ||
      typeof entry.name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 1 ||
      Object.hasOwn(assets, entry.name)
    )
      fail('invalid-bundle', 'Workspace asset reference is invalid.');
    const bytes = decode(entry.base64);
    total += bytes.byteLength;
    if (
      bytes.byteLength !== entry.byteLength ||
      total > MAX_WORKSPACE_BUNDLE_ASSET_BYTES ||
      (await sha256(bytes, cryptoRef)) !== entry.sha256
    )
      fail('integrity', `Workspace asset failed verification: ${entry.name}.`);
    assets[entry.name] = bytes;
  }
  const refs = new Map((document.assetRefs || []).map((ref) => [ref.id, ref]));
  if (refs.size !== Object.keys(assets).length)
    fail(
      'integrity',
      'Workspace bundle asset references do not match its assets.',
    );
  for (const [name, bytes] of Object.entries(assets)) {
    const ref = refs.get(name);
    if (
      !ref ||
      ref.byteLength !== bytes.byteLength ||
      ref.sha256 !== (await sha256(bytes, cryptoRef))
    )
      fail('integrity', `Workspace asset reference does not match: ${name}.`);
  }
  return {
    document,
    chunks: cloneJson(value.chunks),
    assets,
  };
}
