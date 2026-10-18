import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createProductionServer, loadOperatorEnv } from './host.js';
import { writeAssetArtifacts } from '../../build/assetDistribution.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asset = 'assets/app-12345678.js';
async function fixture(
  t,
  files = {
    'index.html': '<main>app</main>',
    [asset]: 'export const value = 42;'.repeat(30),
  },
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gev-production-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
  }
  await writeAssetArtifacts(root, { immutablePaths: new Set([asset]) });
  return root;
}
async function serve(t, root, options = {}) {
  const instance = await createProductionServer({
    root,
    dist: root,
    host: '127.0.0.1',
    port: 0,
    plugins: [],
    ...options,
  });
  t.after(() => instance.close());
  return instance;
}
function request(instance, requestPath = '/', headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: instance.address.port,
        path: requestPath,
        headers,
        method,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(2000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

test('production host serves byte-identified encoded assets and revalidates documents', async (t) => {
  const root = await fixture(t);
  const instance = await serve(t, root);
  for (const [encoding, decode] of [
    ['br', brotliDecompressSync],
    ['gzip', gunzipSync],
  ]) {
    const response = await request(instance, `/${asset}`, {
      'accept-encoding': encoding,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], encoding);
    assert.equal(response.headers.etag, `"${hash(response.body)}"`);
    assert.deepEqual(
      decode(response.body),
      await readFile(path.join(root, asset)),
    );
    assert.match(response.headers['cache-control'], /immutable/);
    assert.equal(response.headers.vary, 'Accept-Encoding');
    const cached = await request(instance, `/${asset}`, {
      'accept-encoding': encoding,
      'if-none-match': `"old", W/${response.headers.etag}`,
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
  }
  const html = await request(instance);
  assert.equal(html.headers['cache-control'], 'no-cache');
  assert.equal(html.headers['x-frame-options'], 'DENY');
  assert.equal(html.headers['x-content-type-options'], 'nosniff');
  assert.equal(
    (
      await request(instance, '/', {
        'accept-encoding': 'br;q=0, gzip;q=0, identity;q=0',
      })
    ).status,
    406,
  );
  const identity = await request(instance, `/${asset}`, {
    'accept-encoding': 'br;q=0, gzip;q=0',
  });
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.deepEqual(identity.body, await readFile(path.join(root, asset)));
});

test('ranges and conditional requests refer to the selected representation', async (t) => {
  const instance = await serve(t, await fixture(t));
  const full = await request(instance);
  const suffix = await request(instance, '/', { range: 'bytes=-3' });
  assert.equal(suffix.status, 206);
  assert.deepEqual(suffix.body, full.body.subarray(-3));
  const ranged = await request(instance, '/', {
    range: 'bytes=0-2',
    'if-range': full.headers.etag,
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.body.toString(), '<ma');
  assert.equal(ranged.headers['accept-ranges'], 'bytes');
  assert.equal(
    (
      await request(instance, '/', {
        range: 'bytes=0-2',
        'if-range': '"obsolete"',
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(instance, '/', { range: 'bytes=999999-' })).status,
    416,
  );
  const head = await request(instance, '/', { range: 'bytes=0-2' }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers['content-length']), full.body.length);
  assert.equal(head.body.length, 0);
});

test('host policy gates APIs before providers and never exposes setup writes or HTML fallback', async (t) => {
  let invoked = 0;
  const plugin = {
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/fixture', (req, res) => {
        invoked++;
        res.end(req.url);
      });
    },
  };
  const instance = await serve(t, await fixture(t), { plugins: [plugin] });
  assert.equal(
    (await request(instance, '/api/fixture?x=1', { host: 'rebinding.example' }))
      .status,
    403,
  );
  assert.equal(invoked, 0);
  assert.equal(
    (await request(instance, '/api/fixture?x=1')).body.toString(),
    '/?x=1',
  );
  for (const route of [
    '/api/not-found',
    '/api/setup/keys',
    '/api/setup/status',
  ]) {
    const response = await request(instance, route, {}, 'POST');
    assert.equal(response.status, 404);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal((await request(instance, '/', {}, 'POST')).status, 404);
});

test('mounted next restores the original URL and async errors remain redacted', async (t) => {
  const plugin = {
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/next', (_req, _res, next) => next());
      middlewares.use('/api', (req, res, next) => {
        if (req.url.startsWith('/next')) res.end(req.url);
        else next();
      });
      middlewares.use('/api/error', async () => {
        throw new Error('credential must not appear');
      });
    },
  };
  const instance = await serve(t, await fixture(t), { plugins: [plugin] });
  assert.equal(
    (await request(instance, '/api/next?q=1')).body.toString(),
    '/next?q=1',
  );
  const failure = await request(instance, '/api/error');
  assert.equal(failure.status, 500);
  assert.doesNotMatch(failure.body.toString(), /credential/);
});

test('previous releases serve only declared immutable assets', async (t) => {
  const previous = await fixture(t);
  const current = await fixture(t, { 'index.html': 'current' });
  const instance = await serve(t, current, { previousRoots: [previous] });
  assert.equal((await request(instance, `/${asset}`)).status, 200);
  assert.equal((await request(instance)).body.toString(), 'current');
  await writeFile(path.join(previous, 'unlisted.js'), 'not public');
  assert.equal((await request(instance, '/unlisted.js')).status, 404);
  assert.equal(
    (await request(instance, '/%2e%2e/%2e%2e/etc/passwd')).status,
    404,
  );
  assert.equal((await request(instance, '/.env')).status, 404);
});

test('symlinked parent escape is refused even for a manifest-listed asset', async (t) => {
  const root = await fixture(t, { 'index.html': 'app' });
  const outside = await fixture(t, { 'secret.js': 'private' });
  try {
    await symlink(outside, path.join(root, 'escape'), 'junction');
  } catch (error) {
    if (error.code === 'EPERM')
      return t.skip('host cannot create test symlinks');
    throw error;
  }
  const manifest = JSON.parse(
    await readFile(path.join(root, 'asset-manifest.json'), 'utf8'),
  );
  manifest.assets.push({
    path: 'escape/secret.js',
    bytes: 7,
    sha256: hash('private'),
    cache: 'revalidate',
  });
  await writeFile(
    path.join(root, 'asset-manifest.json'),
    JSON.stringify(manifest),
  );
  const instance = await serve(t, root);
  assert.equal((await request(instance, '/escape/secret.js')).status, 404);
});

test('startup refuses absent, malformed and unsafe manifests', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'asset-manifest.json');
  await rm(file);
  await assert.rejects(
    createProductionServer({ dist: root, plugins: [], port: 0 }),
    /ENOENT/,
  );
  for (const value of [
    '{}',
    '{broken',
    JSON.stringify({
      schema: 'gev-asset-manifest/v1',
      assets: [{ path: '../escape' }],
    }),
  ]) {
    await writeFile(file, value);
    await assert.rejects(
      createProductionServer({ dist: root, plugins: [], port: 0 }),
    );
  }
});

for (const ancestors of ['', 'https://embed.example', '*']) {
  test(`embed framing preserves the shared policy: ${ancestors || 'default'}`, async (t) => {
    const previous = process.env.GEV_EMBED_FRAME_ANCESTORS;
    process.env.GEV_EMBED_FRAME_ANCESTORS = ancestors;
    t.after(() => {
      if (previous === undefined) delete process.env.GEV_EMBED_FRAME_ANCESTORS;
      else process.env.GEV_EMBED_FRAME_ANCESTORS = previous;
    });
    const instance = await serve(t, await fixture(t));
    const normal = await request(instance);
    assert.equal(normal.headers['x-frame-options'], 'DENY');
    const embedded = await request(instance, '/?embed=1');
    assert.match(
      embedded.headers['content-security-policy'],
      /object-src 'none'/,
    );
    if (!ancestors) assert.equal(embedded.headers['x-frame-options'], 'DENY');
    else {
      assert.equal(embedded.headers['x-frame-options'], undefined);
      if (ancestors === '*')
        assert.doesNotMatch(
          embedded.headers['content-security-policy'],
          /frame-ancestors/,
        );
      else
        assert.match(
          embedded.headers['content-security-policy'],
          /frame-ancestors https:\/\/embed\.example/,
        );
    }
  });
}

test('shutdown bounds a stuck request and runs provider cleanup once', async (t) => {
  let onRequest;
  const started = new Promise((resolve) => {
    onRequest = resolve;
  });
  let closed = 0;
  const plugin = {
    configurePreviewServer({ middlewares, httpServer }) {
      middlewares.use('/api/hang', () => onRequest());
      httpServer.once('close', () => closed++);
    },
  };
  const instance = await serve(t, await fixture(t), {
    plugins: [plugin],
    shutdownMs: 20,
  });
  const pending = request(instance, '/api/hang').catch((error) => error);
  await started;
  const a = instance.close();
  assert.equal(instance.close(), a);
  await a;
  assert.equal(closed, 1);
  assert.ok((await pending) instanceof Error);
});

test('operator dotenv parsing preserves values and process environment precedence', async (t) => {
  const root = await fixture(t);
  const previous = process.env.GEV_TEST_OPERATOR;
  process.env.GEV_TEST_OPERATOR = 'process-value';
  t.after(() => {
    if (previous === undefined) delete process.env.GEV_TEST_OPERATOR;
    else process.env.GEV_TEST_OPERATOR = previous;
    delete process.env.GEV_TEST_QUOTED;
  });
  await writeFile(
    path.join(root, '.env'),
    'GEV_TEST_OPERATOR=dotenv-value\nGEV_TEST_QUOTED="hello world" # comment\n',
  );
  await loadOperatorEnv(root);
  assert.equal(process.env.GEV_TEST_OPERATOR, 'process-value');
  assert.equal(process.env.GEV_TEST_QUOTED, 'hello world');
});
