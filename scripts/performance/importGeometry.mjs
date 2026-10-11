/** Node-only single-feature preparation comparison; no render/interaction claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASELINE_COMMIT = '37afdc6d66b74487ee2280dacc38566ccb3a1530';
const script = fileURLToPath(import.meta.url);
const scriptRoot = path.resolve(path.dirname(script), '../..');
const scriptSha256 = hash(readFileSync(script));

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function option(key) {
  const index = process.argv.indexOf(key);
  if (index < 0 || !process.argv[index + 1])
    throw new Error(`Missing required argument ${key}.`);
  return process.argv[index + 1];
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], { encoding });
}

function runtimeIdentity(root) {
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']);
  assert.equal(status, '', `${root} tracked source must be clean`);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const bytes = readFileSync(path.join(root, 'src/imports/runtimeLayer.js'));
  const committed = git(
    root,
    ['show', 'HEAD:src/imports/runtimeLayer.js'],
    null,
  );
  assert.deepEqual(bytes, committed, 'Runtime source must match HEAD bytes');
  const cesiumEntry = path.join(root, 'node_modules/cesium/Source/Cesium.js');
  return {
    sourceCommit: commit,
    runtimeLayerSha256: hash(bytes),
    packageLockSha256: hash(readFileSync(path.join(root, 'package-lock.json'))),
    cesiumEntrySha256: hash(readFileSync(cesiumEntry)),
  };
}

function fingerprint(entity) {
  const hierarchy = entity.polygon?.hierarchy.getValue();
  const groups = hierarchy
    ? [hierarchy.positions, ...hierarchy.holes.map((hole) => hole.positions)]
    : [entity.polyline.positions.getValue()];
  const digest = createHash('sha256');
  for (const positions of groups) {
    digest.update(`${positions.length}:`);
    const values = new Float64Array(positions.length * 3);
    positions.forEach((value, index) =>
      values.set([value.x, value.y, value.z], index * 3),
    );
    digest.update(Buffer.from(values.buffer));
  }
  return digest.digest('hex');
}

function lineOrPolygon(type) {
  const ring = (count, radius) => {
    const points = Array.from({ length: count - 1 }, (_, index) => {
      const angle = (index / (count - 1)) * Math.PI * 2;
      return [
        -97 + Math.cos(angle) * radius,
        30 + Math.sin(angle) * radius,
        25,
      ];
    });
    return [...points, [...points[0]]];
  };
  const coordinates =
    type === 'LineString'
      ? ring(50_000, 0.1)
      : [ring(25_000, 0.1), ring(25_000, 0.02)];
  return [
    {
      id: 'fixture',
      kind: 'geojson',
      records: [{ id: 'shape', geometry: { type, coordinates } }],
    },
  ];
}

async function runChild(root) {
  const identity = runtimeIdentity(root);
  const cesiumEntry = path.join(root, 'node_modules/cesium/Source/Cesium.js');
  const Cesium = await import(pathToFileURL(cesiumEntry));
  const { createImportedGeometryLayer } = await import(
    pathToFileURL(path.join(root, 'src/imports/runtimeLayer.js'))
  );
  globalThis.window = { dispatchEvent() {} };
  const entities = new Cesium.EntityCollection();
  let clockSamples = 0;
  let scheduledCallbacks = 0;
  let callbacks = [];
  const layer = createImportedGeometryLayer({
    viewer: { entities, scene: { canvas: {}, requestRender() {} } },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
    batchOptions: {
      now() {
        clockSamples++;
        return performance.now();
      },
      schedule(callback) {
        const scheduledAt = performance.now();
        scheduledCallbacks++;
        return setTimeout(() => {
          const callbackStartedAt = performance.now();
          callback();
          callbacks.push({
            scheduledToWakeMs: callbackStartedAt - scheduledAt,
            activeCallbackMs: performance.now() - callbackStartedAt,
          });
        }, 0);
      },
    },
  });

  const reports = [];
  try {
    for (const type of ['LineString', 'Polygon']) {
      const input = lineOrPolygon(type);
      for (let index = 0; index < 4; index++) {
        clockSamples = 0;
        scheduledCallbacks = 0;
        callbacks = [];
        const startedAt = performance.now();
        const pending = layer.loadAsync(input);
        const initialSliceMs = performance.now() - startedAt;
        await pending;
        const durationMs = performance.now() - startedAt;
        assert.equal(entities.values.length, 1);
        const entity = entities.values[0];
        const stepCount = callbacks.length + 1;
        // consumeInBatches samples once at each step start and once after every
        // non-final iterator.next(); the final done result has no trailing read.
        const iteratorResumeCount = clockSamples - stepCount + 1;
        assert.ok(iteratorResumeCount > 0);
        if (index === 3) {
          const activeBatches = [
            initialSliceMs,
            ...callbacks.map((entry) => entry.activeCallbackMs),
          ];
          reports.push({
            type,
            vertices: 50_000,
            entityId: entity.id,
            geometrySha256: fingerprint(entity),
            durationMs,
            initialSliceMs,
            maximumActiveBatchMs: Math.max(...activeBatches),
            totalActiveBatchMs: activeBatches.reduce(
              (sum, value) => sum + value,
              0,
            ),
            scheduledCallbackCount: callbacks.length,
            scheduledToWakeMs: callbacks.map(
              (entry) => entry.scheduledToWakeMs,
            ),
            totalScheduledToWakeMs: callbacks.reduce(
              (sum, entry) => sum + entry.scheduledToWakeMs,
              0,
            ),
            activeCallbackMs: callbacks.map((entry) => entry.activeCallbackMs),
            iteratorResumeCount,
            clockSampleCount: clockSamples,
            reportedScheduleCalls: scheduledCallbacks,
          });
        }
        layer.clear();
        assert.equal(entities.values.length, 0);
      }
    }
  } finally {
    layer.destroy();
  }
  return { ...identity, reports };
}

function atomicReport(output, report) {
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, output);
}

function summarize(report) {
  const median = (values) =>
    [...values].sort((left, right) => left - right)[
      Math.floor(values.length / 2)
    ];
  return Object.fromEntries(
    ['LineString', 'Polygon'].map((type) => {
      const variants = Object.fromEntries(
        ['baseline', 'candidate'].map((variant) => {
          const rows = report.samples
            .filter((sample) => sample.variant === variant)
            .map((sample) =>
              sample.reports.find((entry) => entry.type === type),
            );
          return [
            variant,
            {
              completionMs: median(rows.map((row) => row.durationMs)),
              maximumActiveBatchMs: median(
                rows.map((row) => row.maximumActiveBatchMs),
              ),
              scheduledWakeMs: median(
                rows.map((row) => row.totalScheduledToWakeMs),
              ),
              scheduledCallbacks: median(
                rows.map((row) => row.scheduledCallbackCount),
              ),
              iteratorResumes: median(
                rows.map((row) => row.iteratorResumeCount),
              ),
            },
          ];
        }),
      );
      const completionDeltaPercent =
        ((variants.candidate.completionMs - variants.baseline.completionMs) /
          variants.baseline.completionMs) *
        100;
      return [type, { ...variants, completionDeltaPercent }];
    }),
  );
}

if (process.argv.includes('--child')) {
  const root = path.resolve(option('--child'));
  const result = await runChild(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  assert.ok(process.argv.includes('--baseline'));
  const output = path.resolve(option('--out'));
  mkdirSync(path.dirname(output), { recursive: true });
  assert.equal(existsSync(output), false, 'Output path must be new');
  const baseline = path.resolve(option('--baseline'));
  assert.equal(
    git(baseline, ['rev-parse', 'HEAD']).trim(),
    BASELINE_COMMIT,
    'Baseline must be the exact single-feature preparation parent.',
  );
  const candidate = scriptRoot;
  const report = {
    schema: 'gev-import-geometry-attribution/v1',
    status: 'running',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    harnessCommit: git(candidate, ['rev-parse', 'HEAD']).trim(),
    harnessSha256: scriptSha256,
    baselineCommit: BASELINE_COMMIT,
    candidateMergeBaseCommit: git(candidate, [
      'merge-base',
      BASELINE_COMMIT,
      'HEAD',
    ]).trim(),
    candidateParentCommit: git(candidate, ['rev-parse', 'HEAD^']).trim(),
    scope:
      'Node-only geometry preparation. Five alternating pairs; each child performs three warmups before the measured run. The wake interval is enqueue-to-callback-start and combines timer clamping, event-loop queueing and scheduling; it is not timer-clamp-only attribution. Active spans include measurement wrapper overhead. No browser, rendering, GPU or interaction claim.',
    samples: [],
  };
  atomicReport(output, report);
  try {
    assert.equal(
      report.candidateMergeBaseCommit,
      BASELINE_COMMIT,
      'Candidate must descend from the exact single-feature baseline.',
    );
    for (let pair = 0; pair < 5; pair++) {
      for (const variant of pair % 2
        ? ['candidate', 'baseline']
        : ['baseline', 'candidate']) {
        const root = variant === 'baseline' ? baseline : candidate;
        const result = JSON.parse(
          execFileSync(process.execPath, [script, '--child', root], {
            cwd: root,
            encoding: 'utf8',
            timeout: 60_000,
          }),
        );
        assert.equal(
          result.sourceCommit,
          variant === 'baseline' ? BASELINE_COMMIT : report.harnessCommit,
        );
        assert.equal(result.reports.length, 2);
        assert.ok(result.reports.every((row) => row.vertices === 50_000));
        assert.ok(
          result.reports.every(
            (row) => row.scheduledCallbackCount === row.reportedScheduleCalls,
          ),
        );
        report.samples.push({ pair, variant, ...result });
        atomicReport(output, report);
      }
    }
    const hashes = Object.fromEntries(
      ['LineString', 'Polygon'].map((type) => [
        type,
        new Set(
          report.samples.map(
            (sample) =>
              sample.reports.find((row) => row.type === type).geometrySha256,
          ),
        ),
      ]),
    );
    report.geometryEquivalent = Object.values(hashes).every(
      (values) => values.size === 1,
    );
    assert.ok(report.geometryEquivalent, 'Full geometry output differs');
    report.packageLockEquivalent =
      new Set(report.samples.map((sample) => sample.packageLockSha256)).size ===
      1;
    report.cesiumEntryEquivalent =
      new Set(report.samples.map((sample) => sample.cesiumEntrySha256)).size ===
      1;
    assert.ok(report.packageLockEquivalent, 'Package lock inputs differ');
    assert.ok(report.cesiumEntryEquivalent, 'Resolved Cesium entry differs');
    assert.equal(report.samples.length, 10);
    report.summary = summarize(report);
    report.status = 'completed';
    atomicReport(output, report);
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.stack || error);
    atomicReport(output, report);
    throw error;
  }
}
