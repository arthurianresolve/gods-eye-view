import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createLocalBuildReceipt,
  verifyServedBuildAssets,
} from './buildProvenance.mjs';

const BUILD_SCRIPT = `
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = process.argv.find((value) => value.startsWith('--outDir='));
if (!arg) throw new Error('Missing output directory');
const out = arg.slice('--outDir='.length).replace(/^['\"]|['\"]$/g, '');
if (existsSync('.fail-build')) process.exit(7);
if (existsSync('.mutate-during-build')) await writeFile('src/app.js', 'changed during build');
await mkdir(path.join(out, 'assets'), { recursive: true });
await writeFile(path.join(out, 'index.html'), '<main>fixture app</main>');
await writeFile(path.join(out, 'assets', 'app.js'), await readFile('src/app.js'));
`;

async function fixture(t, { staleDist = false } = {}) {
  const tempRoot = await realpath(os.tmpdir());
  const tmpRoot = await mkdtemp(
    path.join(tempRoot, 'gev-build-provenance-test-'),
  );
  const checkout = path.join(tmpRoot, 'checkout');
  const harness = path.join(tmpRoot, 'harness');
  await mkdir(checkout);
  await mkdir(harness);
  await mkdir(path.join(checkout, 'src'));
  await writeFile(
    path.join(checkout, '.gitignore'),
    '.fail-build\n.mutate-during-build\nnode_modules/\n',
  );
  await writeFile(
    path.join(checkout, 'package.json'),
    JSON.stringify(
      {
        name: 'provenance-fixture',
        version: '1.0.0',
        scripts: { build: 'node build.mjs' },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    path.join(checkout, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'provenance-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'provenance-fixture', version: '1.0.0' } },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(path.join(checkout, 'build.mjs'), BUILD_SCRIPT);
  await writeFile(
    path.join(checkout, 'src', 'app.js'),
    'export const fixture = true;\n',
  );
  if (staleDist) {
    await mkdir(path.join(checkout, 'dist'));
    await writeFile(
      path.join(checkout, 'dist', 'index.html'),
      '<main>stale</main>',
    );
  }
  await writeFile(
    path.join(harness, 'harness.txt'),
    'shared harness fixture\n',
  );
  const appCommit = await commitRepo(checkout);
  const harnessCommit = await commitRepo(harness);
  const buildRoot = path.join(tmpRoot, 'fresh-output');
  t.after(async () => {
    const canonical = await realpath(tmpRoot);
    const canonicalTemp = await realpath(os.tmpdir());
    assert.ok(canonical.startsWith(`${canonicalTemp}${path.sep}`));
    assert.ok(
      path.basename(canonical).startsWith('gev-build-provenance-test-'),
    );
    await rm(canonical, { recursive: true, force: true });
  });
  return { tmpRoot, checkout, harness, appCommit, harnessCommit, buildRoot };
}

async function commitRepo(root) {
  const run = (args) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: 'ignore',
    });
  run(['init', '-q']);
  run(['config', 'user.name', 'Provenance Test']);
  run(['config', 'user.email', 'provenance@example.invalid']);
  run(['add', '.']);
  run(['commit', '-qm', 'fixture']);
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

async function build(fx) {
  return createLocalBuildReceipt({
    checkoutRoot: fx.checkout,
    harnessRoot: fx.harness,
    buildOutDir: fx.buildRoot,
    expectedAppCommit: fx.appCommit,
    expectedHarnessCommit: fx.harnessCommit,
  });
}

async function serve(
  t,
  root,
  {
    missingPath = null,
    changedPath = null,
    delayPath = null,
    redirectPath = null,
  } = {},
) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname.slice(1);
    if (pathname === missingPath) {
      response.writeHead(404).end();
      return;
    }
    if (pathname === redirectPath) {
      response
        .writeHead(302, { location: 'http://127.0.0.1:1/redirected' })
        .end();
      return;
    }
    if (pathname === delayPath) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.write('partial');
      return;
    }
    const bytes =
      pathname === changedPath
        ? Buffer.from('served bytes changed')
        : await readFile(path.join(root, pathname));
    response.writeHead(200, { 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  );
  return `http://127.0.0.1:${server.address().port}/`;
}

function resignReceipt(receipt) {
  const copy = { ...receipt };
  delete copy.receiptSha256;
  return {
    ...receipt,
    receiptSha256: createHash('sha256')
      .update(JSON.stringify(copy))
      .digest('hex'),
  };
}

function servedOptions(fx, receipt, baseUrl) {
  return {
    receipt,
    checkoutRoot: fx.checkout,
    harnessRoot: fx.harness,
    buildRoot: fx.buildRoot,
    expectedAppCommit: fx.appCommit,
    expectedHarnessCommit: fx.harnessCommit,
    baseUrl,
  };
}

test('fresh build receipts bind source, harness, lockfile recipe and locally built asset bytes', async (t) => {
  const fx = await fixture(t);
  const { receipt } = await build(fx);
  assert.equal(receipt.schema, 'gev-build-provenance/v1');
  assert.equal(
    receipt.scope,
    'unsigned local source-build receipt; not a hardware or release attestation',
  );
  assert.equal(receipt.source.commit, fx.appCommit);
  assert.equal(receipt.harness.commit, fx.harnessCommit);
  assert.equal(receipt.source.worktree, 'clean');
  assert.equal(
    receipt.buildRecipe.dependencyInstall,
    'npm ci --no-audit --no-fund',
  );
  assert.match(receipt.buildRecipe.packageLockSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    receipt.assets.map((asset) => asset.path),
    ['assets/app.js', 'index.html'],
  );
  assert.equal(
    await readFile(path.join(fx.buildRoot, 'index.html'), 'utf8'),
    '<main>fixture app</main>',
  );
});

test('wrong expected SHAs, dirty checkouts and an already existing output are rejected', async (t) => {
  const wrongSha = await fixture(t);
  await assert.rejects(
    build({ ...wrongSha, appCommit: 'f'.repeat(40) }),
    /expected full SHA/,
  );

  const dirty = await fixture(t);
  await writeFile(path.join(dirty.checkout, 'src', 'app.js'), 'dirty');
  await assert.rejects(build(dirty), /Application checkout must be clean/);

  const dirtyHarness = await fixture(t);
  await writeFile(path.join(dirtyHarness.harness, 'harness.txt'), 'dirty');
  await assert.rejects(build(dirtyHarness), /Harness checkout must be clean/);

  const stale = await fixture(t, { staleDist: true });
  const staleBytes = await readFile(
    path.join(stale.checkout, 'dist', 'index.html'),
    'utf8',
  );
  await assert.rejects(
    createLocalBuildReceipt({
      checkoutRoot: stale.checkout,
      harnessRoot: stale.harness,
      buildOutDir: path.join(stale.checkout, 'dist'),
      expectedAppCommit: stale.appCommit,
      expectedHarnessCommit: stale.harnessCommit,
    }),
    /outside both Git checkouts/,
  );
  assert.equal(
    await readFile(path.join(stale.checkout, 'dist', 'index.html'), 'utf8'),
    staleBytes,
  );

  const existing = await fixture(t);
  await mkdir(existing.buildRoot);
  await writeFile(
    path.join(existing.buildRoot, 'index.html'),
    '<main>stale</main>',
  );
  await assert.rejects(build(existing), /already exists/);
  assert.equal(
    await readFile(path.join(existing.buildRoot, 'index.html'), 'utf8'),
    '<main>stale</main>',
  );
});

test('build changes and failed builds produce no local receipt', async (t) => {
  const changed = await fixture(t);
  await writeFile(path.join(changed.checkout, '.mutate-during-build'), 'go');
  await assert.rejects(build(changed), /Application checkout must be clean/);

  const failed = await fixture(t);
  await writeFile(path.join(failed.checkout, '.fail-build'), 'go');
  await assert.rejects(build(failed), /npm run failed/);
  assert.equal(
    await lstat(failed.buildRoot).then((info) => info.isDirectory()),
    true,
  );
  assert.equal(
    await lstat(path.join(failed.buildRoot, 'index.html')).then(
      () => true,
      () => false,
    ),
    false,
  );
});

test('served verification checks loopback bytes and rejects changed, missing, redirected and escaped assets', async (t) => {
  const fx = await fixture(t);
  const { receipt } = await build(fx);
  const baseUrl = await serve(t, fx.buildRoot);
  const result = await verifyServedBuildAssets(
    servedOptions(fx, receipt, baseUrl),
  );
  assert.equal(result.status, 'served-assets-match');
  assert.equal(result.receiptSha256, receipt.receiptSha256);
  assert.equal(Object.hasOwn(result, 'url'), false);

  const changedUrl = await serve(t, fx.buildRoot, {
    changedPath: 'assets/app.js',
  });
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(fx, receipt, changedUrl)),
    /differs from its receipt/,
  );
  const missingUrl = await serve(t, fx.buildRoot, {
    missingPath: 'assets/app.js',
  });
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(fx, receipt, missingUrl)),
    /missing or redirected/,
  );
  const redirectUrl = await serve(t, fx.buildRoot, {
    redirectPath: 'assets/app.js',
  });
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(fx, receipt, redirectUrl)),
    /missing or redirected/,
  );

  const escaped = structuredClone(receipt);
  escaped.assets[0].path = '../outside';
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(fx, resignReceipt(escaped), baseUrl)),
    /unsafe/,
  );
  await assert.rejects(
    verifyServedBuildAssets({
      ...servedOptions(fx, receipt, `${baseUrl}?token=secret`),
    }),
    /credentials, query, or fragment/,
  );
  await assert.rejects(
    verifyServedBuildAssets({
      ...servedOptions(fx, receipt, 'https://example.com/'),
    }),
    /loopback hosts/,
  );
});

test('served verification rejects local build changes and times out a stalled streamed asset', async (t) => {
  const fx = await fixture(t);
  const { receipt } = await build(fx);
  const stalled = await serve(t, fx.buildRoot, { delayPath: 'assets/app.js' });
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(fx, receipt, stalled)),
    /time limit/,
  );

  const changed = await fixture(t);
  const built = await build(changed);
  await writeFile(
    path.join(changed.buildRoot, 'assets', 'app.js'),
    'local change',
  );
  const server = await serve(t, changed.buildRoot);
  await assert.rejects(
    verifyServedBuildAssets(servedOptions(changed, built.receipt, server)),
    /Build assets does not match/,
  );
});

test('served body overflow is cancelled before the full stream is consumed', async (t) => {
  const fx = await fixture(t);
  const { receipt } = await build(fx);
  let cancelled = false;
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith('/assets/app.js')) {
      let emitted = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (emitted >= 40) return controller.close();
            emitted += 1;
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    }
    const relative = new URL(url).pathname.slice(1);
    return new Response(await readFile(path.join(fx.buildRoot, relative)), {
      status: 200,
    });
  };
  await assert.rejects(
    verifyServedBuildAssets({
      ...servedOptions(fx, receipt, 'http://127.0.0.1:4173/'),
      fetchImpl,
    }),
    /size or time limit/,
  );
  assert.equal(cancelled, true);
});
