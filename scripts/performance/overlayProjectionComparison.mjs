import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep production modules and the allocation fixture unchanged. Both sides run
// the same fixture adapter, changing only how often its positions advance.
const [baselineRoot, candidateRoot, outputPath] = process.argv.slice(2);
assert.ok(
  baselineRoot && candidateRoot && outputPath,
  'Usage: node overlayProjectionComparison.mjs BASELINE CANDIDATE OUTPUT',
);
const roots = {
  baseline: resolve(baselineRoot),
  candidate: resolve(candidateRoot),
};
assert.notEqual(roots.baseline, roots.candidate);
const output = resolve(outputPath);
assert.equal(
  existsSync(output),
  false,
  'Refusing to replace existing evidence',
);
const workerRelative = 'src/overlays/worldOverlayAllocation.worker.mjs';
const overlayRelative = 'src/overlays/worldOverlay.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fixture = readFileSync(resolve(roots.baseline, workerRelative), 'utf8');
assert.equal(
  readFileSync(resolve(roots.candidate, workerRelative), 'utf8'),
  fixture,
  'Fixture source differs between revisions',
);
const replaceOnce = (source, before, after) => {
  assert.equal(
    source.split(before).length - 1,
    1,
    `Fixture anchor changed: ${before}`,
  );
  return source.replace(before, after);
};
let adapted =
  "import { createHash as conditionHash } from 'node:crypto';\n" + fixture;
adapted = replaceOnce(
  adapted,
  '  let frame = 0;',
  `  let frame = 0;
  let positionUpdates = 0;
  const cadence = Number(process.env.GEV_PROJECTION_CADENCE);
  if (![0, 1, 60].includes(cadence)) throw new Error('Unsupported fixture cadence');
  const conditions = () => {
    const detection = detectionActive ? getDetectionDiagnostics() : null;
    const overlay = getWorldOverlayDiagnostics();
    return ({
    frame, positionUpdates, positionCount: positions.length,
    viewport: [env.viewer.canvas.clientWidth, env.viewer.canvas.clientHeight, window.devicePixelRatio],
    candidates: detectionActive ? detection.observationCount : overlay.candidateCount,
    painted: detectionActive ? detection.visibleCount : overlay.paintedCount,
    paintedBySource: overlay.paintedBySource,
    detectionSelected: detection?.selectedCount ?? null,
    detectionLabels: detection?.labeledKeys ?? null,
    positionsSha256: conditionHash('sha256').update(JSON.stringify(positions.map(p => [p.x, p.y, p.z]))).digest('hex'),
    camera: [env.viewer.camera.positionWC.x, env.viewer.camera.positionWC.y, env.viewer.camera.positionWC.z],
    viewMatrix: Array.from({length: 16}, (_, i) => env.viewer.camera.viewMatrix[i]),
    projectionMatrix: Array.from({length: 16}, (_, i) => env.viewer.camera.frustum.projectionMatrix[i]),
  }); };`,
);
adapted = replaceOnce(
  adapted,
  '    advanceWorkload(positions, drifts, frame);',
  `    if (frame === 0 || (cadence > 0 && frame % cadence === 0)) {
      advanceWorkload(positions, drifts, frame);
      positionUpdates++;
    }`,
);
adapted = replaceOnce(
  adapted,
  '        const started = cpuClock.now();',
  '        const beforeConditions = conditions();\n        const started = cpuClock.now();',
);
adapted = replaceOnce(
  adapted,
  '          phases: getCpuTimings(),',
  '          phases: getCpuTimings(),\n          beforeConditions,\n          afterConditions: conditions(),',
);
const report = {
  schema: 'gev-overlay-projection-comparison/v1',
  capturedAt: new Date().toISOString(),
  status: 'running',
  scope:
    'Node synchronous overlay algorithm, mock Canvas2D and fixed camera; no rendered visual-equivalence, GPU or browser FPS claim',
  node: process.version,
  platform: process.platform,
  osRelease: os.release(),
  cpuModel: os.cpus()[0]?.model || null,
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  harnessCommit: git(dirname(fileURLToPath(import.meta.url)), [
    'rev-parse',
    'HEAD',
  ]),
  fixtureSha256: hash(fixture),
  adapterSha256: hash(adapted),
  conditions: {
    warmupFrames: 3000,
    pairs: 5,
    sampleFrames: 600,
    samplesPerProcess: 10,
    measuredFramesPerProcess: 6000,
    virtualFrameMs: 16,
    latencyUsesForcedGc: false,
    cadence:
      '0: fixed after first tick; 1: every tick; 60: every 960 ms of virtual time',
  },
  sources: {},
  workloads: [],
};
const temporary = {};
for (const [name, root] of Object.entries(roots)) {
  assert.equal(git(root, ['status', '--porcelain']), '', `Dirty ${name} tree`);
  report.sources[name] = {
    commit: git(root, ['rev-parse', 'HEAD']),
    overlaySha256: hash(readFileSync(resolve(root, overlayRelative))),
    lockfileSha256: hash(readFileSync(resolve(root, 'package-lock.json'))),
  };
}
assert.equal(
  report.sources.baseline.lockfileSha256,
  report.sources.candidate.lockfileSha256,
  'Dependency lockfiles differ',
);
mkdirSync(dirname(output), { recursive: true });
const save = () =>
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const [name, root] of Object.entries(roots)) {
    const path = resolve(
      root,
      `scripts/performance/.projection-comparison-${randomUUID()}.mjs`,
    );
    const workerPath = resolve(root, workerRelative);
    const linked = adapted.replace(
      /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
      (_match, quote, specifier) =>
        `from ${quote}${pathToFileURL(resolve(dirname(workerPath), specifier)).href}${quote}`,
    );
    writeFileSync(path, linked, { flag: 'wx' });
    temporary[name] = path;
  }
  for (const [profile, entries, cadence] of [
    ['generic', 250, 1],
    ['local-infrastructure', 320, 1],
    ['all-live-radio', 864, 1],
    ['phase6-detection', 5000, 1],
    ['local-infrastructure', 320, 0],
    ['all-live-radio', 864, 0],
    ['local-infrastructure', 320, 60],
    ['all-live-radio', 864, 60],
  ]) {
    const workload = { profile, entries, cadence, pairs: [] };
    report.workloads.push(workload);
    for (let run = 0; run < 5; run++) {
      const pair = {
        run,
        order: run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
      };
      for (const name of pair.order) {
        const out = execFileSync(
          process.execPath,
          ['--no-concurrent-recompilation', temporary[name]],
          {
            cwd: roots[name],
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 4 * 1024 * 1024,
            env: {
              ...process.env,
              GEV_OVERLAY_CPU: '1',
              GEV_ALLOC_PROFILE: profile,
              GEV_ALLOC_ENTRIES: String(entries),
              GEV_ALLOC_WARMUP: '3000',
              GEV_ALLOC_SOLVE_MS: '125',
              GEV_PROJECTION_CADENCE: String(cadence),
            },
          },
        );
        const result = JSON.parse(out.trim().split('\n').at(-1));
        assert.equal(result.ok, true);
        assert.equal(result.profile, profile);
        assert.equal(result.entryCount, entries);
        assert.equal(result.samples.length, 10);
        for (const sample of result.samples) {
          assert.equal(sample.frames, 600);
          assert.ok(Number.isFinite(sample.cpuMs) && sample.cpuMs > 0);
          assert.equal(
            sample.afterConditions.frame - sample.beforeConditions.frame,
            600,
          );
          assert.equal(
            sample.afterConditions.positionUpdates -
              sample.beforeConditions.positionUpdates,
            cadence === 0 ? 0 : 600 / cadence,
            'Observed cadence does not match requested cadence',
          );
        }
        pair[name] = {
          ...result,
          medianCpuMs: median(
            result.samples
              .filter((s) => !s.enabled)
              .map((s) => s.cpuMs / s.frames),
          ),
        };
      }
      const conditions = (side) =>
        side.samples.map((s) => ({
          enabled: s.enabled,
          candidates: s.candidates,
          painted: s.painted,
          before: s.beforeConditions,
          after: s.afterConditions,
        }));
      assert.deepEqual(
        conditions(pair.candidate),
        conditions(pair.baseline),
        'Fixture trajectories or populations differ',
      );
      pair.ratio = pair.candidate.medianCpuMs / pair.baseline.medianCpuMs - 1;
      workload.pairs.push(pair);
      save();
      console.log(JSON.stringify({ profile, cadence, run, ratio: pair.ratio }));
    }
    workload.medianRatio = median(workload.pairs.map((p) => p.ratio));
    workload.baselineMedianCpuMs = median(
      workload.pairs.map((p) => p.baseline.medianCpuMs),
    );
    workload.candidateMedianCpuMs = median(
      workload.pairs.map((p) => p.candidate.medianCpuMs),
    );
    workload.ratioOfRunMedians =
      workload.candidateMedianCpuMs / workload.baselineMedianCpuMs - 1;
    save();
  }
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack || error);
  save();
  throw error;
} finally {
  for (const path of Object.values(temporary)) unlinkSync(path);
}
try {
  for (const [name, root] of Object.entries(roots)) {
    assert.equal(
      git(root, ['status', '--porcelain']),
      '',
      `Source changed during capture: ${name}`,
    );
    assert.equal(git(root, ['rev-parse', 'HEAD']), report.sources[name].commit);
    assert.equal(
      hash(readFileSync(resolve(root, overlayRelative))),
      report.sources[name].overlaySha256,
    );
    assert.equal(
      hash(readFileSync(resolve(root, workerRelative))),
      report.fixtureSha256,
    );
    assert.equal(
      hash(readFileSync(resolve(root, 'package-lock.json'))),
      report.sources[name].lockfileSha256,
    );
  }
  report.status = 'complete';
  save();
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack || error);
  save();
  throw error;
}
console.log(JSON.stringify({ status: report.status, output }));
