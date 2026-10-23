import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STREAMED_TILE_PATHS = Object.freeze({
  manifest: '/qa/s57-streaming/tileset.json',
  content: '/qa/s57-streaming/tile.glb',
});

const MAX_REQUESTS = 32;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export async function readStreamedTileFixtureAssets() {
  const manifestBytes = await readFile(
    path.join(ROOT, 'public', STREAMED_TILE_PATHS.manifest.slice(1)),
  );
  const contentBytes = await readFile(
    path.join(ROOT, 'public', STREAMED_TILE_PATHS.content.slice(1)),
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.asset?.version !== '1.1' ||
    manifest.root?.content?.uri !== 'tile.glb' ||
    !Array.isArray(manifest.root?.transform) ||
    manifest.root.transform.length !== 16 ||
    !manifest.root.transform.every(Number.isFinite)
  )
    throw new Error('Streamed tile fixture manifest identity is invalid.');
  if (
    contentBytes.length < 20 ||
    contentBytes.readUInt32LE(0) !== 0x46546c67 ||
    contentBytes.readUInt32LE(4) !== 2 ||
    contentBytes.readUInt32LE(8) !== contentBytes.length
  )
    throw new Error('Streamed tile fixture GLB identity is invalid.');
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  return {
    fixtureId: 's57-local-http-3dtiles-v1',
    manifest: {
      path: STREAMED_TILE_PATHS.manifest,
      sha256: digest(manifestBytes),
      byteLength: manifestBytes.length,
    },
    content: {
      path: STREAMED_TILE_PATHS.content,
      sha256: digest(contentBytes),
      byteLength: contentBytes.length,
    },
  };
}

function pathKind(url, origin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return null;
    return (
      Object.entries(STREAMED_TILE_PATHS).find(
        ([, path]) => parsed.pathname === path,
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
}

export function createStreamedTileNetworkEvidence({
  origin = 'http://127.0.0.1:4174',
  maxRequests = MAX_REQUESTS,
} = {}) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 64)
    throw new RangeError('Streamed-tile request bound is invalid.');
  const pending = new Map();
  const records = [];
  const counts = Object.fromEntries(
    Object.keys(STREAMED_TILE_PATHS).map((kind) => [
      kind,
      {
        requests: 0,
        responses: 0,
        completed: 0,
        failed: 0,
        servedFromCache: 0,
      },
    ]),
  );
  let overflowCount = 0;

  function requestWillBeSent({ requestId, request }) {
    const kind = pathKind(request?.url, origin);
    if (!kind || typeof requestId !== 'string' || !requestId) return;
    counts[kind].requests++;
    const record = {
      kind,
      method: request.method === 'GET' ? 'GET' : 'other',
      status: null,
      fromDiskCache: null,
      fromServiceWorker: null,
      fromPrefetchCache: null,
      servedFromCache: false,
      encodedDataLength: null,
      failure: false,
      failureClass: null,
      failureCode: null,
      canceled: null,
    };
    if (records.length >= maxRequests || pending.size >= maxRequests) {
      overflowCount++;
      return;
    }
    records.push(record);
    pending.set(requestId, record);
  }

  function responseReceived({ requestId, response }) {
    const record = pending.get(requestId);
    if (!record) return;
    counts[record.kind].responses++;
    record.status = Number.isSafeInteger(response?.status)
      ? response.status
      : null;
    record.fromDiskCache =
      typeof response?.fromDiskCache === 'boolean'
        ? response.fromDiskCache
        : null;
    record.fromServiceWorker =
      typeof response?.fromServiceWorker === 'boolean'
        ? response.fromServiceWorker
        : null;
    record.fromPrefetchCache =
      typeof response?.fromPrefetchCache === 'boolean'
        ? response.fromPrefetchCache
        : null;
  }

  function requestServedFromCache({ requestId }) {
    const record = pending.get(requestId);
    if (!record) return;
    if (!record.servedFromCache) counts[record.kind].servedFromCache++;
    record.servedFromCache = true;
  }

  function loadingFinished({ requestId, encodedDataLength }) {
    const record = pending.get(requestId);
    if (!record) return;
    counts[record.kind].completed++;
    record.encodedDataLength =
      Number.isFinite(encodedDataLength) && encodedDataLength >= 0
        ? encodedDataLength
        : null;
    pending.delete(requestId);
  }

  function loadingFailed(event = {}) {
    const { requestId } = event;
    const record = pending.get(requestId);
    if (!record) return;
    counts[record.kind].failed++;
    record.failure = true;
    const errorText =
      typeof event.errorText === 'string' ? event.errorText : '';
    const failureCode =
      errorText === 'net::ERR_ABORTED'
        ? 'ERR_ABORTED'
        : errorText === 'net::ERR_CANCELED'
          ? 'ERR_CANCELED'
          : errorText === 'net::ERR_FAILED'
            ? 'ERR_FAILED'
            : errorText === 'net::ERR_CONNECTION_RESET'
              ? 'ERR_CONNECTION_RESET'
              : errorText === 'net::ERR_TIMED_OUT'
                ? 'ERR_TIMED_OUT'
                : 'other';
    record.canceled =
      typeof event.canceled === 'boolean' ? event.canceled : null;
    record.failureCode = failureCode;
    record.failureClass =
      failureCode === 'ERR_ABORTED' || failureCode === 'ERR_CANCELED'
        ? 'cancellation'
        : 'error';
    pending.delete(requestId);
  }

  function attach(client) {
    client.on('Network.requestWillBeSent', requestWillBeSent);
    client.on('Network.responseReceived', responseReceived);
    client.on('Network.requestServedFromCache', requestServedFromCache);
    client.on('Network.loadingFinished', loadingFinished);
    client.on('Network.loadingFailed', loadingFailed);
    return () => {
      client.off('Network.requestWillBeSent', requestWillBeSent);
      client.off('Network.responseReceived', responseReceived);
      client.off('Network.requestServedFromCache', requestServedFromCache);
      client.off('Network.loadingFinished', loadingFinished);
      client.off('Network.loadingFailed', loadingFailed);
    };
  }

  function snapshot() {
    return {
      origin: 'fixture-origin-only',
      counts: structuredClone(counts),
      requests: records.map((record) => ({ ...record })),
      overflowCount,
      pendingCount: pending.size,
    };
  }

  return { attach, snapshot };
}

export function installStreamedTileServerEvidence(httpServer) {
  if (!httpServer?.on || !httpServer?.off)
    throw new TypeError('A Node HTTP server is required.');
  const counts = Object.fromEntries(
    Object.keys(STREAMED_TILE_PATHS).map((kind) => [
      kind,
      { requests: 0, responses: 0, successfulResponses: 0, bytesFromHeader: 0 },
    ]),
  );
  const finishListeners = new Map();
  let overflowCount = 0;
  const onRequest = (request, response) => {
    const pathname = String(request.url || '').split('?', 1)[0];
    const kind = Object.entries(STREAMED_TILE_PATHS).find(
      ([, path]) => pathname === path,
    )?.[0];
    if (!kind) return;
    counts[kind].requests++;
    if (finishListeners.size >= MAX_REQUESTS) {
      overflowCount++;
      return;
    }
    const onFinish = () => {
      finishListeners.delete(response);
      counts[kind].responses++;
      const status = Number(response.statusCode);
      if (status >= 200 && status < 300) counts[kind].successfulResponses++;
      const length = Number(response.getHeader?.('content-length'));
      if (Number.isSafeInteger(length) && length >= 0)
        counts[kind].bytesFromHeader += length;
    };
    const prior = finishListeners.get(response);
    if (prior) response.off('finish', prior);
    finishListeners.set(response, onFinish);
    response.once('finish', onFinish);
  };
  httpServer.on('request', onRequest);
  let removed = false;
  return {
    snapshot() {
      return {
        source: 'local-http-server-request-events',
        counts: structuredClone(counts),
        overflowCount,
        pendingCount: finishListeners.size,
      };
    },
    cleanup() {
      if (removed) return false;
      removed = true;
      httpServer.off('request', onRequest);
      for (const [response, listener] of finishListeners)
        response.off('finish', listener);
      finishListeners.clear();
      return true;
    },
  };
}
