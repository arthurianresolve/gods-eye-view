import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  installRawReceiptAssetMiddleware,
  RAW_RECEIPT_ASSET_MAX_BYTES,
} from './rawReceiptAssetMiddleware.mjs';

function response() {
  const body = new PassThrough();
  const headers = new Map();
  body.headersSent = false;
  body.setHeader = (name, value) => headers.set(name.toLowerCase(), String(value));
  body.end = (value = '') => {
    body.headersSent = true;
    if (value) body.write(value);
    body.emit('finish');
    body.endOriginal();
  };
  body.endOriginal = PassThrough.prototype.end.bind(body);
  return { body, headers };
}

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-raw-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from([0, 1, 2, 3, 4, 5]);
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets', 'main.js.br'), bytes);
  const handlers = [];
  installRawReceiptAssetMiddleware({
    buildRoot: root,
    receipt: { assets: [{ path: 'assets/main.js.br', bytes: bytes.length }] },
    middlewares: { use(handler) { handlers.push(handler); } },
  });
  return { root, bytes, handler: handlers[0] };
}

test('raw receipt sidecar serves exact Brotli bytes without content encoding', async (t) => {
  const { bytes, handler } = await setup(t);
  const { body, headers } = response();
  const chunks = [];
  body.on('data', (chunk) => chunks.push(chunk));
  await new Promise((resolve, reject) => {
    body.once('finish', resolve);
    handler({ method: 'GET', url: '/assets/main.js.br' }, body, reject);
  });
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(headers.get('content-encoding'), undefined);
  assert.equal(headers.get('content-type'), 'application/octet-stream');
});

test('normal assets fall through and unknown/traversal/non-GET sidecars are bounded', async (t) => {
  const { handler } = await setup(t);
  let passed = false;
  await handler({ method: 'GET', url: '/assets/main.js' }, {}, () => { passed = true; });
  assert.equal(passed, true);
  for (const request of [
    { method: 'GET', url: '/assets/missing.js.br' },
    { method: 'GET', url: '/assets/../main.js.br' },
    { method: 'POST', url: '/assets/main.js.br' },
  ]) {
    const { body } = response();
    await new Promise((resolve) => {
      body.once('finish', resolve);
      handler(request, body, resolve);
    });
    assert.ok(body.statusCode === 404 || body.statusCode === 405);
  }
});

test('sidecar bound is finite and explicit', () => {
  assert.equal(RAW_RECEIPT_ASSET_MAX_BYTES, 64 * 1024 * 1024);
});
