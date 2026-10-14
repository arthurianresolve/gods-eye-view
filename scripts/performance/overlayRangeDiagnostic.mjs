import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] || '.');
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const workerPath = resolve(
  root,
  'src/overlays/worldOverlayAllocation.worker.mjs',
);
const overlayPath = resolve(root, 'src/overlays/worldOverlay.js');
const source = readFileSync(workerPath, 'utf8');
const overlaySource = readFileSync(overlayPath, 'utf8');
const sourceSha256 = hash(`${hash(source)}\0${hash(overlaySource)}`);
const harnessSha256 = hash(readFileSync(fileURLToPath(import.meta.url)));
const gitStatus = () =>
  execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const startingStatus = gitStatus();
const controlOnly = process.argv.includes('--control-only');
execFileSync(
  'git',
  [
    'diff',
    'HEAD',
    '--quiet',
    '--',
    'src/overlays/worldOverlay.js',
    'src/overlays/worldOverlayAllocation.worker.mjs',
  ],
  { cwd: root, stdio: 'ignore' },
);
if (output && existsSync(output))
  throw new Error(`Refusing to overwrite ${output}`);

const instrumentedSource = instrumentWorkerOutput(source, workerPath);
const instrumentedOverlay = instrumentOverlay(overlaySource);
const temporaryWorker = resolve(
  root,
  `scripts/performance/.overlay-range-worker-${process.pid}-${randomUUID()}.mjs`,
);
const temporaryOverlay = resolve(
  root,
  `src/overlays/.worldOverlay-range-${process.pid}-${randomUUID()}.mjs`,
);
let ownsOutput = false;
const report = {
  schema: 'gev-overlay-range-census/v1',
  capturedAt: new Date().toISOString(),
  commit,
  harnessSha256,
  sourceSha256,
  fixtureSourceSha256: {
    worker: hash(source),
    overlay: hash(overlaySource),
  },
  instrumentedWorkerSha256: hash(instrumentedSource),
  instrumentedOverlaySha256: hash(instrumentedOverlay),
  node: process.version,
  platform: process.platform,
  osRelease: os.release(),
  cpuModel: os.cpus()[0]?.model || null,
  worktreeCleanAtStart: startingStatus === '',
  scope:
    'Counts from existing Node overlay allocation fixtures using mock Canvas2D; not a timing, browser, GPU, or rendered-equivalence result.',
  interpretation:
    'Finite-range early rejection can skip projection and visibility checks only for finite-range entries with distance alpha zero after positive clipW. Added distance work is counted only for finite-range entries currently rejected by safe-top or viewport/horizon/occluder tests. No optimization is applied.',
  workloads: [],
};
const profiles = [
  ['generic', 250],
  ['local-infrastructure', 320],
  ['all-live-radio', 864],
  ['phase6-detection', 5000],
];

try {
  writeFileSync(temporaryOverlay, instrumentedOverlay, { flag: 'wx' });
  const linkedWorker = instrumentedSource.replace(
    `from '${pathToFileURL(overlayPath).href}'`,
    `from '${pathToFileURL(temporaryOverlay).href}'`,
  );
  assert.notEqual(
    linkedWorker,
    instrumentedSource,
    'Worker did not link diagnostic overlay module.',
  );
  writeFileSync(temporaryWorker, linkedWorker, { flag: 'wx' });
  if (controlOnly) {
    const stdout = execFileSync(
      process.execPath,
      ['--no-concurrent-recompilation', temporaryWorker],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GEV_OVERLAY_CPU: '1',
          GEV_ALLOC_WARMUP: '10',
          GEV_ALLOC_PROFILE: 'generic',
          GEV_ALLOC_ENTRIES: '1',
          GEV_RANGE_DIAGNOSTIC: '1',
          GEV_RANGE_SANITY: '1',
        },
      },
    );
    const result = JSON.parse(stdout.trim().split('\n').at(-1));
    assert.equal(result.ok, true, 'Synthetic counter control failed.');
    const samples = result.samples.map((sample) => sample.rangeCensus);
    assert.ok(
      samples.every(Boolean),
      'Synthetic control must use the production projection path.',
    );
    const census = samples.reduce(
      (sum, sample) => addCounts(sum, sample),
      emptyCounts(),
    );
    const control = {
      scope:
        'synthetic instrumentation validation only; not an application workload or performance evidence',
      frames: result.samples.reduce((sum, sample) => sum + sample.frames, 0),
      configuredBaselineEntries: 1,
      syntheticEntries: 4,
      addedDistanceChecksPerFrame:
        (census.finiteRangeVisibilityRejectedSafeTop +
          census.finiteRangeVisibilityRejectedViewportHorizon) /
        Math.max(
          1,
          result.samples.reduce((sum, sample) => sum + sample.frames, 0),
        ),
      census,
    };
    assert.ok(
      census.rangeRejectedVisible > 0,
      'Visible finite-range rejection counter stayed zero.',
    );
    assert.ok(
      census.rangeRejectedVisibility > 0,
      'Viewport visibility rejection counter stayed zero.',
    );
    assert.ok(
      census.rangeRejectedSafeTop > 0,
      'Safe-top rejection counter stayed zero.',
    );
    assert.ok(
      census.unboundedEntries > 0 &&
        census.currentVisibilityRejectedViewportHorizon ===
          census.finiteRangeVisibilityRejectedViewportHorizon * 2 &&
        census.finiteRangeVisibilityRejectedViewportHorizon > 0,
      'Unbounded offscreen entry was not excluded from added distance work.',
    );
    report.instrumentationPositiveControl = control;
    writeReport();
    console.log(JSON.stringify({ instrumentationPositiveControl: control }));
  } else
    for (const [profile, configuredPopulation] of profiles) {
      const stdout = execFileSync(
        process.execPath,
        ['--no-concurrent-recompilation', temporaryWorker],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            GEV_OVERLAY_CPU: '1',
            GEV_ALLOC_PROFILE: profile,
            GEV_ALLOC_ENTRIES: String(configuredPopulation),
            GEV_RANGE_DIAGNOSTIC: '1',
          },
        },
      );
      const result = JSON.parse(stdout.trim().split('\n').at(-1));
      assert.equal(result.ok, true, `${profile} fixture failed`);
      assert.equal(result.profile, profile);
      assert.equal(result.entryCount, configuredPopulation);
      assert.equal(result.samples.length, 10);
      const censusSamples = result.samples.map((sample) => sample.rangeCensus);
      const hasRangeCensus = censusSamples.some(Boolean);
      assert.ok(
        censusSamples.every(Boolean) ||
          censusSamples.every((sample) => sample === null),
        `${profile}: inconsistent instrumentation samples`,
      );
      const census = hasRangeCensus
        ? censusSamples.reduce(
            (sum, sample) => addCounts(sum, sample),
            emptyCounts(),
          )
        : null;
      const frames = result.samples.reduce(
        (sum, sample) => sum + sample.frames,
        0,
      );
      assert.equal(frames, 6000);
      if (census) {
        assert.equal(
          census.finiteRangeEntries + census.unboundedEntries,
          census.positiveClipW,
        );
        assert.equal(
          census.rangeRejectedSafeTop +
            census.rangeRejectedVisibility +
            census.rangeRejectedVisible,
          census.finiteRangeRejected,
        );
        assert.equal(
          census.currentVisibilityRejectedSafeTop +
            census.currentVisibilityRejectedViewportHorizon,
          census.positiveClipWVisibilityRejected,
        );
      }
      const row = {
        profile,
        configuredPopulation,
        observedCandidateCount: result.samples.at(-1).candidates,
        observedPaintedCount: result.samples.at(-1).painted,
        frames,
        observation: census
          ? 'overlay-projection-path-observed'
          : 'custom-detection-path-does-not-use-overlay-projection',
        census,
        perFrame: census
          ? Object.fromEntries(
              Object.entries(census).map(([key, value]) => [
                key,
                value / frames,
              ]),
            )
          : null,
      };
      report.workloads.push(row);
      writeReport();
      console.log(JSON.stringify(row));
    }
} finally {
  rmSync(temporaryWorker, { force: true });
  rmSync(temporaryOverlay, { force: true });
}

assert.equal(
  gitStatus(),
  startingStatus,
  'Diagnostic changed pre-existing worktree state.',
);
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  commit,
);
assert.equal(
  hash(`${hash(readFileSync(workerPath))}\0${hash(readFileSync(overlayPath))}`),
  sourceSha256,
  'Fixture source changed during diagnostic.',
);
report.status = 'complete';
writeReport();
console.log(JSON.stringify({ status: report.status, output }));

function instrumentWorkerOutput(original, originalPath) {
  const replacements = [
    [
      '  const { entries, positions, drifts } = workload;',
      [
        '  const { entries, positions, drifts } = workload;',
        "  if (process.env.GEV_RANGE_SANITY === '1' && PROFILE === 'generic') {",
        '    const diagnosticPositions = [new Cesium.Cartesian3(0, 0, 0), new Cesium.Cartesian3(2, 0, 0), new Cesium.Cartesian3(0, 0.95, 0), new Cesium.Cartesian3(2, 0, 0)];',
        "    const diagnosticIds = ['range-visible', 'range-offscreen', 'range-safe-top', 'unbounded-offscreen'];",
        '    const diagnosticMaxDistances = [1, 1, 1, Number.POSITIVE_INFINITY];',
        '    for (let index = 0; index < diagnosticPositions.length; index++) {',
        '      const diagnosticEntry = { ...entries[0] };',
        '      diagnosticEntry.id = diagnosticIds[index];',
        '      diagnosticEntry.position = () => diagnosticPositions[index];',
        '      diagnosticEntry.maxDistance = diagnosticMaxDistances[index];',
        '      diagnosticEntry.distanceFadeStartRatio = 1;',
        '      if (index === 2) diagnosticEntry.safeTopRatio = 0.5;',
        '      entries.push(diagnosticEntry);',
        '    }',
        '  }',
      ].join('\n'),
    ],
    [
      '        const started = cpuClock.now();',
      '        if (globalThis.__gevOverlayRangeCensus) for (const key of Object.keys(globalThis.__gevOverlayRangeCensus)) globalThis.__gevOverlayRangeCensus[key] = 0;\n        const started = cpuClock.now();',
    ],
    [
      '          phases: getCpuTimings(),',
      '          phases: getCpuTimings(),\n          rangeCensus: globalThis.__gevOverlayRangeCensus ? { ...globalThis.__gevOverlayRangeCensus } : null,',
    ],
  ];
  let transformed = original;
  for (const [before, after] of replacements) {
    const count = transformed.split(before).length - 1;
    assert.equal(
      count,
      1,
      `Expected one worker source anchor, found ${count}: ${before.slice(0, 50)}`,
    );
    transformed = transformed.replace(before, after);
  }
  return transformed.replace(
    /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, quote, specifier) =>
      `from ${quote}${pathToFileURL(resolve(dirname(originalPath), specifier)).href}${quote}`,
  );
}

function instrumentOverlay(original) {
  const names =
    'snapshotCalls: 0, positiveClipW: 0, positiveClipWVisibilityRejected: 0, currentVisibilityRejectedSafeTop: 0, currentVisibilityRejectedViewportHorizon: 0, finiteRangeVisibilityRejectedSafeTop: 0, finiteRangeVisibilityRejectedViewportHorizon: 0, finiteRangeEntries: 0, finiteRangeRejected: 0, rangeRejectedSafeTop: 0, rangeRejectedVisibility: 0, rangeRejectedVisible: 0, unboundedEntries: 0';
  const replacements = [
    [
      'function snapshotAndProject(entry, source, viewProjection, keyhole) {',
      `function snapshotAndProject(entry, source, viewProjection, keyhole) {\n  const rangeCensus = globalThis.__gevOverlayRangeCensus || (globalThis.__gevOverlayRangeCensus = { ${names} });\n  rangeCensus.snapshotCalls++;`,
    ],
    [
      '  if (!(clipW > 0)) return null;\n  const invW = 1 / clipW;',
      [
        '  if (!(clipW > 0)) return null;',
        '  let __rangeCensusAlpha = 1;',
        '  rangeCensus.positiveClipW++;',
        '  if (Number.isFinite(entry.maxDistance)) {',
        '    rangeCensus.finiteRangeEntries++;',
        '    const __rangeCamera = _viewer.camera.positionWC;',
        '    const __rangeX = __rangeCamera.x - px, __rangeY = __rangeCamera.y - py, __rangeZ = __rangeCamera.z - pz;',
        '    const __rangeDistance = Math.sqrt(__rangeX * __rangeX + __rangeY * __rangeY + __rangeZ * __rangeZ);',
        '    __rangeCensusAlpha = distanceFade(__rangeDistance, record.distanceOptions);',
        '    if (__rangeCensusAlpha <= 0) rangeCensus.finiteRangeRejected++;',
        '  } else rangeCensus.unboundedEntries++;',
        '  const invW = 1 / clipW;',
      ].join('\n'),
    ],
    [
      '    if (record.screen.y < safeTop) return null;',
      [
        '    if (record.screen.y < safeTop) {',
        '      rangeCensus.positiveClipWVisibilityRejected++;',
        '      rangeCensus.currentVisibilityRejectedSafeTop++;',
        '      if (Number.isFinite(entry.maxDistance)) rangeCensus.finiteRangeVisibilityRejectedSafeTop++;',
        '      if (__rangeCensusAlpha <= 0) rangeCensus.rangeRejectedSafeTop++;',
        '      return null;',
        '    }',
      ].join('\n'),
    ],
    [
      '  if (\n    !isOverlayPointVisible(\n      entry,\n      record.position,\n      record.screen,\n      _viewport,\n      _occluder,\n    )\n  )\n    return null;',
      [
        '  if (',
        '    !isOverlayPointVisible(',
        '      entry,',
        '      record.position,',
        '      record.screen,',
        '      _viewport,',
        '      _occluder,',
        '    )',
        '  ) {',
        '    rangeCensus.positiveClipWVisibilityRejected++;',
        '    rangeCensus.currentVisibilityRejectedViewportHorizon++;',
        '    if (Number.isFinite(entry.maxDistance)) rangeCensus.finiteRangeVisibilityRejectedViewportHorizon++;',
        '    if (__rangeCensusAlpha <= 0) rangeCensus.rangeRejectedVisibility++;',
        '    return null;',
        '  }',
        '  if (__rangeCensusAlpha <= 0) rangeCensus.rangeRejectedVisible++;',
      ].join('\n'),
    ],
  ];
  let transformed = original;
  for (const [before, after] of replacements) {
    const count = transformed.split(before).length - 1;
    assert.equal(
      count,
      1,
      `Expected one overlay source anchor, found ${count}: ${before.slice(0, 55)}`,
    );
    transformed = transformed.replace(before, after);
  }
  return transformed;
}

function emptyCounts() {
  return {
    snapshotCalls: 0,
    positiveClipW: 0,
    positiveClipWVisibilityRejected: 0,
    currentVisibilityRejectedSafeTop: 0,
    currentVisibilityRejectedViewportHorizon: 0,
    finiteRangeVisibilityRejectedSafeTop: 0,
    finiteRangeVisibilityRejectedViewportHorizon: 0,
    finiteRangeEntries: 0,
    finiteRangeRejected: 0,
    rangeRejectedSafeTop: 0,
    rangeRejectedVisibility: 0,
    rangeRejectedVisible: 0,
    unboundedEntries: 0,
  };
}

function addCounts(total, value) {
  for (const key of Object.keys(total)) total[key] += value[key];
  return total;
}

function writeReport() {
  if (!output) return;
  mkdirSync(dirname(output), { recursive: true });
  if (!ownsOutput) {
    if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
    ownsOutput = true;
  } else {
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
