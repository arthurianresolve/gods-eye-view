import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CABLE_REFERENCE_RENDER_POPULATION } from '../fixtures/cable-reference-collections-contract.mjs';
import { classifyRenderer } from './rendererEvidence.mjs';

export const CABLE_BENEFIT_SCHEMA = 'gev-cable-reference-benefit/v1';
export const CABLE_BENEFIT_PAIRS = 5;
export const CABLE_BENEFIT_MODES = ['entities', 'collections'];
export const CABLE_BENEFIT_MANIFEST_PATHS = Object.freeze([
  'patches/cesium-1.138.0-inertia.json',
  'patches/cesium-1.138.0-collision-transform.json',
]);
export const CABLE_BENEFIT_SOURCE_PATHS = Object.freeze([
  'package-lock.json',
  ...CABLE_BENEFIT_MANIFEST_PATHS,
  'src/app/viewer.js',
  'src/app/atmosphereCompat.js',
  'src/app/cameraAnglesCompat.js',
  'src/freshFrame.js',
  'src/performance/performanceSnapshot.js',
  'src/renderGovernor.js',
  'src/layers/submarineCables/index.js',
  'src/layers/submarineCables/bundledSource.js',
  'src/layers/submarineCables/geometry.js',
  'src/layers/submarineCables/ingestion.js',
  'src/layers/submarineCables/lifecycle.js',
  'src/layers/submarineCables/policy.js',
  'src/layers/submarineCables/rendering.js',
  'src/layers/submarineCables/state.js',
  'src/layers/submarineCables/surface.js',
  'src/layers/submarineCables/interaction.js',
  'src/layers/submarineCables/overlay.js',
  'src/data/dataCredits.js',
  'src/data/local_data/telegeography_submarine_cables/cable-geo.json',
  'src/data/local_data/telegeography_submarine_cables/landing-point-geo.json',
  'scripts/fixtures/cable-reference-benefit.html',
  'scripts/fixtures/cable-reference-benefit.mjs',
  'scripts/fixtures/cableReferenceFixture.mjs',
  'scripts/fixtures/cable-reference-collections-contract.mjs',
  'scripts/fixtures/cableCameraSweep.mjs',
  'scripts/fixtures/cableFailureDiagnostics.mjs',
  'scripts/fixtures/scenePrimitiveReadiness.mjs',
  'scripts/performance/cableBenefitComparison.mjs',
  'scripts/performance/cableBenefitReport.mjs',
  'scripts/performance/cableBenefitReport.test.mjs',
  'scripts/fixtures/cable-reference-collections-ui.js',
  'scripts/performance/rendererEvidence.mjs',
  'scripts/performance/profileRecoveryPageOwnership.mjs',
  'scripts/performance/fixtureInterception.mjs',
]);
const PATCH_MANIFESTS = CABLE_BENEFIT_MANIFEST_PATHS.map((path) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')),
);
const EXPECTED_PATCHED_CESIUM_FILES = Object.fromEntries(
  PATCH_MANIFESTS.flatMap((manifest) =>
    manifest.files.map((file) => [file.relativePath, file.patchedSha256]),
  ),
);
const digest = (value) => /^[a-f0-9]{64}$/.test(value || '');
const finite = (value) => Number.isFinite(value) && value >= 0;
const median = (values) => [...values].sort((a, b) => a - b)[2];
const percent = (baseline, candidate) =>
  baseline === 0 ? null : (candidate / baseline - 1) * 100;

/** Convert the observed fixture phase using the same contract checked below. */
export function cableTeardownRecord(state) {
  assert.equal(state.phase, 'layer-destroyed');
  for (const key of [
    'dataSources',
    'listeners',
    'collections',
    'primitives',
    'groundPrimitives',
  ])
    assert.ok(
      Number.isSafeInteger(state.teardown?.[key]) && state.teardown[key] >= 0,
      `Missing teardown ${key}`,
    );
  return {
    layerDestroyed: true,
    viewerDestroyed: false,
    ownerCountAfterDestroy: state.teardown.collections,
    dataSources: state.teardown.dataSources,
    listeners: state.teardown.listeners,
    collections: state.teardown.collections,
    primitives: state.teardown.primitives,
    groundPrimitives: state.teardown.groundPrimitives,
  };
}

export function summarizeCableBenefit(report) {
  const summary = {};
  for (const [metric, suite, read] of [
    ['populationReadyMs', 'latency', (run) => run.timings.populationReadyMs],
    ['readyFrameMs', 'latency', (run) => run.timings.readyFrameMs],
    [
      'enabledJsHeapDeltaBytes',
      'memory',
      (run) => run.memory.enabled - run.memory.baseline,
    ],
  ]) {
    const pairs = report.pairs.filter((pair) => pair.suite === suite);
    const baseline = median(pairs.map((pair) => read(pair.runs.entities)));
    const candidate = median(pairs.map((pair) => read(pair.runs.collections)));
    summary[metric] = {
      baseline,
      candidate,
      changePercent: percent(baseline, candidate),
      pairedChangePercent: pairs.map((pair) =>
        percent(read(pair.runs.entities), read(pair.runs.collections)),
      ),
    };
  }
  return summary;
}

export function validateCableBenefit(report, expectedCommit) {
  assert.match(expectedCommit, /^[a-f0-9]{40}$/);
  assert.equal(report.schema, CABLE_BENEFIT_SCHEMA);
  assert.equal(report.status, 'passed');
  assert.equal(report.applicationCommit, expectedCommit);
  assert.equal(report.harnessCommit, expectedCommit);
  assert.equal(report.sourceDirty, false);
  assert.equal(report.sourceChanged, false);
  assert.equal(report.hardwareRenderingValidated, false);
  assert.equal(report.benefitAccepted, false);
  assert.equal(report.pairs.length, 10);
  assert.equal(report.cleanup.initialPageClosed, true);
  assert.equal(report.cleanup.pagesClosed, true);
  assert.equal(report.cleanup.sessionsDetached, true);
  assert.equal(report.cleanup.browserClosed, true);
  assert.equal(report.cleanup.serverClosed, true);
  assert.equal(report.cleanup.sourceTreeUnchanged, true);
  assert.equal(report.provenance.cesiumVersion, '1.138.0');
  assert.equal(report.provenance.engineVersion, '22.3.0');
  assert.ok(digest(report.provenance.packageLockSha256));
  for (const path of CABLE_BENEFIT_SOURCE_PATHS)
    assert.ok(
      digest(report.provenance.files?.[path]),
      `Missing provenance hash for ${path}`,
    );
  assert.equal(
    report.provenance.files['package-lock.json'],
    report.provenance.packageLockSha256,
  );
  for (const hash of Object.values(report.provenance.files))
    assert.ok(digest(hash));
  assert.deepEqual(report.provenance.patchManifests, {
    [CABLE_BENEFIT_MANIFEST_PATHS[0]]:
      report.provenance.files[CABLE_BENEFIT_MANIFEST_PATHS[0]],
    [CABLE_BENEFIT_MANIFEST_PATHS[1]]:
      report.provenance.files[CABLE_BENEFIT_MANIFEST_PATHS[1]],
  });
  const installed = report.provenance.installedDependencyBytes;
  assert.equal(installed?.cesiumVersion, '1.138.0');
  assert.equal(installed?.engineVersion, '22.3.0');
  assert.ok(digest(installed?.cesiumPackageSha256));
  assert.ok(digest(installed?.enginePackageSha256));
  assert.deepEqual(installed?.cesiumFiles, EXPECTED_PATCHED_CESIUM_FILES);
  assert.equal(report.graphics?.featureStatus?.webgl, 'enabled');
  for (const suite of ['latency', 'memory']) {
    const pairs = report.pairs.filter((pair) => pair.suite === suite);
    assert.equal(pairs.length, 5);
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index];
      assert.equal(pair.index, index);
      assert.deepEqual(
        pair.order,
        index % 2 ? ['collections', 'entities'] : CABLE_BENEFIT_MODES,
      );
      assert.deepEqual(
        Object.keys(pair.runs).sort(),
        [...CABLE_BENEFIT_MODES].sort(),
      );
      for (const mode of CABLE_BENEFIT_MODES) {
        const run = pair.runs[mode];
        assert.equal(run.orderIndex, pair.order.indexOf(mode));
        assert.equal(run.mode, mode);
        assert.equal(run.status, 'passed');
        assert.equal(run.phase, 'viewer-destroyed');
        assert.equal(run.applicationCommit, expectedCommit);
        assert.equal(run.harnessCommit, expectedCommit);
        assert.equal(run.pageErrors.length, 0);
        assert.equal(run.contextClosed, true);
        assert.equal(run.sessionDetached, true);
        assert.equal(run.cleanupComplete, true);
        assert.equal(run.teardown.layerDestroyed, true);
        assert.equal(run.teardown.viewerDestroyed, true);
        assert.equal(run.teardown.ownerCountAfterDestroy, 0);
        assert.deepEqual(run.population, CABLE_REFERENCE_RENDER_POPULATION);
        assert.deepEqual(
          run.source.population,
          CABLE_REFERENCE_RENDER_POPULATION,
        );
        for (const key of [
          'cableGeoSha256',
          'landingGeoSha256',
          'identitySha256',
        ])
          assert.ok(digest(run.source[key]));
        assert.ok(digest(run.geometrySha256));
        for (const key of [
          'sourceGeometrySha256',
          'referenceGeometrySha256',
          'referenceStylesSha256',
          'sourceIdsSha256',
        ])
          assert.ok(digest(run.geometryComponents?.[key]));
        assert.ok(digest(run.image.pixelSha256) && digest(run.image.pngSha256));
        assert.equal(
          run.image.file,
          `${suite}-pair-${String(index + 1).padStart(2, '0')}-${mode}.png`,
        );
        assert.equal(run.image.width, 960);
        assert.equal(run.image.height, 640);
        assert.ok(
          Number.isSafeInteger(run.image.bytes) && run.image.bytes > 32,
        );
        assert.equal(run.readiness.ready, true);
        assert.equal(run.readiness.truncated, false);
        assert.equal(run.readiness.pending.length, 0);
        assert.equal(run.timings.readyFrames, 3);
        assert.equal(run.timings.deadlineMs, 180000);
        assert.ok(finite(run.timings.populationReadyMs));
        assert.ok(finite(run.timings.readyFrameMs));
        assert.ok(
          run.timings.readyFrameMs >= run.timings.populationReadyMs &&
            run.timings.readyFrameMs <= 180000,
        );
        assert.equal(run.settings.sceneMode, 'SCENE3D');
        assert.equal(run.settings.resolutionScale, 1);
        assert.equal(run.settings.msaaSamples, 4);
        assert.equal(run.settings.antialias, true);
        assert.equal(run.settings.preserveDrawingBuffer, true);
        assert.equal(run.settings.requestRenderMode, false);
        assert.ok(typeof run.settings.webglVersion === 'string');
        assert.equal(run.settings.globeShown, true);
        assert.equal(run.settings.terrainProvider, 'EllipsoidTerrainProvider');
        assert.deepEqual(run.environment.viewport, {
          width: 1200,
          height: 1000,
          dpr: 1,
        });
        assert.equal(run.environment.drawingBuffer.width, 960);
        assert.equal(run.environment.drawingBuffer.height, 640);
        assert.equal(
          classifyRenderer(run.environment.renderer, report.graphics)
            .accelerationVerified,
          true,
        );
        assert.deepEqual(run.renderClock, {
          iso: '2026-10-11T12:34:56.000Z',
          shouldAnimate: false,
        });
        assert.equal(
          run.ownership.referenceGraphics,
          mode === 'entities' ? 2629 : 0,
        );
        assert.equal(run.ownership.collections, mode === 'entities' ? 0 : 2);
        assert.equal(run.ownership.points, mode === 'entities' ? 0 : 2629);
        assert.equal(run.ownership.stems, mode === 'entities' ? 0 : 2629);
        assert.ok(Number.isSafeInteger(run.ownership.listeners));
        assert.ok(run.ownership.listeners > 0);
        assert.equal(run.visibilityCycle.cycles, 2);
        assert.equal(run.visibilityCycle.restoredIdentity, true);
        assert.ok(digest(run.visibilityCycle.firstPixelSha256));
        assert.equal(
          run.visibilityCycle.firstPixelSha256,
          run.visibilityCycle.restoredPixelSha256,
        );
        assert.equal(run.visibilityCycle.disabledOwnership.length, 2);
        for (const disabled of run.visibilityCycle.disabledOwnership) {
          assert.equal(disabled.dataSources, run.warmup.dataSources);
          assert.equal(disabled.referenceCollections, 0);
          assert.equal(disabled.pointPrimitives, 0);
          assert.equal(disabled.stemPrimitives, 0);
          assert.equal(disabled.overlayVisible, false);
          assert.equal(disabled.overlayEntries, 0);
        }
        assert.equal(run.ownership.dataSources, run.warmup.dataSources + 3);
        assert.equal(run.teardown.dataSources, run.warmup.dataSources);
        assert.equal(run.teardown.primitives, run.warmup.primitives);
        assert.equal(
          run.teardown.groundPrimitives,
          run.warmup.groundPrimitives,
        );
        assert.equal(run.teardown.listeners, 0);
        assert.equal(run.teardown.collections, 0);
        for (const [key, kind] of [
          ['pointPick', 'point'],
          ['stemPick', 'stem'],
        ]) {
          assert.equal(run[key].kind, kind);
          assert.equal(run[key].ownerVerified, true);
          assert.ok(run[key].entityId && run[key].sourceRecordId);
          assert.ok(
            run[key].screen?.length === 2 && run[key].screen.every(finite),
          );
        }
        if (suite === 'latency') assert.equal(run.memory, null);
        else {
          assert.equal(run.memory.gcRequested, true);
          assert.equal(
            run.memory.metric,
            'Performance.getMetrics.JSHeapUsedSize',
          );
          for (const phase of ['baseline', 'enabled', 'destroyed'])
            assert.ok(
              Number.isSafeInteger(run.memory[phase]) && run.memory[phase] >= 0,
            );
          assert.ok(
            Number.isSafeInteger(run.memory.viewerDestroyed) &&
              run.memory.viewerDestroyed >= 0,
          );
        }
      }
      const { entities: a, collections: b } = pair.runs;
      const expectedDelta = {
        populationReadyPercent:
          (b.timings.populationReadyMs / a.timings.populationReadyMs) * 100 -
          100,
        readyFramePercent:
          (b.timings.readyFrameMs / a.timings.readyFrameMs) * 100 - 100,
        ...(suite === 'memory'
          ? {
              enabledHeapPercent:
                ((b.memory.enabled - b.memory.baseline) /
                  Math.max(1, a.memory.enabled - a.memory.baseline)) *
                  100 -
                100,
            }
          : {}),
      };
      assert.deepEqual(pair.deltas, expectedDelta);
      for (const key of [
        'source',
        'geometrySha256',
        'geometryComponents',
        'camera',
        'renderClock',
        'settings',
        'environment',
        'warmup',
        'teardown',
      ])
        assert.deepEqual(a[key], b[key]);
      assert.equal(a.ownership.listeners, b.ownership.listeners);
      assert.equal(a.image.pixelSha256, b.image.pixelSha256);
      assert.equal(a.image.pngSha256, b.image.pngSha256);
      for (const key of ['pointPick', 'stemPick']) {
        const identity = ({ primitiveType, appearanceType, ...value }) => value;
        assert.deepEqual(identity(a[key]), identity(b[key]));
      }
    }
  }
  const allRuns = report.pairs.flatMap((pair) =>
    CABLE_BENEFIT_MODES.map((mode) => pair.runs[mode]),
  );
  const reference = allRuns[0];
  for (const run of allRuns.slice(1))
    for (const key of [
      'source',
      'population',
      'camera',
      'renderClock',
      'settings',
      'environment',
      'warmup',
      'teardown',
      'geometrySha256',
      'geometryComponents',
      'pointPick',
      'stemPick',
    ]) {
      const canonical = (value) =>
        key === 'pointPick' || key === 'stemPick'
          ? (({ primitiveType, appearanceType, ...identity }) => identity)(
              value,
            )
          : value;
      assert.deepEqual(canonical(run[key]), canonical(reference[key]));
    }
  for (const run of allRuns.slice(1))
    assert.equal(run.ownership.listeners, reference.ownership.listeners);
  assert.deepEqual(report.summary, summarizeCableBenefit(report));
  return true;
}
