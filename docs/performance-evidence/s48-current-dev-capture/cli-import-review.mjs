import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [originalRoot, candidateRoot, output] = process.argv.slice(2).map(value => path.resolve(value));
const parent = await realpath(os.tmpdir());
const root = await mkdtemp(path.join(parent, 'gev-cli-import-root-'));
const results = [];
try {
  const hook = path.join(root, 'guard.mjs');
  await writeFile(hook, `import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
registerHooks({ resolve(specifier, context, next) {
 if (specifier === 'cesium' || specifier === 'puppeteer' || specifier.endsWith('/qa-application-fixtures.mjs')) {
  appendFileSync(process.env.GEV_IMPORT_WITNESS, specifier + '\\n');
  throw new Error('FORBIDDEN_EARLY_IMPORT:' + specifier);
 }
 return next(specifier, context);
} });`);
  for (const [label, checkout] of [['original', originalRoot], ['candidate', candidateRoot]]) {
    const reportPath = path.join(root, label + '.json');
    const witnessPath = path.join(root, label + '.txt');
    const cli = path.join(checkout, 'scripts/qa-performance-build-smoke.mjs');
    const started = performance.now();
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, cli,
      '--candidate-sha', 'invalid', '--out', reportPath], {
      cwd: checkout, encoding: 'utf8', windowsHide: true, timeout: 5000,
      env: { ...process.env, GEV_IMPORT_WITNESS: witnessPath },
    });
    const elapsedMs = performance.now() - started;
    let report = null, imports = [];
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { imports = (await readFile(witnessPath, 'utf8')).trim().split(/\r?\n/); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    if (label === 'original') {
      assert.deepEqual(imports, ['cesium']);
      assert.equal(report, null);
      assert.match(result.stderr, /FORBIDDEN_EARLY_IMPORT:cesium/);
    } else {
      assert.deepEqual(imports, []);
      assert.equal(report?.status, 'failed');
      assert.equal(report?.failure?.phase, 'setup');
      assert.match(report?.failure?.message, /full lowercase Git SHA/);
    }
    results.push({ label, status: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
      elapsedMs, attemptedHeavyImports: imports, failureReportCreated: report !== null,
      failure: report?.failure ?? null, cliSha256: createHash('sha256').update(await readFile(cli)).digest('hex') });
  }
} finally {
  const canonical = await realpath(root);
  assert.equal(path.dirname(canonical), parent);
  assert.ok(path.basename(canonical).startsWith('gev-cli-import-root-'));
  await rm(canonical, { recursive: true, force: false });
}
const evidence = { schema: 'gev-cli-import-boundary-root-review/v1', node: process.version,
  scope: 'Actual CLI with fail-fast dependency resolution guard; no browser, live provider, or rendering measurement',
  timeoutMs: 5000, passed: true, results };
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
