import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INFRASTRUCTURE_BENEFIT_EPOCH,
  INFRASTRUCTURE_BENEFIT_MODES,
  INFRASTRUCTURE_BENEFIT_PAIRS,
  INFRASTRUCTURE_BENEFIT_SCHEMA,
  compareInfrastructureBenefitPair,
  validateInfrastructureBenefitReport,
} from './infrastructureBenefitComparison.mjs';

const commit = 'a'.repeat(40);
const hash = (letter) => letter.repeat(64);

function run(mode, suite, seed) {
  const image = (kind) => ({
    path: `images/${suite}-pair-${String(seed + 1).padStart(2, '0')}-${mode}-${kind}.png`,
    sha256: hash(kind === 'settled' ? 'b' : 'c'),
    byteLength: 1024,
    width: 960,
    height: 640,
  });
  const result = {
    mode,
    suite,
    pairIndex: seed,
    status: 'passed',
    applicationCommit: commit,
    harnessCommit: commit,
    phase: 'viewer-destroyed',
    source: {
      payloadSha256: hash('1'),
      featureCount: 1600,
      payloadBytes: 700_000,
    },
    renderClock: { iso: INFRASTRUCTURE_BENEFIT_EPOCH, shouldAnimate: false },
    settings: {
      width: 1200,
      height: 900,
      canvasCssWidth: 960,
      canvasCssHeight: 640,
      devicePixelRatio: 1,
      resolutionScale: 1,
      drawingBufferWidth: 960,
      drawingBufferHeight: 640,
      requestRenderMode: true,
      maximumRenderTimeChange: 'Infinity',
      msaaSamples: 4,
      contextAttributes: {
        alpha: false,
        antialias: true,
        depth: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        stencil: false,
      },
      globeLighting: false,
    },
    sourceReady: { count: 1600 },
    sourceReadyElapsedMs: 150,
    firstUsable: {
      elapsedFromSourceReadyMs: 80,
      pixelSha256: hash('2'),
      changedPixels: 1400,
      width: 960,
      height: 640,
      geometryDirty: false,
      cameraRevisionReady: true,
      dataSourcesReady: true,
      globeTilesLoaded: true,
      cameraPosition: [1, 2, 3],
      target: { entityId: 'dam-1' },
    },
    surfacePopulation: {
      statsCount: 1600,
      entityCount: 1600,
      surfaceCount: 700,
      identitySha256: hash('3'),
    },
    environment: {
      renderer: 'ANGLE Renderer',
      cesiumVersion: '1.138.0',
      appCommit: commit,
      harnessCommit: commit,
      graphics: {
        featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
      },
      rendererClass: { kind: 'native-gpu', accelerationVerified: true },
    },
    settledPixelSha256: hash('4'),
    imageBuffersReleased: true,
    images: { firstUsable: image('firstUsable'), settled: image('settled') },
    warmup: { dataSources: 0, normalPrimitives: 3, groundPrimitives: 2 },
    teardown: {
      layerDestroyed: true,
      viewerDestroyed: true,
      ownerCountAfterDestroy: 0,
      dataSourceCountAfterDestroy: 0,
      normalPrimitiveCountAfterDestroy: 3,
      groundPrimitiveCountAfterDestroy: 2,
    },
  };
  result.surfacePopulation.resources =
    mode === 'entities'
      ? {
          owners: 0,
          surfaceGraphics: 700,
          collectionPoints: 0,
          collectionStems: 0,
        }
      : {
          owners: 1,
          surfaceGraphics: 0,
          collectionPoints: 700,
          collectionStems: 700,
        };
  if (suite === 'memory') {
    result.memory = {
      scope: 'post-forced-gc-js-heap-used-size-only',
      beforeActivation: {
        bytes: 100_000 + seed,
        metric: 'Performance.getMetrics.JSHeapUsedSize',
        gcRequested: true,
      },
      enabledSettled: {
        bytes: 150_000 + seed,
        metric: 'Performance.getMetrics.JSHeapUsedSize',
        gcRequested: true,
      },
      afterLayerDestroy: {
        bytes: 105_000 + seed,
        metric: 'Performance.getMetrics.JSHeapUsedSize',
        gcRequested: true,
      },
      afterViewerDestroy: {
        bytes: 102_000 + seed,
        metric: 'Performance.getMetrics.JSHeapUsedSize',
        gcRequested: true,
      },
      layerReferencesReleased: true,
      viewerReferencesReleased: true,
      imageBuffersReleased: true,
    };
  }
  return result;
}

function validReport() {
  const pairs = [];
  for (const suite of ['latency', 'memory']) {
    for (let index = 0; index < INFRASTRUCTURE_BENEFIT_PAIRS; index++) {
      const order =
        index % 2 === 0
          ? [...INFRASTRUCTURE_BENEFIT_MODES]
          : [...INFRASTRUCTURE_BENEFIT_MODES].reverse();
      const pair = {
        suite,
        index,
        order,
        runs: {
          entities: run('entities', suite, index),
          'primitive-collections': run('primitive-collections', suite, index),
        },
        sameInputAndOutput: true,
      };
      pair.deltas = compareInfrastructureBenefitPair(pair);
      pairs.push(pair);
    }
  }
  return {
    schema: INFRASTRUCTURE_BENEFIT_SCHEMA,
    status: 'passed',
    applicationCommit: commit,
    harnessCommit: commit,
    renderClock: { iso: INFRASTRUCTURE_BENEFIT_EPOCH, shouldAnimate: false },
    measurementScope: {
      latency:
        'fresh-viewer-source-ready-to-first-usable-postRender-before-rgba-readback-hash-and-pick-verification-no-forced-gc',
      memory: 'separate-fresh-viewer-post-forced-gc-js-heap-used-size-only',
      verificationCost:
        'postRender-rgba-readback-full-frame-hash-and-native-pick-search-run-after-the-first-usable-timestamp',
      retainedMemoryClaim:
        'none-js-heap-used-size-is-a-proxy-and-excludes-gpu-native-cesium-and-browser-process-memory',
    },
    provenance: {
      files: Object.fromEntries(
        [
          'package-lock.json',
          'patches/cesium-1.138.0-inertia.json',
          'patches/cesium-1.138.0-collision-transform.json',
          'src/data/infrastructure.js',
          'src/data/localGeojsonCore.js',
          'src/data/localGeojsonLod.js',
          'src/data/infrastructureOverlayEntry.js',
          'src/data/inputOwnership.js',
          'src/app/localGeojsonServices.js',
          'src/app/viewer.js',
          'src/app/atmosphereCompat.js',
          'src/app/cameraAnglesCompat.js',
          'src/freshFrame.js',
          'src/renderGovernor.js',
          'src/data/dataCredits.js',
          'src/sources/infrastructureData.js',
          'src/performance/performanceSnapshot.js',
          'scripts/fixtures/infrastructure-benefit.html',
          'scripts/fixtures/infrastructure-benefit.mjs',
          'scripts/performance/infrastructureBenefitComparison.mjs',
          'scripts/performance/infrastructureBenefitComparison.test.mjs',
        ].map((path, index) => [path, hash(String(index + 1)[0])]),
      ),
      installedDependencyBytes: {
        cesiumPackageSha256: hash('7'),
        enginePackageSha256: hash('8'),
        cesiumVersion: '1.138.0',
        engineVersion: '22.3.0',
        cesiumFiles: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((key) => [key, hash('9')]),
        ),
      },
    },
    pairs,
    environment: {
      renderer: 'ANGLE Renderer',
      rendererClass: { kind: 'native-gpu', accelerationVerified: true },
      graphics: {
        featureStatus: { webgl: 'enabled', webgl2: 'enabled' },
      },
    },
    cleanup: {
      browserClosed: true,
      initialPageClosed: true,
      pagesClosed: true,
      sessionsDetached: true,
      serverClosed: true,
      sourceTreeUnchanged: true,
    },
  };
}

test('accepts complete alternating fresh-context latency and GC-memory evidence', () => {
  assert.equal(
    validateInfrastructureBenefitReport(validReport(), {
      expectedCommit: commit,
    }),
    true,
  );
});

test('rejects unfinished scene geometry and changed fidelity instead of matching viewport size', () => {
  for (const key of ['dataSourcesReady', 'globeTilesLoaded']) {
    const report = validReport();
    report.pairs[0].runs.entities.firstUsable[key] = false;
    assert.throws(
      () =>
        validateInfrastructureBenefitReport(report, { expectedCommit: commit }),
      /first-usable-frame evidence/,
    );
  }
  const fidelity = validReport();
  fidelity.pairs[0].runs.entities.settings.msaaSamples = 0;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(fidelity, { expectedCommit: commit }),
    /render settings/,
  );
  const image = validReport();
  image.pairs[0].runs.entities.images.firstUsable.width = 1200;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(image, { expectedCommit: commit }),
    /PNG frame evidence/,
  );
});

test('rejects a missing mode run instead of trusting pair flags', () => {
  const report = validReport();
  delete report.pairs[0].runs.entities;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(report, { expectedCommit: commit }),
    /alternating/,
  );
});

test('requires five complete alternating pairs in each separate suite', () => {
  const report = validReport();
  report.pairs.splice(0, 1);
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(report, { expectedCommit: commit }),
    /paired inventory is incomplete/,
  );
});

test('rejects a changed payload or population between matched modes', () => {
  const payload = validReport();
  payload.pairs[0].runs['primitive-collections'].source.payloadSha256 =
    hash('4');
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(payload, { expectedCommit: commit }),
    /differs at source.payloadSha256/,
  );

  const identity = validReport();
  identity.pairs[0].runs[
    'primitive-collections'
  ].surfacePopulation.identitySha256 = hash('5');
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(identity, { expectedCommit: commit }),
    /differs at surfacePopulation.identitySha256/,
  );
});

test('rejects output, clock, or order drift', () => {
  const pixels = validReport();
  pixels.pairs[1].runs['primitive-collections'].firstUsable.pixelSha256 =
    hash('6');
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(pixels, { expectedCommit: commit }),
    /differs at firstUsable.pixelSha256/,
  );

  const settledPixels = validReport();
  settledPixels.pairs[0].runs['primitive-collections'].images.settled.sha256 =
    hash('8');
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(settledPixels, {
        expectedCommit: commit,
      }),
    /differs at images.settled.sha256/,
  );

  const clock = validReport();
  clock.pairs[0].runs.entities.renderClock.iso = '2026-10-11T12:00:01.000Z';
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(clock, { expectedCommit: commit }),
    /fixed clock/,
  );

  const order = validReport();
  order.pairs[1].order.reverse();
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(order, { expectedCommit: commit }),
    /alternating/,
  );
});

test('requires current-camera geometry readiness and the complete PNG set', () => {
  const staleCamera = validReport();
  staleCamera.pairs[0].runs.entities.firstUsable.geometryDirty = true;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(staleCamera, {
        expectedCommit: commit,
      }),
    /activation or first-usable-frame evidence/,
  );

  const missingCameraRevision = validReport();
  missingCameraRevision.pairs[0].runs.entities.firstUsable.cameraRevisionReady = false;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(missingCameraRevision, {
        expectedCommit: commit,
      }),
    /activation or first-usable-frame evidence/,
  );

  const missingImage = validReport();
  delete missingImage.pairs[0].runs.entities.images.firstUsable;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(missingImage, {
        expectedCommit: commit,
      }),
    /PNG frame evidence/,
  );
});

test('requires accelerated rendering, effective context attributes, and page cleanup', () => {
  const software = validReport();
  software.environment.rendererClass = {
    kind: 'software',
    accelerationVerified: false,
  };
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(software, { expectedCommit: commit }),
    /acceleration/,
  );

  const missingAttribute = validReport();
  delete missingAttribute.pairs[0].runs.entities.settings.contextAttributes
    .depth;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(missingAttribute, {
        expectedCommit: commit,
      }),
    /render settings/,
  );

  const badBuffer = validReport();
  badBuffer.pairs[0].runs.entities.settings.drawingBufferWidth = 0;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(badBuffer, {
        expectedCommit: commit,
      }),
    /render settings/,
  );

  const leakedInitialPage = validReport();
  leakedInitialPage.cleanup.initialPageClosed = false;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(leakedInitialPage, {
        expectedCommit: commit,
      }),
    /cleanup is incomplete/,
  );
});

test('requires forced-GC JS heap provenance only in the separate memory suite', () => {
  const missingGc = validReport();
  delete missingGc.pairs.find((pair) => pair.suite === 'memory').runs.entities
    .memory.afterLayerDestroy;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(missingGc, {
        expectedCommit: commit,
      }),
    /forced-GC memory evidence/,
  );

  const mislabeled = validReport();
  mislabeled.pairs.find(
    (pair) => pair.suite === 'latency',
  ).runs.entities.memory = {};
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(mislabeled, {
        expectedCommit: commit,
      }),
    /must not collect/,
  );
});

test('requires teardown and exact app identity on every mode and suite', () => {
  const cleanup = validReport();
  cleanup.pairs[0].runs.entities.teardown.ownerCountAfterDestroy = 1;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(cleanup, { expectedCommit: commit }),
    /cleanup is incomplete/,
  );

  const identity = validReport();
  identity.pairs[0].runs.entities.applicationCommit = 'b'.repeat(40);
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(identity, { expectedCommit: commit }),
    /identity or lifecycle/,
  );

  const harness = validReport();
  harness.pairs[0].runs.entities.harnessCommit = 'b'.repeat(40);
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(harness, { expectedCommit: commit }),
    /identity or lifecycle/,
  );
});

test('requires fixture references to be released before post-teardown heap samples', () => {
  const report = validReport();
  report.pairs.find(
    (pair) => pair.suite === 'memory',
  ).runs.entities.memory.viewerReferencesReleased = false;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(report, { expectedCommit: commit }),
    /retained fixture ownership references/,
  );
});

test('rejects missing installed dependency hashes and fresh-viewer drift', () => {
  const dependencies = validReport();
  delete dependencies.provenance.installedDependencyBytes.cesiumFiles.e;
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(dependencies, {
        expectedCommit: commit,
      }),
    /installed Cesium identity/,
  );

  const drift = validReport();
  drift.pairs[5].runs.entities.surfacePopulation.identitySha256 = hash('a');
  drift.pairs[5].runs[
    'primitive-collections'
  ].surfacePopulation.identitySha256 = hash('a');
  assert.throws(
    () =>
      validateInfrastructureBenefitReport(drift, { expectedCommit: commit }),
    /changed across fresh viewers/,
  );
});
