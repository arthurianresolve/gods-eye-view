import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createStreamedTileNetworkEvidence,
  installStreamedTileServerEvidence,
  readStreamedTileFixtureAssets,
  STREAMED_TILE_PATHS,
} from './streamedTileNetworkEvidence.mjs';

test('local streamed tile assets have bounded, hashable manifest and GLB identity', async () => {
  const assets = await readStreamedTileFixtureAssets();
  assert.equal(assets.fixtureId, 's57-local-http-3dtiles-v1');
  assert.deepEqual(assets.manifest.path, STREAMED_TILE_PATHS.manifest);
  assert.deepEqual(assets.content.path, STREAMED_TILE_PATHS.content);
  assert.match(assets.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.match(assets.content.sha256, /^[a-f0-9]{64}$/);
  assert.ok(assets.manifest.byteLength > 100);
  assert.ok(assets.content.byteLength > 20);
});

test('browser evidence separates manifest/content delivery and cache attribution', () => {
  const client = new EventEmitter();
  const observer = createStreamedTileNetworkEvidence();
  const cleanup = observer.attach(client);
  client.emit('Network.requestWillBeSent', {
    requestId: 'manifest-1',
    request: {
      url: `http://127.0.0.1:4174${STREAMED_TILE_PATHS.manifest}`,
      method: 'GET',
    },
  });
  client.emit('Network.responseReceived', {
    requestId: 'manifest-1',
    response: {
      status: 200,
      fromDiskCache: false,
      fromServiceWorker: false,
      fromPrefetchCache: false,
    },
  });
  client.emit('Network.loadingFinished', {
    requestId: 'manifest-1',
    encodedDataLength: 249,
  });
  client.emit('Network.requestWillBeSent', {
    requestId: 'content-1',
    request: {
      url: `http://127.0.0.1:4174${STREAMED_TILE_PATHS.content}`,
      method: 'GET',
    },
  });
  client.emit('Network.requestServedFromCache', { requestId: 'content-1' });
  client.emit('Network.responseReceived', {
    requestId: 'content-1',
    response: {
      status: 200,
      fromDiskCache: true,
      fromServiceWorker: false,
      fromPrefetchCache: false,
    },
  });
  client.emit('Network.loadingFinished', {
    requestId: 'content-1',
    encodedDataLength: 960,
  });
  client.emit('Network.requestWillBeSent', {
    requestId: 'external',
    request: { url: 'https://provider.invalid/tileset.json', method: 'GET' },
  });
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.counts.manifest, {
    requests: 1,
    responses: 1,
    completed: 1,
    failed: 0,
    servedFromCache: 0,
  });
  assert.deepEqual(snapshot.counts.content, {
    requests: 1,
    responses: 1,
    completed: 1,
    failed: 0,
    servedFromCache: 1,
  });
  assert.equal(snapshot.requests.length, 2);
  assert.equal(snapshot.requests[1].fromDiskCache, true);
  assert.equal(snapshot.pendingCount, 0);
  assert.equal(snapshot.overflowCount, 0);
  cleanup();
  assert.equal(client.listenerCount('Network.requestWillBeSent'), 0);
});

test('browser request observer has a global bounded record and pending inventory', () => {
  const client = new EventEmitter();
  const observer = createStreamedTileNetworkEvidence({ maxRequests: 1 });
  observer.attach(client);
  for (const requestId of ['first', 'overflow'])
    client.emit('Network.requestWillBeSent', {
      requestId,
      request: {
        url: `http://127.0.0.1:4174${STREAMED_TILE_PATHS.content}`,
        method: 'GET',
      },
    });
  const snapshot = observer.snapshot();
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.pendingCount, 1);
  assert.equal(snapshot.overflowCount, 1);
  assert.equal(snapshot.counts.content.requests, 2);
});

test('browser observer records explicit cancellation separately from request errors', () => {
  const client = new EventEmitter();
  const observer = createStreamedTileNetworkEvidence();
  observer.attach(client);
  for (const [requestId, errorText, canceled] of [
    ['content-cancel', 'net::ERR_ABORTED', true],
    ['content-error', 'net::ERR_CONNECTION_RESET', false],
    ['content-contradictory-error', 'net::ERR_CONNECTION_RESET', true],
  ]) {
    client.emit('Network.requestWillBeSent', {
      requestId,
      request: {
        url: `http://127.0.0.1:4174${STREAMED_TILE_PATHS.content}`,
        method: 'GET',
      },
    });
    client.emit('Network.loadingFailed', {
      requestId,
      errorText,
      canceled,
    });
  }
  const requests = observer.snapshot().requests;
  assert.deepEqual(
    requests.map(({ failureClass, failureCode, canceled }) => ({
      failureClass,
      failureCode,
      canceled,
    })),
    [
      {
        failureClass: 'cancellation',
        failureCode: 'ERR_ABORTED',
        canceled: true,
      },
      {
        failureClass: 'error',
        failureCode: 'ERR_CONNECTION_RESET',
        canceled: false,
      },
      {
        failureClass: 'error',
        failureCode: 'ERR_CONNECTION_RESET',
        canceled: true,
      },
    ],
  );
});

test('server evidence only counts exact local streamed asset paths and confirms cleanup', () => {
  const server = new EventEmitter();
  const observer = installStreamedTileServerEvidence(server);
  const response = (length) => {
    const value = new EventEmitter();
    value.statusCode = 200;
    value.getHeader = (name) =>
      name === 'content-length' ? String(length) : undefined;
    return value;
  };
  const manifest = response(249);
  server.emit(
    'request',
    { url: `${STREAMED_TILE_PATHS.manifest}?cache=none` },
    manifest,
  );
  manifest.emit('finish');
  const content = response(960);
  server.emit('request', { url: STREAMED_TILE_PATHS.content }, content);
  content.emit('finish');
  server.emit('request', { url: '/assets/fixture.js' }, response(10));
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.counts.manifest, {
    requests: 1,
    responses: 1,
    successfulResponses: 1,
    bytesFromHeader: 249,
  });
  assert.deepEqual(snapshot.counts.content, {
    requests: 1,
    responses: 1,
    successfulResponses: 1,
    bytesFromHeader: 960,
  });
  assert.equal(observer.cleanup(), true);
  assert.equal(observer.cleanup(), false);
  assert.equal(server.listenerCount('request'), 0);
});

test('server cleanup removes pending per-response finish observations', () => {
  const server = new EventEmitter();
  const observer = installStreamedTileServerEvidence(server);
  const response = new EventEmitter();
  response.statusCode = 200;
  response.getHeader = () => '960';
  server.emit('request', { url: STREAMED_TILE_PATHS.content }, response);
  assert.equal(response.listenerCount('finish'), 1);
  assert.equal(observer.cleanup(), true);
  assert.equal(response.listenerCount('finish'), 0);
  response.emit('finish');
  assert.deepEqual(observer.snapshot().counts.content, {
    requests: 1,
    responses: 0,
    successfulResponses: 0,
    bytesFromHeader: 0,
  });
});

test('server listener inventory remains bounded under excess asset requests', () => {
  const server = new EventEmitter();
  const observer = installStreamedTileServerEvidence(server);
  const responses = [];
  for (let index = 0; index < 36; index++) {
    const response = new EventEmitter();
    response.statusCode = 200;
    response.getHeader = () => '960';
    responses.push(response);
    server.emit('request', { url: STREAMED_TILE_PATHS.content }, response);
  }
  const snapshot = observer.snapshot();
  assert.equal(snapshot.pendingCount, 32);
  assert.equal(snapshot.overflowCount, 4);
  assert.equal(snapshot.counts.content.requests, 36);
  assert.equal(observer.cleanup(), true);
  assert.ok(
    responses.every((response) => response.listenerCount('finish') === 0),
  );
});
