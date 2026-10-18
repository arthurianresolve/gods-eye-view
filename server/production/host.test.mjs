import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStaticHandler, loadOperatorEnv } from './host.js';
import http from 'node:http';

function request(server, headers = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ host: address.address, port: address.port, headers, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('production static handler serves encoded assets and revalidates HTML', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.tmp-host-'));
  await writeFile(path.join(root, 'index.html'), '<h1>ok</h1>');
  await writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify({ assets: [{ path: 'index.html', sha256: 'abc', cache: 'revalidate' }] }));
  const server = http.createServer((req, res) => createStaticHandler({ root })(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await request(server);
    assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-cache');
    const cached = await request(server, { 'if-none-match': '"abc"' });
    assert.equal(cached.status, 304);
    const ranged = await request(server, { range: 'bytes=0-2' });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers['content-range'], 'bytes 0-2/11');
    assert.equal(ranged.body.toString(), '<h1');
    const suffix = await request(server, { range: 'bytes=-3' });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.body.toString(), 'h1>');
    const notAcceptable = await request(server, { 'accept-encoding': 'identity;q=0' });
    assert.equal(notAcceptable.status, 406);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('operator dotenv parsing preserves quotes and host precedence', async () => {
  const root = await mkdtemp(path.join(process.env.TEMP || process.cwd(), 'gev-host-env-'));
  const previous = process.env.GEV_TEST_OPERATOR;
  process.env.GEV_TEST_OPERATOR = 'process-value';
  await writeFile(path.join(root, '.env'), "GEV_TEST_OPERATOR=dotenv-value\nGEV_TEST_QUOTED=\"hello world\" # comment\n");
  try {
    await loadOperatorEnv(root);
    assert.equal(process.env.GEV_TEST_OPERATOR, 'process-value');
    assert.equal(process.env.GEV_TEST_QUOTED, 'hello world');
  } finally {
    if (previous === undefined) delete process.env.GEV_TEST_OPERATOR;
    else process.env.GEV_TEST_OPERATOR = previous;
    delete process.env.GEV_TEST_QUOTED;
    await rm(root, { recursive: true, force: true });
  }
});

test('static handler rejects traversal and previous roots only serve immutable manifest assets', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.tmp-host-'));
  const previous = await mkdtemp(path.join(process.cwd(), '.tmp-host-prev-'));
  await writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify({ assets: [] }));
  await writeFile(path.join(previous, 'old.js'), 'old');
  await writeFile(path.join(previous, 'asset-manifest.json'), JSON.stringify({ assets: [{ path: 'old.js', cache: 'immutable', sha256: 'old' }] }));
  const server = http.createServer((req, res) => createStaticHandler({ root, previousRoots: [previous] })(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const old = await request(server, {});
    assert.equal(old.status, 404);
    const traversal = await new Promise((resolve, reject) => {
      const req = http.request({ ...server.address(), path: '/%2e%2e/%2e%2e/etc/passwd' }, (res) => resolve(res.statusCode));
      req.on('error', reject); req.end();
    });
    assert.equal(traversal, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
  }
});
