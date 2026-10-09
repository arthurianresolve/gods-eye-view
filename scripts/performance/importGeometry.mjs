/** Node-only main-thread preparation comparison; no render/interaction claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Cesium from 'cesium';

const script = fileURLToPath(import.meta.url);
const option = (key) => process.argv[process.argv.indexOf(key) + 1];
const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const fingerprint = (entity) => {
  const hierarchy = entity.polygon?.hierarchy.getValue();
  const groups = hierarchy
    ? [hierarchy.positions, ...hierarchy.holes.map((hole) => hole.positions)]
    : [entity.polyline.positions.getValue()];
  const hash = createHash('sha256');
  for (const positions of groups) {
    hash.update(String(positions.length) + ':');
    const values = new Float64Array(positions.length * 3);
    positions.forEach((value, i) =>
      values.set([value.x, value.y, value.z], i * 3),
    );
    hash.update(Buffer.from(values.buffer));
  }
  return hash.digest('hex');
};

if (process.argv.includes('--child')) {
  const root = path.resolve(option('--child'));
  assert.equal(
    git(root, ['status', '--porcelain', '--untracked-files=no']),
    '',
    'Tracked source must be clean',
  );
  const { createImportedGeometryLayer } = await import(
    pathToFileURL(path.join(root, 'src/imports/runtimeLayer.js'))
  );
  globalThis.window = { dispatchEvent() {} };
  const entities = new Cesium.EntityCollection();
  let batches = [];
  const layer = createImportedGeometryLayer({
    viewer: { entities, scene: { canvas: {}, requestRender() {} } },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
    batchOptions: {
      schedule(callback) {
        return setTimeout(() => {
          const start = performance.now();
          callback();
          batches.push(performance.now() - start);
        }, 0);
      },
    },
  });
  const ring = (count, radius) => {
    const result = Array.from({ length: count - 1 }, (_, i) => {
      const angle = (i / (count - 1)) * Math.PI * 2;
      return [
        -97 + Math.cos(angle) * radius,
        30 + Math.sin(angle) * radius,
        25,
      ];
    });
    return [...result, [...result[0]]];
  };
  const reports = [];
  try {
    for (const type of ['LineString', 'Polygon']) {
      const coordinates =
        type === 'LineString'
          ? ring(50_000, 0.1)
          : [ring(25_000, 0.1), ring(25_000, 0.02)];
      const input = [
        {
          id: 'fixture',
          kind: 'geojson',
          records: [{ id: 'shape', geometry: { type, coordinates } }],
        },
      ];
      for (let index = 0; index < 4; index++) {
        batches = [];
        const start = performance.now();
        const pending = layer.loadAsync(input);
        batches.push(performance.now() - start);
        await pending;
        const durationMs = performance.now() - start;
        if (index === 3)
          reports.push({
            type,
            vertices: 50_000,
            durationMs,
            maximumBatchMs: Math.max(...batches),
            batches: batches.length,
            geometrySha256: fingerprint(entities.values[0]),
            entityId: entities.values[0].id,
          });
        layer.clear();
      }
    }
  } finally {
    layer.destroy();
  }
  console.log(
    JSON.stringify({ commit: git(root, ['rev-parse', 'HEAD']), reports }),
  );
} else {
  assert.ok(
    process.argv.includes('--baseline') && process.argv.includes('--out'),
  );
  const roots = {
    baseline: path.resolve(option('--baseline')),
    candidate: path.resolve(path.dirname(script), '../..'),
  };
  const report = {
    schema: 'gev-import-geometry-cpu/v1',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    scope:
      'Node entity/coordinate preparation; three warmups per workload per child, five alternating pairs; excludes raw decoding, WebGL, layout and GPU. No forced GC. Durations include ordinary timer scheduling.',
    samples: [],
  };
  for (let pair = 0; pair < 5; pair++) {
    for (const variant of pair % 2
      ? ['candidate', 'baseline']
      : ['baseline', 'candidate']) {
      const result = JSON.parse(
        execFileSync(process.execPath, [script, '--child', roots[variant]], {
          encoding: 'utf8',
          timeout: 30000,
        }),
      );
      report.samples.push({ pair, variant, ...result });
    }
  }
  report.geometryEquivalent = ['LineString', 'Polygon'].every(
    (type) =>
      new Set(
        report.samples.map(
          (sample) =>
            sample.reports.find((item) => item.type === type).geometrySha256,
        ),
      ).size === 1,
  );
  assert.ok(report.geometryEquivalent, 'Coordinate output changed');
  writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
  const median = (type, variant, key) =>
    report.samples
      .filter((sample) => sample.variant === variant)
      .map((sample) => sample.reports.find((item) => item.type === type)[key])
      .sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify(
      ['LineString', 'Polygon'].map((type) => ({
        type,
        baselineBatchMs: median(type, 'baseline', 'maximumBatchMs'),
        candidateBatchMs: median(type, 'candidate', 'maximumBatchMs'),
        baselineCompletionMs: median(type, 'baseline', 'durationMs'),
        candidateCompletionMs: median(type, 'candidate', 'durationMs'),
      })),
      null,
      2,
    ),
  );
}
