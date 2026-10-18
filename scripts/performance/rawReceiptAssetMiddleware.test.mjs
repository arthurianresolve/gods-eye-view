import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  installRawReceiptAssetMiddleware,
  RAW_RECEIPT_ASSET_MAX_BYTES,
} from './rawReceiptAssetMiddleware.mjs';

function response() {
  const body = new PassThrough();
  const headers = new Map();
  body.headersSent = false;
  body.setHeader = (name, value) =>
    headers.set(name.toLowerCase(), String(value));
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
  const source = Buffer.from('raw receipt sidecar fixture payload');
  const bytes = brotliCompressSync(source);
  const gzip = gzipSync(source);
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets', 'main.js.br'), bytes);
  await fs.writeFile(path.join(root, 'assets', 'main.js.gz'), gzip);
  const handlers = [];
  installRawReceiptAssetMiddleware({
    buildRoot: root,
    receipt: {
      assets: [
        { path: 'assets/main.js.br', bytes: bytes.length },
        { path: 'assets/main.js.gz', bytes: gzip.length },
      ],
    },
    middlewares: {
      use(handler) {
        handlers.push(handler);
      },
    },
  });
  return { root, bytes, gzip, handler: handlers[0] };
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

test('HEAD and loopback HTTP preserve compressed bytes for both sidecar encodings', async (t) => {
  const { bytes, gzip, handler } = await setup(t);
  const server = createServer((req, res) => {
    if (/\.(br|gz)$/.test(req.url)) res.setHeader('content-encoding', 'gzip');
    res.setHeader('x-unchanged', 'fixture');
    handler(req, res, () => {
      res.setHeader('content-type', 'text/plain');
      res.end('ordinary-asset');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const head = await fetch(`http://127.0.0.1:${port}/assets/main.js.br`, {
    method: 'HEAD',
  });
  assert.equal(head.status, 200);
  assert.equal(await head.arrayBuffer().then((value) => value.byteLength), 0);
  assert.equal(head.headers.get('content-encoding'), null);
  const get = await fetch(`http://127.0.0.1:${port}/assets/main.js.br`);
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
  assert.equal(get.headers.get('content-encoding'), null);
  const gzipGet = await fetch(`http://127.0.0.1:${port}/assets/main.js.gz`);
  assert.deepEqual(Buffer.from(await gzipGet.arrayBuffer()), gzip);
  assert.equal(gzipGet.headers.get('content-encoding'), null);
  const normal = await fetch(`http://127.0.0.1:${port}/assets/main.js`);
  assert.equal(normal.headers.get('x-unchanged'), 'fixture');
  assert.equal(normal.headers.get('content-type'), 'text/plain');
  assert.equal(await normal.text(), 'ordinary-asset');
});

test('normal assets fall through and unknown/traversal/non-GET sidecars are bounded', async (t) => {
  const { handler } = await setup(t);
  let passed = false;
  await handler({ method: 'GET', url: '/assets/main.js' }, {}, () => {
    passed = true;
  });
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

test('empty sidecar receipts are a no-op', async () => {
  const handlers = {
    use() {
      throw new Error('must not install');
    },
  };
  const result = installRawReceiptAssetMiddleware({
    buildRoot: path.resolve('.'),
    receipt: { assets: [] },
    middlewares: handlers,
  });
  assert.deepEqual(result.allowedPaths, []);
  assert.equal(result.installed, false);
});
