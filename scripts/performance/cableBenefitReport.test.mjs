import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CABLE_BENEFIT_MANIFEST_PATHS,
  CABLE_BENEFIT_MODES,
  CABLE_BENEFIT_PAIRS,
  CABLE_BENEFIT_SCHEMA,
  CABLE_BENEFIT_SOURCE_PATHS,
  summarizeCableBenefit,
  validateCableBenefit,
} from './cableBenefitReport.mjs';
import { CABLE_REFERENCE_RENDER_POPULATION } from '../fixtures/cable-reference-collections-contract.mjs';

const commit = '1'.repeat(40);
const digest = 'a'.repeat(64);
const camera = {
  position: [1, 2, 3],
  direction: [0, 0, -1],
  up: [0, 1, 0],
};
const source = {
  population: { ...CABLE_REFERENCE_RENDER_POPULATION },
  cableGeoSha256: digest,
  landingGeoSha256: digest,
  identitySha256: digest,
};
const geometryComponents = {
  sourceGeometrySha256: digest,
  referenceGeometrySha256: digest,
  referenceStylesSha256: digest,
  sourceIdsSha256: digest,
};
const graphics = {
  featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
  devices: [],
};

function manifestFileHashes() {
  return Object.fromEntries(
    CABLE_BENEFIT_MANIFEST_PATHS.flatMap((path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      return manifest.files.map((file) => [
        file.relativePath,
        file.patchedSha256,
      ]);
    }),
  );
}

function makeRun(mode, suite, index, orderIndex) {
  const memory =
    suite === 'memory'
      ? {
          gcRequested: true,
          metric: 'Performance.getMetrics.JSHeapUsedSize',
          baseline: 1_000_000,
          enabled: 1_500_000 + index,
          destroyed: 1_100_000,
          viewerDestroyed: 1_020_000,
        }
      : null;
  const environment = {
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics, D3D11)',
    vendor: 'Intel',
    viewport: { width: 1200, height: 1000, dpr: 1 },
    drawingBuffer: { width: 960, height: 640 },
    graphics,
    rendererClass: {
      kind: 'native-gpu',
      accelerationVerified: true,
      physicalDesktopCoverage: false,
    },
  };
  const pointPick = {
    kind: 'point',
    ownerVerified: true,
    entityId: 'landing-point-reference-0-example',
    sourceRecordId: 'example-landing',
    screen: [480, 320],
    primitiveType: mode === 'entities' ? 'Billboard' : 'PointPrimitive',
    appearanceType: null,
  };
  const stemPick = {
    kind: 'stem',
    ownerVerified: true,
    entityId: 'cable-reference-0-example',
    sourceRecordId: 'example-cable',
    screen: [470, 320],
    primitiveType: mode === 'entities' ? 'Primitive' : 'Polyline',
    appearanceType: mode === 'entities' ? 'PolylineColorAppearance' : null,
  };
  return {
    mode,
    suite,
    index,
    orderIndex,
    applicationCommit: commit,
    harnessCommit: commit,
    phase: 'viewer-destroyed',
    status: 'passed',
    pageErrors: [],
    contextClosed: true,
    sessionDetached: true,
    cleanupComplete: true,
    source,
    population: { ...CABLE_REFERENCE_RENDER_POPULATION },
    renderClock: { iso: '2026-10-11T12:34:56.000Z', shouldAnimate: false },
    settings: {
      sceneMode: 'SCENE3D',
      resolutionScale: 1,
      msaaSamples: 4,
      antialias: true,
      preserveDrawingBuffer: true,
      requestRenderMode: false,
      webglVersion: 'WebGL 2.0',
      globeShown: true,
      terrainProvider: 'EllipsoidTerrainProvider',
    },
    environment,
    timings: {
      populationReadyMs: 100 + index * 5 + (mode === 'collections' ? 1 : 0),
      readyFrameMs: 110 + index * 5 + (mode === 'collections' ? 2 : 0),
      readyFrames: 3,
      deadlineMs: 180_000,
    },
    readiness: { ready: true, truncated: false, pending: [] },
    warmup: { dataSources: 0, primitives: 2, groundPrimitives: 1 },
    ownership: {
      referenceGraphics: mode === 'entities' ? 2629 : 0,
      collections: mode === 'entities' ? 0 : 2,
      points: mode === 'entities' ? 0 : 2629,
      stems: mode === 'entities' ? 0 : 2629,
      dataSources: 3,
      listeners: 4,
    },
    teardown: {
      layerDestroyed: true,
      viewerDestroyed: true,
      ownerCountAfterDestroy: 0,
      dataSources: 0,
      primitives: 2,
      groundPrimitives: 1,
      listeners: 0,
      collections: 0,
    },
    pointPick,
    stemPick,
    geometrySha256: digest,
    geometryComponents,
    image: {
      file: `${suite}-pair-${String(index + 1).padStart(2, '0')}-${mode}.png`,
      pixelSha256: digest,
      pngSha256: digest,
      width: 960,
      height: 640,
      bytes: 1000,
    },
    camera,
    visibilityCycle: {
      cycles: 2,
      restoredIdentity: true,
      firstPixelSha256: digest,
      restoredPixelSha256: digest,
      disabledOwnership: Array.from({ length: 2 }, () => ({
        dataSources: 0,
        referenceCollections: 0,
        pointPrimitives: 0,
        stemPrimitives: 0,
        overlayVisible: false,
        overlayEntries: 0,
      })),
    },
    memory,
  };
}

function makeReport() {
  const pairs = [];
  for (const suite of ['latency', 'memory']) {
    for (let index = 0; index < CABLE_BENEFIT_PAIRS; index += 1) {
      const order =
        index % 2 ? ['collections', 'entities'] : [...CABLE_BENEFIT_MODES];
      const runs = Object.fromEntries(
        order.map((mode, orderIndex) => [
          mode,
          makeRun(mode, suite, index, orderIndex),
        ]),
      );
      const entity = runs.entities;
      const collection = runs.collections;
      pairs.push({
        suite,
        index,
        order,
        runs,
        deltas: {
          populationReadyPercent:
            (collection.timings.populationReadyMs /
              entity.timings.populationReadyMs) *
              100 -
            100,
          readyFramePercent:
            (collection.timings.readyFrameMs / entity.timings.readyFrameMs) *
              100 -
            100,
          ...(suite === 'memory'
            ? {
                enabledHeapPercent:
                  ((collection.memory.enabled - collection.memory.baseline) /
                    Math.max(
                      1,
                      entity.memory.enabled - entity.memory.baseline,
                    )) *
                    100 -
                  100,
              }
            : {}),
        },
      });
    }
  }
  const files = Object.fromEntries(
    CABLE_BENEFIT_SOURCE_PATHS.map((path) => [path, digest]),
  );
  files['package-lock.json'] = digest;
  const report = {
    schema: CABLE_BENEFIT_SCHEMA,
    status: 'passed',
    applicationCommit: commit,
    harnessCommit: commit,
    sourceDirty: false,
    sourceChanged: false,
    hardwareRenderingValidated: false,
    benefitAccepted: false,
    pairs,
    cleanup: {
      initialPageClosed: true,
      pagesClosed: true,
      sessionsDetached: true,
      browserClosed: true,
      serverClosed: true,
      sourceTreeUnchanged: true,
    },
    provenance: {
      cesiumVersion: '1.138.0',
      engineVersion: '22.3.0',
      packageLockSha256: digest,
      files,
      patchManifests: Object.fromEntries(
        CABLE_BENEFIT_MANIFEST_PATHS.map((path) => [path, digest]),
      ),
      installedDependencyBytes: {
        cesiumVersion: '1.138.0',
        engineVersion: '22.3.0',
        cesiumPackageSha256: digest,
        enginePackageSha256: digest,
        cesiumFiles: manifestFileHashes(),
      },
    },
    graphics,
  };
  report.summary = summarizeCableBenefit(report);
  return report;
}

test('accepts ten complete alternating cable renderer trials with separate memory runs', () => {
  assert.equal(validateCableBenefit(makeReport(), commit), true);
});

test('rejects a missing pair', () => {
  const report = makeReport();
  report.pairs.pop();
  assert.throws(() => validateCableBenefit(report, commit));
});

test('rejects a duplicated pair even if the overall pair count is preserved', () => {
  const report = makeReport();
  report.pairs[9] = structuredClone(report.pairs[8]);
  assert.throws(() => validateCableBenefit(report, commit));
});

test('rejects stale summary values even when per-pair evidence is valid', () => {
  const report = makeReport();
  report.summary.populationReadyMs.candidate += 1;
  assert.throws(() => validateCableBenefit(report, commit));
});

test('rejects mismatched pixels or native pick identity', () => {
  const pixels = makeReport();
  pixels.pairs[0].runs.collections.image.pixelSha256 = 'b'.repeat(64);
  assert.throws(() => validateCableBenefit(pixels, commit));
  const pick = makeReport();
  pick.pairs[0].runs.collections.stemPick.entityId = 'different-source';
  assert.throws(() => validateCableBenefit(pick, commit));
});

test('rejects software renderers and incomplete graphics acceleration reports', () => {
  const software = makeReport();
  for (const pair of software.pairs)
    for (const run of Object.values(pair.runs))
      run.environment.renderer = 'ANGLE (SwiftShader Device)';
  assert.throws(() => validateCableBenefit(software, commit));
  const unknown = makeReport();
  unknown.graphics.featureStatus.webgl = 'disabled';
  assert.throws(() => validateCableBenefit(unknown, commit));
});

test('rejects missing ownership, re-enable, or cleanup evidence', () => {
  const ownership = makeReport();
  ownership.pairs[1].runs.collections.visibilityCycle.disabledOwnership[0].pointPrimitives = 1;
  assert.throws(() => validateCableBenefit(ownership, commit));
  const cleanup = makeReport();
  cleanup.pairs[0].runs.entities.teardown.listeners = 1;
  assert.throws(() => validateCableBenefit(cleanup, commit));
});

test('rejects wrong dependency patch hashes and incomplete forced-GC samples', () => {
  const bytes = makeReport();
  bytes.provenance.installedDependencyBytes.cesiumFiles[
    'Source/Scene/Camera.js'
  ] = digest;
  assert.throws(() => validateCableBenefit(bytes, commit));
  const memory = makeReport();
  memory.pairs.find(
    (pair) => pair.suite === 'memory',
  ).runs.entities.memory.enabled = -1;
  assert.throws(() => validateCableBenefit(memory, commit));
});
