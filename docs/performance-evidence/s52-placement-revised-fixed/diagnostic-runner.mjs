import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stage = resolve(repo, 'qa-artifacts/s52-placement-allocation-stage');
const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) throw new Error('usage: node run-probe.mjs <source.js> <fresh-output.json>');
const source = resolve(sourceArg);
const output = resolve(outArg);
const relOut = relative(stage, output);
if (relOut.startsWith('..') || isAbsolute(relOut)) throw new Error('output must stay under allocation stage');
if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`);
const sourceBytes = readFileSync(source);
const sourceText = sourceBytes.toString('utf8').replace(
  /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
  (_all, _quote, specifier) =>
    `from '${pathToFileURL(resolve(repo, 'src/overlays', specifier)).href}'`,
);
const runnableSource = resolve(stage, `candidate-${process.pid}.mjs`);
writeFileSync(runnableSource, sourceText, { flag: 'wx' });
const workerOriginal = resolve(repo, 'src/overlays/worldOverlayAllocation.worker.mjs');
const workerBytes = readFileSync(workerOriginal);
const workerText = workerBytes.toString('utf8').replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_all, quote, specifier) => {
  const target = resolve(dirname(workerOriginal), specifier);
  if (specifier === './worldOverlay.js') return `from '${pathToFileURL(runnableSource).href}'`;
  return `from '${pathToFileURL(target).href}'`;
});
const tmpWorker = resolve(stage, `worker-${process.pid}.mjs`);
writeFileSync(tmpWorker, workerText, { flag: 'wx' });
try {
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const workerSpecifiers = [...workerBytes.toString('utf8').matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]
    .map((match) => resolve(dirname(workerOriginal), match[2]));
  const sourceSpecifiers = [...sourceBytes.toString('utf8').matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]
    .map((match) => resolve(repo, 'src/overlays', match[2]));
  const dependencies = [...new Set([
    ...workerSpecifiers,
    ...sourceSpecifiers,
    resolve(repo, 'package-lock.json'),
    resolve(repo, 'node_modules/cesium/package.json'),
  ])].sort();
  const dependencyHashes = () => Object.fromEntries(dependencies.map((path) => [
    relative(repo, path).replaceAll('\\', '/'),
    sha(readFileSync(path)),
  ]));
  const sourceBeforeSha256 = sha(sourceBytes);
  const workerBeforeSha256 = sha(workerBytes);
  const dependenciesBefore = dependencyHashes();
  const startHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const startStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout;
  const env = {
    ...process.env,
    GEV_ALLOC_ENTRIES: '250',
    GEV_ALLOC_PROFILE: 'generic',
    GEV_ALLOC_WARMUP: '3000',
    GEV_ALLOC_CHUNK: '48',
    GEV_ALLOC_CHUNKS: '10',
    GEV_ALLOC_STABILIZATION_CHUNKS: '6',
  };
  const result = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', tmpWorker], {
    cwd: repo, encoding: 'utf8', timeout: 180000, env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`probe exited ${result.status}: ${String(result.stderr).slice(0, 500)}`);
  const line = String(result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('probe produced no output');
  const payload = JSON.parse(line);
  const sourceAfterSha256 = sha(readFileSync(source));
  const workerAfterSha256 = sha(readFileSync(workerOriginal));
  const dependenciesAfter = dependencyHashes();
  const endHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const endStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout;
  if (startHead !== endHead || startStatus !== endStatus
      || sourceBeforeSha256 !== sourceAfterSha256
      || workerBeforeSha256 !== workerAfterSha256
      || JSON.stringify(dependenciesBefore) !== JSON.stringify(dependenciesAfter)) {
    throw new Error('source, dependency bytes, or worktree identity/status changed during probe');
  }
  const report = {
    schema: 's52-placement-allocation-probe/v1',
    scope: 'single 250-entry above-cap allocation workload; source-specific diagnostic, not a full suite',
    gitHead: startHead,
    dirtyStatusSha256: createHash('sha256').update(startStatus).digest('hex'),
    sourcePath: relative(repo, source).replaceAll('\\', '/'),
    sourceSha256: sourceBeforeSha256,
    sourceAfterSha256,
    workerSha256: workerBeforeSha256,
    workerAfterSha256,
    dependencySha256: dependenciesBefore,
    dependencySha256After: dependenciesAfter,
    node: process.versions.node,
    platform: process.platform,
    payload,
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(JSON.stringify({ output, sourceSha256: report.sourceSha256, dependenciesUnchanged: true, medianBytesPerFrame: payload.medianBytesPerFrame, maxBytesPerFrame: payload.maxBytesPerFrame, chunks: payload.chunkBytesPerFrame }) + '\n');
} finally {
  try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpWorker); unlinkSync(runnableSource); } catch {}
}

