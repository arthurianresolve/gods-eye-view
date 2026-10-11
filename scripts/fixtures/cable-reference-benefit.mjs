import * as Cesium from 'cesium';
import { createBundledCableSource } from '../../src/layers/submarineCables/bundledSource.js';
import { featureReference } from '../../src/layers/submarineCables/geometry.js';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import { readScenePrimitiveReadiness } from './scenePrimitiveReadiness.mjs';
import { CABLE_REFERENCE_RENDER_POPULATION } from './cable-reference-collections-contract.mjs';
import {
  assert,
  readBundledJson,
  sourceDigests,
  createFixtureViewer,
  createOverlayHost,
  waitForPostRender,
  waitForStableScene,
  dataSource,
  nativeTargets,
  cleanPick,
  sourceGeometryEvidence,
  capturePixels,
  cameraVector,
  viewerSettings,
  shaJson,
} from './cableReferenceFixture.mjs';
import { waitForPostRenderUntil } from './cableDeadline.mjs';

const mode = new URLSearchParams(location.search).get('mode');
const output = document.querySelector('#result');
const status = document.querySelector('#status');
const runButton = document.querySelector('#run');
let viewer = null;
let layer = null;
let source = null;
let overlay = null;
let records = null;
let activation = null;
let disposed = false;
let retainedImage = null;
let failureImages = [];
let state = null;

function publish(phase, patch = {}) {
  Object.assign(state, patch, { phase });
  window.__cableBenefitState = JSON.parse(JSON.stringify(state));
  status.textContent = phase;
  output.textContent = JSON.stringify(state, null, 2);
}

function resourceCounts() {
  return {
    dataSources: viewer.dataSources.length,
    primitives: viewer.scene.primitives.length,
    groundPrimitives: viewer.scene.groundPrimitives.length,
  };
}

async function activate() {
  const started = performance.now();
  layer.init(viewer);
  layer.enable(viewer);
  const deadline = started + 180_000;
  let populationAt = null;
  let usableAt = null;
  let readyFrames = 0;
  let readiness = null;
  const populationComplete = () => {
    const stats = layer.getStats();
    const diagnostics = layer.getPerformanceDiagnostics();
    const referencesReady =
      diagnostics.referenceRenderer === mode &&
      (mode === 'entities'
        ? diagnostics.referenceCollections === 0 &&
          diagnostics.referencePointPrimitives === 0 &&
          diagnostics.referenceStemPrimitives === 0
        : diagnostics.referenceCollections === 2 &&
          diagnostics.referencePointPrimitives ===
            CABLE_REFERENCE_RENDER_POPULATION.referenceRecords &&
          diagnostics.referenceStemPrimitives ===
            CABLE_REFERENCE_RENDER_POPULATION.referenceRecords);
    return (
      !stats.loading &&
      stats.error === null &&
      stats.count === CABLE_REFERENCE_RENDER_POPULATION.referenceRecords &&
      viewer.dataSources.length === state.warmup.dataSources + 3 &&
      referencesReady
    );
  };
  while (!disposed && performance.now() < deadline) {
    await waitForPostRenderUntil(
      viewer,
      deadline,
      () => performance.now(),
      waitForPostRender,
    );
    const complete = populationComplete();
    if (complete && populationAt === null) populationAt = performance.now();
    readiness = readScenePrimitiveReadiness(viewer.scene, Cesium);
    if (
      complete &&
      readiness.ready &&
      viewer.dataSourceDisplay.ready &&
      viewer.scene.globe.tilesLoaded
    ) {
      readyFrames++;
      if (readyFrames >= 3) {
        usableAt = performance.now();
        break;
      }
    } else readyFrames = 0;
  }
  assert(
    !disposed && usableAt !== null,
    'Complete cable frame readiness timed out.',
  );
  await waitForStableScene(viewer, layer, mode, records);
  // Stop latency timing before geometry hashing, native pick audits, encoding,
  // or forced GC. Those validate this already-ready state separately.
  const timings = {
    populationReadyMs: populationAt - started,
    readyFrameMs: usableAt - started,
    readyFrames,
    deadlineMs: 180_000,
  };
  const referenceSnapshot = async () => {
    const refs = dataSource(viewer, 'TeleGeography Cable References');
    const cables = dataSource(viewer, 'TeleGeography Submarine Cables');
    const landings = dataSource(viewer, 'TeleGeography Landing Points');
    const population = {
      ...CABLE_REFERENCE_RENDER_POPULATION,
      cableSegments: cables.entities.values.filter((row) => row.polyline)
        .length,
      landingBillboards: landings.entities.values.filter((row) => row.billboard)
        .length,
      referenceRecords: refs.entities.values.length,
    };
    assert(
      JSON.stringify(population) ===
        JSON.stringify(CABLE_REFERENCE_RENDER_POPULATION),
      'Cable source/render population changed.',
    );
    const picks = nativeTargets(viewer, layer, mode, records);
    assert(
      picks.point && picks.stem && picks.pointOwner && picks.stemOwner,
      'Ready cable frame does not support native point and stem picking.',
    );
    const evidence = sourceGeometryEvidence(viewer, mode, layer, records);
    const geometryComponents = {
      sourceGeometrySha256: await shaJson(evidence.sourceGeometry),
      referenceGeometrySha256: await shaJson(evidence.referenceGeometry),
      referenceStylesSha256: await shaJson(evidence.referenceStyles),
      sourceIdsSha256: await shaJson(evidence.sourceIds),
    };
    const geometrySha256 = await shaJson({
      sourceGeometry: evidence.sourceGeometry,
      referenceGeometry: evidence.referenceGeometry,
      referenceStyles: evidence.referenceStyles,
      sourceIds: evidence.sourceIds,
    });
    const diagnostics = layer.getPerformanceDiagnostics();
    return {
      refs,
      population,
      picks,
      geometrySha256,
      geometryComponents,
      ownership: {
        ...resourceCounts(),
        referenceGraphics: refs.entities.values.filter(
          (row) => row.point || row.polyline,
        ).length,
        collections: diagnostics.referenceCollections,
        points: diagnostics.referencePointPrimitives,
        stems: diagnostics.referenceStemPrimitives,
        listeners: diagnostics.listeners,
      },
    };
  };
  const first = await referenceSnapshot();
  const firstImage = await capturePixels(viewer);
  const firstPixelSha256 = firstImage.pixelSha256;
  firstImage.rgba = null;
  const firstCamera = cameraVector(viewer);
  const firstClock = Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3);
  const visibilityCycle = {
    cycles: 0,
    disabledOwnership: [],
    restoredIdentity: true,
  };
  for (let cycle = 0; cycle < 2; cycle += 1) {
    layer.disable();
    await waitForPostRender(viewer);
    const diagnostics = layer.getPerformanceDiagnostics();
    const disabled = {
      dataSources: viewer.dataSources.length,
      referenceCollections: diagnostics.referenceCollections,
      pointPrimitives: diagnostics.referencePointPrimitives,
      stemPrimitives: diagnostics.referenceStemPrimitives,
      overlayVisible: overlay.visible,
      overlayEntries: overlay.entries.length,
    };
    assert(
      disabled.dataSources === state.warmup.dataSources,
      'Disable retained cable DataSources.',
    );
    assert(
      disabled.referenceCollections === 0 &&
        disabled.pointPrimitives === 0 &&
        disabled.stemPrimitives === 0,
      'Disable retained reference collections.',
    );
    assert(
      disabled.overlayVisible === false && disabled.overlayEntries === 0,
      'Disable retained cable overlay visibility or entries.',
    );
    visibilityCycle.disabledOwnership.push(disabled);
    layer.enable(viewer);
    const restoreDeadline = performance.now() + 180_000;
    let restoreFrames = 0;
    while (!disposed && performance.now() < restoreDeadline) {
      await waitForPostRenderUntil(
        viewer,
        restoreDeadline,
        () => performance.now(),
        waitForPostRender,
      );
      const complete = populationComplete();
      const ready = readScenePrimitiveReadiness(viewer.scene, Cesium);
      if (
        complete &&
        ready.ready &&
        viewer.dataSourceDisplay.ready &&
        viewer.scene.globe.tilesLoaded
      ) {
        restoreFrames++;
        if (restoreFrames >= 3) break;
      } else restoreFrames = 0;
    }
    assert(
      restoreFrames >= 3,
      'Cable visibility re-enable readiness timed out.',
    );
    await waitForStableScene(viewer, layer, mode, records);
    const restored = await referenceSnapshot();
    const sameIdentity =
      restored.geometrySha256 === first.geometrySha256 &&
      JSON.stringify(restored.geometryComponents) ===
        JSON.stringify(first.geometryComponents) &&
      JSON.stringify(restored.population) ===
        JSON.stringify(first.population) &&
      JSON.stringify(
        cleanPick(restored.picks.point, restored.picks.pointOwner),
      ) ===
        JSON.stringify(cleanPick(first.picks.point, first.picks.pointOwner)) &&
      JSON.stringify(
        cleanPick(restored.picks.stem, restored.picks.stemOwner),
      ) === JSON.stringify(cleanPick(first.picks.stem, first.picks.stemOwner));
    visibilityCycle.restoredIdentity =
      visibilityCycle.restoredIdentity && sameIdentity;
    assert(
      sameIdentity,
      'Re-enable changed cable source, geometry, styles, or native-pick identity.',
    );
    visibilityCycle.cycles++;
  }
  const image = await capturePixels(viewer);
  visibilityCycle.firstPixelSha256 = firstPixelSha256;
  visibilityCycle.restoredPixelSha256 = image.pixelSha256;
  if (image.pixelSha256 !== firstPixelSha256) {
    // Preserve exactly these two failed witnesses. They are collected only on
    // failure and cannot enter the successful forced-GC memory checkpoint.
    failureImages = [firstImage, image].map((capture, index) => ({
      label: index === 0 ? 'before-toggle' : 'after-toggle',
      width: capture.width,
      height: capture.height,
      pixelSha256: capture.pixelSha256,
      pngBase64: capture.pngBase64,
    }));
    publish('visual-equivalence-failed', {
      timings,
      visibilityCycle,
      visualFailure: {
        firstCamera,
        restoredCamera: cameraVector(viewer),
        firstClock,
        restoredClock: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
        readiness: readScenePrimitiveReadiness(viewer.scene, Cesium),
      },
    });
  }
  assert(
    image.pixelSha256 === firstPixelSha256,
    'Disable/re-enable changed settled cable pixels.',
  );
  firstImage.pngBase64 = null;
  retainedImage = image.pngBase64;
  const {
    refs,
    population,
    picks,
    geometrySha256,
    geometryComponents,
    ownership,
  } = await referenceSnapshot();
  publish('enabled-settled', {
    timings,
    population,
    geometrySha256,
    geometryComponents,
    readiness,
    ownership,
    pointPick: cleanPick(picks.point, picks.pointOwner),
    stemPick: cleanPick(picks.stem, picks.stemOwner),
    image: {
      pixelSha256: image.pixelSha256,
      width: image.width,
      height: image.height,
    },
    camera: cameraVector(viewer),
    visibilityCycle,
  });
}

async function destroyLayer() {
  assert(
    state.phase === 'enabled-settled',
    'Destroy requires a completed activation.',
  );
  layer.destroy(viewer);
  for (let frame = 0; frame < 3; frame++) await waitForPostRender(viewer);
  const diagnostics = layer.getPerformanceDiagnostics();
  const remaining = resourceCounts();
  assert(
    remaining.dataSources === state.warmup.dataSources,
    'Destroyed cable layer retained DataSources.',
  );
  assert(
    diagnostics.listeners === 0 && diagnostics.referenceCollections === 0,
    'Destroyed cable layer retained owned listeners or collections.',
  );
  assert(
    overlay.entries.length === 0 && overlay.visible === false,
    'Destroyed cable layer retained visible overlay records.',
  );
  // Do not let fixture closure ownership bias the post-destroy GC checkpoint.
  layer = null;
  source = null;
  overlay = null;
  records = null;
  activation = null;
  retainedImage = null;
  failureImages = [];
  publish('layer-destroyed', {
    teardown: { ...remaining, listeners: 0, collections: 0 },
  });
  return true;
}

async function prepare() {
  assert(
    ['entities', 'collections'].includes(mode),
    'Select an explicit cable renderer mode.',
  );
  assert(
    /^[a-f0-9]{40}$/.test(__GEV_APP_COMMIT__),
    'Exact commit is required.',
  );
  const [cables, landings] = await Promise.all([
    readBundledJson('cable-geo.json'),
    readBundledJson('landing-point-geo.json'),
  ]);
  const digests = await sourceDigests(
    cables.json,
    landings.json,
    cables.sha256,
    landings.sha256,
  );
  records = digests.records;
  const firstLanding = records.find((row) => row.kind === 'landing-point');
  const anchor = featureReference(firstLanding.feature);
  const target = Cesium.Cartesian3.fromDegrees(...Object.values(anchor), 0);
  viewer = createFixtureViewer(target);
  for (let frame = 0; frame < 3; frame++) await waitForPostRender(viewer);
  source = createBundledCableSource();
  overlay = createOverlayHost();
  layer = createSubmarineCableLayer({
    source,
    overlayHost: overlay,
    mapStackEventTarget: new EventTarget(),
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    sweepClock: () => performance.now(),
    referenceRenderer: mode,
  });
  layer.__fixtureMode = mode;
  layer.__fixtureRecords = records;
  layer.__fixtureOverlay = overlay;
  state = {
    schema: 'gev-cable-reference-benefit-trial/v1',
    applicationCommit: __GEV_APP_COMMIT__,
    harnessCommit: __GEV_APP_COMMIT__,
    mode,
    status: 'running',
    source: digests.report,
    renderClock: {
      iso: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
      shouldAnimate: false,
    },
    settings: viewerSettings(viewer),
    environment: readPerformanceEnvironment({
      viewer,
      appCommit: __GEV_APP_COMMIT__,
      harnessCommit: __GEV_APP_COMMIT__,
    }),
    warmup: resourceCounts(),
  };
  window.__cableBenefit = {
    start() {
      assert(state.phase === 'ready', 'Activation can only start once.');
      publish('activating');
      activation = activate().catch((error) =>
        publish('failed', {
          status: 'failed',
          error: String(error.message).slice(0, 1000),
        }),
      );
      return true;
    },
    takeImage() {
      assert(
        state.phase === 'enabled-settled' && retainedImage,
        'Completed image required.',
      );
      const image = retainedImage;
      retainedImage = null;
      return image;
    },
    takeFailureImages() {
      const images = failureImages;
      failureImages = [];
      return images;
    },
    destroyLayer,
    destroyViewer() {
      assert(
        state.phase === 'layer-destroyed',
        'Release the cable layer first.',
      );
      viewer.destroy();
      assert(viewer.isDestroyed(), 'Viewer destruction did not complete.');
      viewer = null;
      disposed = true;
      publish('viewer-destroyed', { status: 'passed' });
      window.__cableBenefit = null;
      return window.__cableBenefitState;
    },
  };
  runButton.disabled = false;
  runButton.addEventListener(
    'click',
    () => {
      runButton.disabled = true;
      window.__cableBenefit.start();
    },
    { once: true },
  );
  publish('ready');
}

prepare().catch((error) => {
  try {
    layer?.destroy(viewer);
  } finally {
    viewer?.destroy();
  }
  state ||= {};
  publish('failed', {
    status: 'failed',
    error: String(error.message).slice(0, 1000),
  });
});
