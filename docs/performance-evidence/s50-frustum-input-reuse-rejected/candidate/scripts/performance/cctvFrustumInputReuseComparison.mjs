import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Cesium from 'cesium';
import { createGeometry as createCandidateGeometry } from '../../src/layers/cctv/geometry.js';
import { createModel } from '../../src/layers/cctv/model.js';
import { poseHash, SUPPORT_KEYS } from '../../src/data/cctvFootprint.js';

const BASELINE = '37afdc6d66b74487ee2280dacc38566ccb3a1530';
const GEOMETRY_PATH = 'src/layers/cctv/geometry.js';
const DEPENDENCIES = [
  'src/layers/cctv/model.js',
  'src/layers/cctv/policy.js',
  'src/data/cctvFootprint.js',
  'src/data/cctvViewshed.js',
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = process.argv[2] ? resolve(process.argv[2]) : null;
assert.ok(
  outputPath,
  'Usage: node scripts/performance/cctvFrustumInputReuseComparison.mjs FRESH_OUTPUT_DIR',
);
assert.notEqual(outputPath, root, 'Output must not replace the repository');
assert.ok(
  outputPath.startsWith(`${root}/`) || outputPath.startsWith(`${root}\\`),
  'Output must stay inside this checkout',
);
mkdirSync(outputPath, { recursive: false });

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitBytes = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'buffer' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baselineHead = git('rev-parse', 'HEAD');
assert.equal(baselineHead, BASELINE, 'Unexpected baseline commit');
const initialStatus = git('status', '--porcelain');
const candidateBytes = readFileSync(resolve(root, GEOMETRY_PATH));
const harnessBytes = readFileSync(fileURLToPath(import.meta.url));
const cesiumPackageBytes = readFileSync(
  resolve(root, 'node_modules/cesium/package.json'),
);
const baselineBytes = gitBytes('show', `${BASELINE}:${GEOMETRY_PATH}`);
const dependencyHashes = Object.fromEntries(
  DEPENDENCIES.map((path) => {
    const workBytes = readFileSync(resolve(root, path));
    const baselineDependencyBytes = gitBytes('show', `${BASELINE}:${path}`);
    assert.deepEqual(
      workBytes,
      baselineDependencyBytes,
      `Runtime dependency differs from pinned baseline: ${path}`,
    );
    return [path, sha(workBytes)];
  }),
);
const baselineSource = baselineBytes.toString('utf8');
const importMap = {
  "'../../data/cctvViewshed.js'": `'${pathToFileURL(resolve(root, 'src/data/cctvViewshed.js')).href}'`,
  "'./policy.js'": `'${pathToFileURL(resolve(root, 'src/layers/cctv/policy.js')).href}'`,
  "'../../data/cctvFootprint.js'": `'${pathToFileURL(resolve(root, 'src/data/cctvFootprint.js')).href}'`,
};
let isolatedBaselineSource = baselineSource;
for (const [before, after] of Object.entries(importMap)) {
  assert.ok(
    isolatedBaselineSource.includes(before),
    `Missing baseline import ${before}`,
  );
  isolatedBaselineSource = isolatedBaselineSource.replaceAll(before, after);
}
const baselineModulePath = resolve(outputPath, 'baseline-geometry.mjs');
writeFileSync(baselineModulePath, isolatedBaselineSource);
const { createGeometry: createBaselineGeometry } = await import(
  `${pathToFileURL(baselineModulePath).href}?source=${sha(baselineBytes)}`
);

function createFixture(createGeometry, workload) {
  const state = {};
  const services = { focus: {}, ground: {}, mesh: {} };
  const parts = {
    ground: { currentSurfaceRegime: () => 'globe' },
    projection: { updatePlanePlacement() {} },
  };
  parts.model = createModel({ state, services, parts, source: {} });
  let projectPointCalls = 0;
  const projectPoint = parts.model.projectPoint;
  parts.model.projectPoint = (...args) => {
    projectPointCalls += 1;
    return projectPoint(...args);
  };
  const geometry = createGeometry({ state, services, parts, source: {} });
  const records = Array.from({ length: 12 }, (_, index) => {
    const camera = {
      id: `benchmark-${index}`,
      lat: 40.7 + index * 0.0001,
      lon: -73.9 - index * 0.0001,
      headingDeg: 90 + index,
      pitchDeg: -17,
      fovDeg: 74,
      rangeM: 700 + index,
      mountHeightM: 24,
    };
    const pose = geometry.footprintPose({ camera });
    return {
      camera,
      probeClampRangeM: null,
      footprintGround: {
        poseHash: poseHash(pose),
        supports: Object.fromEntries(
          SUPPORT_KEYS.map((key) => [key, 30 + index]),
        ),
      },
      coverageEntities: Array.from({ length: 5 }, () => ({
        polyline: { positions: null },
      })),
    };
  });
  return {
    geometry,
    records,
    projectPointCalls: () => projectPointCalls,
    workload,
  };
}

function applyWorkload(fixture, step) {
  const { records, geometry, workload } = fixture;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    let ground = 120 + index;
    if (
      workload === 'moving' ||
      (workload === 'intermittent-pose' && step % 8 === 0)
    )
      record.camera.headingDeg += 0.001;
    if (workload === 'terrain') {
      ground += Math.floor(step / 8) * 0.25;
      if (record.footprintGround && step % 8 === 0)
        record.footprintGround.supports.tr += 0.25;
    }
    geometry.applyFrustumGeometry(record, ground);
  }
}

function outputHash(fixture) {
  return sha(
    Buffer.from(
      JSON.stringify(
        fixture.records.map((record) => ({
          geometry: record.frustumGeometry,
          positions: record.frustumPositions
            ? Object.fromEntries(
                Object.keys(record.frustumPositions)
                  .sort()
                  .map((key) => {
                    const { x, y, z } = record.frustumPositions[key];
                    return [key, [x, y, z]];
                  }),
              )
            : null,
          coverage: record.coverageEntities.map((entity) =>
            entity.polyline.positions?.map(({ x, y, z }) => [x, y, z]),
          ),
        })),
      ),
    ),
  );
}

function runTrial(createGeometry, workload, steps) {
  const fixture = createFixture(createGeometry, workload);
  for (let step = 0; step < 30; step += 1) applyWorkload(fixture, step);
  const projectCallsBefore = fixture.projectPointCalls();
  const start = performance.now();
  for (let step = 30; step < 30 + steps; step += 1)
    applyWorkload(fixture, step);
  const elapsedMs = performance.now() - start;
  return {
    elapsedMs,
    operations: steps * fixture.records.length,
    projectPointCalls: fixture.projectPointCalls() - projectCallsBefore,
    outputSha256: outputHash(fixture),
  };
}

const steps = 350;
const workloads = ['unchanged', 'moving', 'intermittent-pose', 'terrain'];
const comparisons = {};
for (const workload of workloads) {
  const samples = [];
  for (let pair = 0; pair < 5; pair += 1) {
    const order =
      pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const pairResults = {};
    for (const side of order) {
      pairResults[side] = runTrial(
        side === 'baseline' ? createBaselineGeometry : createCandidateGeometry,
        workload,
        steps,
      );
    }
    assert.equal(
      pairResults.baseline.operations,
      pairResults.candidate.operations,
    );
    assert.equal(
      pairResults.baseline.outputSha256,
      pairResults.candidate.outputSha256,
      `${workload} output diverged in pair ${pair + 1}`,
    );
    samples.push({ pair: pair + 1, order, ...pairResults });
  }
  const baselineTimes = samples
    .map(({ baseline }) => baseline.elapsedMs)
    .sort((a, b) => a - b);
  const candidateTimes = samples
    .map(({ candidate }) => candidate.elapsedMs)
    .sort((a, b) => a - b);
  comparisons[workload] = {
    pairs: samples,
    baselineMedianMs: baselineTimes[2],
    candidateMedianMs: candidateTimes[2],
    medianChangePercent: (candidateTimes[2] / baselineTimes[2] - 1) * 100,
  };
}

assert.equal(
  git('rev-parse', 'HEAD'),
  baselineHead,
  'HEAD changed during the comparison',
);
assert.equal(
  git('status', '--porcelain'),
  initialStatus,
  'Tracked or untracked repository state changed during comparison',
);
assert.deepEqual(
  readFileSync(resolve(root, GEOMETRY_PATH)),
  candidateBytes,
  'Candidate source changed during comparison',
);
assert.deepEqual(
  readFileSync(fileURLToPath(import.meta.url)),
  harnessBytes,
  'Harness source changed during comparison',
);
for (const [path, expected] of Object.entries(dependencyHashes))
  assert.equal(
    sha(readFileSync(resolve(root, path))),
    expected,
    `Dependency changed during comparison: ${path}`,
  );

const report = {
  schemaVersion: 1,
  evidenceType:
    'actual-function CPU microbenchmark; not full-layer, rendering, or GPU acceptance',
  baselineCommit: BASELINE,
  candidateBaseCommit: baselineHead,
  candidateWorkingTreeSource: true,
  baselineSourceSha256: sha(baselineBytes),
  candidateSourceSha256: sha(candidateBytes),
  dependencySha256: dependencyHashes,
  harnessSha256: sha(harnessBytes),
  cesium: { version: Cesium.VERSION, packageSha256: sha(cesiumPackageBytes) },
  node: process.version,
  forcedGc: false,
  records: 12,
  stepsPerTrial: steps,
  operationCountPerTrial: steps * 12,
  order: 'five alternating baseline/candidate pairs per workload',
  comparisons,
};
writeFileSync(
  resolve(outputPath, 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      outputPath,
      summary: Object.fromEntries(
        Object.entries(comparisons).map(([key, value]) => [
          key,
          {
            baselineMedianMs: value.baselineMedianMs,
            candidateMedianMs: value.candidateMedianMs,
            medianChangePercent: value.medianChangePercent,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
// The generated baseline module is owned by this output directory and kept for
// provenance. It contains only the pinned baseline file with import URLs fixed.
