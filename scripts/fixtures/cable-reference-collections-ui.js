import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createBundledCableSource } from '../../src/layers/submarineCables/bundledSource.js';
import { featureReference } from '../../src/layers/submarineCables/geometry.js';
import { createSubmarineCableLayer } from '../../src/layers/submarineCables/index.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';
import { createCableCameraSweepGate } from './cableCameraSweep.mjs';
import { appendCableFailureDiagnostics } from './cableFailureDiagnostics.mjs';
import { readScenePrimitiveReadiness } from './scenePrimitiveReadiness.mjs';
import { recordCableReferenceGeometryAttribution } from './cableGeometryAttribution.mjs';
import {
  appendCableReenableObservation,
  finishCableReenableObservationSafely,
  startCableReenableObservation,
} from './cableReenableObservation.mjs';
import {
  CABLE_REFERENCE_RENDER_CASES,
  CABLE_REFERENCE_RENDER_POPULATION,
  CABLE_REFERENCE_RENDER_SAMPLES,
  CABLE_REFERENCE_RENDER_SCHEMA,
} from './cable-reference-collections-contract.mjs';

const EXPECTED_COMMIT = __GEV_APP_COMMIT__;
const FIXED_ISO = '2026-10-11T12:34:56.000Z';
const READINESS_TIMEOUT_MS = 180_000;
const STABLE_TIMEOUT_MS = 12_000;
const SAMPLE_TIMEOUT_MS = 3_000;
const CASES = Object.freeze({
  'default-style': { targetKind: 'landing-point', rangeMeters: 120_000 },
  'camera-change': { targetKind: 'cable', rangeMeters: 180_000 },
});
const FIXTURE_PIXEL_MARGIN = 10;
const REENABLE_DIAGNOSTIC =
  new URLSearchParams(window.location.search).get('diagnostic') ===
  'cable-reenable';
const runButton = document.querySelector('#run');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const outputNode = document.querySelector('#result');
const viewerContainer = document.querySelector('#viewer');
const creditsContainer = document.querySelector('#credits');
let lastReport = null;

import {
  assert,
  sha256,
  shaJson,
  readBundledJson,
  dataSource,
  findReferenceCollections,
  readReferenceItems,
  cameraVector,
  sameCameraPose,
  waitForPostRender,
  waitForPopulation,
  waitForStableScene,
  resetView,
  flyToCameraCase,
  nativeTargets,
  cleanPick,
  cameraContract,
  sourceClassification,
  capturePixels,
  sourceGeometryEvidence,
  createOverlayHost,
  viewerSettings,
  makeReport,
  sourceDigests,
  createFixtureViewer,
  mapStackWitness,
} from './cableReferenceFixture.mjs';
import {
  recordCableLifecycleFailure,
  runCableRendererLifetimes,
} from './cableLifetimeIsolation.mjs';

async function runLifetime({
  viewer,
  mode,
  activationOrder,
  sourceRecords,
  sourceManifestSha256,
  targets,
  report,
  setLifecycleStage = () => {},
}) {
  const overlay = createOverlayHost();
  const mapEvents = new EventTarget();
  const source = createBundledCableSource();
  const baselineDataSources = viewer.dataSources.length;
  const layer = createSubmarineCableLayer({
    source,
    overlayHost: overlay,
    mapStackEventTarget: mapEvents,
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    sweepClock: () => performance.now(),
    referenceRenderer: mode === 'collections' ? 'collections' : 'entities',
  });
  layer.__fixtureMode = mode;
  layer.__fixtureRecords = sourceRecords;
  layer.__fixtureOverlay = overlay;
  const lifetime = {
    mode,
    activationOrder,
    status: 'running',
    population: null,
    sourceIdentitySha256: null,
    sourceManifestSha256,
    viewerSettingsSha256: null,
    viewerEnvironmentSha256: null,
    geometrySha256: null,
    styleSha256: null,
    overlaySha256: null,
    mapClassificationAttribution: null,
    ownership: null,
    teardown: null,
    samples: [],
  };
  const ownedCollectionLifetimes = [];
  report.lifetimes.push(lifetime);
  try {
    setLifecycleStage('layer-init');
    layer.init(viewer);
    setLifecycleStage('initial-enable');
    layer.enable(viewer);
    setLifecycleStage('initial-population');
    await waitForPopulation(viewer, layer, sourceRecords);
    const data = {
      cable: dataSource(viewer, 'TeleGeography Submarine Cables'),
      landing: dataSource(viewer, 'TeleGeography Landing Points'),
      reference: dataSource(viewer, 'TeleGeography Cable References'),
    };
    const refs = readReferenceItems(viewer, layer, mode, sourceRecords);
    if (mode === 'collections') {
      layer.__fixtureCollections = findReferenceCollections(
        viewer,
        refs.entities.map((entity) => entity.id),
      );
      ownedCollectionLifetimes.push(layer.__fixtureCollections);
    }
    const cableSegments = data.cable.entities.values.filter((entity) =>
      Boolean(entity.polyline),
    ).length;
    const landingBillboards = data.landing.entities.values.filter((entity) =>
      Boolean(entity.billboard),
    ).length;
    assert(
      cableSegments === CABLE_REFERENCE_RENDER_POPULATION.cableSegments,
      'Ground cable segment population changed.',
    );
    assert(
      landingBillboards === CABLE_REFERENCE_RENDER_POPULATION.landingBillboards,
      'Clamped landing billboard population changed.',
    );
    assert(
      refs.items.every((item, index) => item.sourceOrdinal === index),
      'Reference source order/identity mapping changed.',
    );
    if (mode === 'entities') {
      assert(
        refs.items.every((item) => item.entity.point && item.entity.polyline),
        'Default Entity reference graphics are missing.',
      );
    } else {
      assert(
        refs.items.every((item) => !item.entity.point && !item.entity.polyline),
        'Collection mode retained duplicate reference Graphics.',
      );
    }
    const diagnostic = layer.getPerformanceDiagnostics();
    assert(
      diagnostic.referenceRecords === undefined ||
        diagnostic.referenceRecords === 2629,
      'Reference diagnostic record count is invalid.',
    );
    lifetime.population = {
      ...CABLE_REFERENCE_RENDER_POPULATION,
      cableSegments,
      landingBillboards,
    };
    lifetime.ownership = {
      baselineDataSources,
      activeDataSources: viewer.dataSources.length,
      referenceGraphics: mode === 'entities' ? 2629 * 2 : 0,
      referenceCollections: diagnostic.referenceCollections,
      referencePoints: diagnostic.referencePointPrimitives,
      referenceStems: diagnostic.referenceStemPrimitives,
    };
    assert(
      lifetime.ownership.activeDataSources === baselineDataSources + 3,
      'Cable layer did not own exactly three DataSources.',
    );

    const sourceGeometryHash = async () => {
      const view = sourceGeometryEvidence(viewer, mode, layer, sourceRecords);
      return {
        view,
        geometrySha256: await shaJson({
          sourceGeometry: view.sourceGeometry,
          referenceGeometry: view.referenceGeometry,
        }),
        styleSha256: await shaJson({
          cableRows: view.sourceGeometry.cableRows.map((row) => ({
            id: row.id,
            show: row.show,
            classification: row.classification,
            width: row.width,
            colorBytes: row.colorBytes,
            clampToGround: row.clampToGround,
          })),
          landingRows: view.sourceGeometry.landingRows,
          referenceStyles: view.referenceStyles,
        }),
        sourceIdentitySha256: await shaJson({
          sourceRecords: sourceRecords.map(({ kind, id }, sourceOrdinal) => ({
            kind,
            id,
            sourceOrdinal,
          })),
          surfaceEntityIds: view.sourceIds,
          referenceEntityIds: view.referenceGeometry.map((row) => ({
            sourceOrdinal: row.sourceOrdinal,
            sourceKind: row.sourceKind,
            sourceRecordId: row.sourceRecordId,
            entityId: row.entityId,
          })),
        }),
        overlaySha256: await shaJson(overlay.entries),
      };
    };

    // Warm the lazy EntityCluster collections and exercise both real map-stack
    // classifications before capturing the common terrain-visible state.
    setLifecycleStage('initial-map-stack-classification');
    const mapClassification = await mapStackWitness(viewer, mapEvents, layer);
    lifetime.mapClassificationAttribution = mapClassification.attribution;
    setLifecycleStage('initial-scene-stability');
    await waitForStableScene(viewer, layer, mode, sourceRecords);

    const hashes = await sourceGeometryHash();
    lifetime.sourceIdentitySha256 = hashes.sourceIdentitySha256;
    lifetime.geometrySha256 = hashes.geometrySha256;
    lifetime.styleSha256 = hashes.styleSha256;
    lifetime.overlaySha256 = hashes.overlaySha256;
    const startingCamera = cameraVector(viewer);
    const caseTargets = {
      'default-style': targets.default,
      'camera-change': targets.cameraChange,
    };
    const cameraContracts = {};
    const cameraSweeps = {};
    lifetime.readinessByCase = {};
    for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
      setLifecycleStage(`case-${caseId}-camera-setup`);
      const targetCase = caseTargets[caseId];
      const readinessDeadline = performance.now() + STABLE_TIMEOUT_MS;
      let sweep = null;
      if (caseId === 'default-style') {
        resetView(viewer, targetCase.cartesian, CASES[caseId].rangeMeters);
        viewer.scene.requestRender();
      } else {
        const sweepGate = createCableCameraSweepGate(
          viewer.camera,
          viewer.scene,
          {
            timeoutMs: Math.max(0.1, readinessDeadline - performance.now()),
            readPose: () => cameraVector(viewer),
            samePose: sameCameraPose,
          },
        );
        const sweepOutcomePromise = sweepGate.promise.then(
          (value) => ({ kind: 'sweep', value }),
          (error) => ({ kind: 'sweep-error', error }),
        );
        try {
          viewer.camera.setView({
            destination: new Cesium.Cartesian3(...startingCamera.position),
            orientation: {
              heading: viewer.camera.heading,
              pitch: viewer.camera.pitch,
              roll: viewer.camera.roll,
            },
          });
          const flightOutcomePromise = flyToCameraCase(
            viewer,
            targetCase.cartesian,
            CASES[caseId].rangeMeters,
          ).then(
            () => ({ kind: 'flight', finalPose: cameraVector(viewer) }),
            (error) => ({ kind: 'flight-error', error }),
          );
          const first = await Promise.race([
            flightOutcomePromise,
            sweepOutcomePromise,
          ]);
          if (first.kind === 'flight-error' || first.kind === 'sweep-error')
            throw first.error;
          assert(
            first.kind === 'flight',
            'Camera final-pose sweep completed before flight completion.',
          );
          sweepGate.markFlightComplete(first.finalPose);
          const completedSweep = await sweepOutcomePromise;
          if (completedSweep.kind === 'sweep-error') throw completedSweep.error;
          sweep = completedSweep.value;
        } catch (error) {
          try {
            viewer.camera.cancelFlight();
          } catch (cancelError) {
            lifetime.cameraFlightCancelError = String(
              cancelError?.message || cancelError,
            ).slice(0, 1000);
          }
          throw error;
        } finally {
          sweepGate.cancel();
        }
        assert(
          sweep?.status === 'swept' &&
            sweep.finalPoseVerified === true &&
            sweep.flightCompleteVerified === true &&
            Number.isSafeInteger(sweep.frameNumber),
          'Camera motion did not produce a completed post-sweep frame.',
        );
        cameraSweeps[caseId] = {
          ...sweep,
          cameraEventWaitMs: viewer.scene.cameraEventWaitTime,
        };
      }
      lifetime.readinessByCase[caseId] = [];
      setLifecycleStage(`case-${caseId}-scene-stability`);
      await waitForStableScene(
        viewer,
        layer,
        mode,
        sourceRecords,
        readinessDeadline,
        {
          stage: `case-${caseId}-stable-scene`,
          legacyObservations: lifetime.readinessByCase[caseId],
        },
      );
      cameraContracts[caseId] = cameraContract(
        viewer,
        targetCase.cartesian,
        caseId,
        CASES[caseId].rangeMeters,
      );
      setLifecycleStage(`case-${caseId}-native-picking`);
      const baselineTarget = report.__nativeTargets?.[caseId] || null;
      const selected = nativeTargets(
        viewer,
        layer,
        mode,
        sourceRecords,
        mode === 'entities' ? null : baselineTarget,
      );
      if (!selected.pointOwner || !selected.stemOwner) {
        const pickFailure = {
          caseId,
          reason: 'Native point and/or stem pick did not resolve to its owner.',
          camera: cameraContracts[caseId],
          cameraSweep: cameraSweeps[caseId] || null,
          visibleReferenceCount: selected.diagnostics.visibleReferences,
          population: CABLE_REFERENCE_RENDER_POPULATION.referenceRecords,
          search: selected.diagnostics,
          pointPick:
            selected.point && selected.pointOwner
              ? cleanPick(selected.point, selected.pointOwner)
              : null,
          stemPick:
            selected.stem && selected.stemOwner
              ? cleanPick(selected.stem, selected.stemOwner)
              : null,
        };
        lifetime.nativePickFailure = pickFailure;
        try {
          pickFailure.cameraAfterSearch = cameraVector(viewer);
        } catch (cameraError) {
          pickFailure.cameraDiagnosticError = String(
            cameraError?.message || cameraError,
          ).slice(0, 1000);
        }
        appendCableFailureDiagnostics(pickFailure, viewer, layer);
        pickFailure.primitiveReadiness = readScenePrimitiveReadiness(
          viewer.scene,
          Cesium,
        );
        try {
          const lastFrame = await capturePixels(viewer);
          pickFailure.lastFrame = {
            width: lastFrame.width,
            height: lastFrame.height,
            pixelSha256: lastFrame.pixelSha256,
            ...(lastFrame.pngBase64.length <= 4_000_000
              ? { pngBase64: lastFrame.pngBase64 }
              : { pngOmittedReason: 'PNG exceeds the 4 MB evidence cap.' }),
          };
        } catch (captureError) {
          pickFailure.lastFrameError = String(
            captureError?.message || captureError,
          ).slice(0, 1000);
        }
        try {
          const current = await sourceGeometryHash();
          pickFailure.geometrySha256 = current.geometrySha256;
          pickFailure.styleSha256 = current.styleSha256;
          pickFailure.overlaySha256 = current.overlaySha256;
          pickFailure.visibleReferenceCount =
            current.view.referenceData.items.filter(
              (item) => item.visible,
            ).length;
          pickFailure.population = current.view.referenceData.items.length;
        } catch (diagnosticError) {
          pickFailure.geometryDiagnosticError = String(
            diagnosticError?.message || diagnosticError,
          ).slice(0, 1000);
        }
      }
      assert(
        selected.pointOwner && selected.stemOwner,
        `${mode} could not obtain native point and stem picks for ${caseId}.`,
      );
      if (mode === 'entities') {
        report.__nativeTargets ||= {};
        report.__nativeTargets[caseId] = {
          point: {
            entityId: selected.pointOwner.entityId,
            sourceKind: selected.pointOwner.sourceKind,
            sourceRecordId: selected.pointOwner.sourceRecordId,
            sourceOrdinal: selected.pointOwner.sourceOrdinal,
          },
          stem: {
            entityId: selected.stemOwner.entityId,
            sourceKind: selected.stemOwner.sourceKind,
            sourceRecordId: selected.stemOwner.sourceRecordId,
            sourceOrdinal: selected.stemOwner.sourceOrdinal,
          },
        };
      } else {
        assert(
          selected.pointOwner.entityId === baselineTarget?.point?.entityId &&
            selected.stemOwner.entityId === baselineTarget?.stem?.entityId,
          `${caseId} collection native picks resolved different owners.`,
        );
      }
      setLifecycleStage(`case-${caseId}-map-stack-witness`);
      const classification = await mapStackWitness(viewer, mapEvents, layer, {
        includeAttribution: false,
      });
      setLifecycleStage(`case-${caseId}-capture`);
      for (
        let sample = 0;
        sample < CABLE_REFERENCE_RENDER_SAMPLES;
        sample += 1
      ) {
        const stableFrames = await waitForStableScene(
          viewer,
          layer,
          mode,
          sourceRecords,
        );
        const frame = await capturePixels(viewer);
        const freshHashes = await sourceGeometryHash();
        const nowRefs = freshHashes.view.referenceData.items;
        const visibleReferences = nowRefs.filter((item) => item.visible).length;
        const sampleReport = {
          mode,
          caseId,
          sample,
          status: 'settled',
          stableFrames,
          primitiveReadiness: readScenePrimitiveReadiness(viewer.scene, Cesium),
          clock: {
            iso: Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 3),
            shouldAnimate: viewer.clock.shouldAnimate,
          },
          sourceCounts: { ...CABLE_REFERENCE_RENDER_POPULATION },
          sourceIdentitySha256: freshHashes.sourceIdentitySha256,
          sourceManifestSha256,
          geometrySha256: freshHashes.geometrySha256,
          styleSha256: freshHashes.styleSha256,
          overlaySha256: freshHashes.overlaySha256,
          cameraSha256: await shaJson(cameraContracts[caseId]),
          cameraSweep: cameraSweeps[caseId] || {
            status: 'not-required',
            frameNumber: null,
            finalPoseVerified: null,
            flightCompleteVerified: null,
            cameraEventWaitMs: null,
          },
          frame: { width: frame.width, height: frame.height },
          pixelSha256: frame.pixelSha256,
          pngBase64: frame.pngBase64,
          camera: cameraContracts[caseId],
          classification: {
            ...classification,
            terrain: sourceClassification(
              data.cable,
              viewer.clock.currentTime,
            )[0],
          },
          visibility: {
            visibleReferences,
            hiddenReferences: nowRefs.length - visibleReferences,
          },
          ownership: {
            referenceCollections: diagnostic.referenceCollections,
            referencePoints: diagnostic.referencePointPrimitives,
            referenceStems: diagnostic.referenceStemPrimitives,
          },
          pointPick: cleanPick(selected.point, selected.pointOwner),
          stemPick: cleanPick(selected.stem, selected.stemOwner),
        };
        Object.defineProperty(sampleReport, '__rgba', {
          value: frame.rgba,
          enumerable: false,
          configurable: true,
        });
        lifetime.samples.push(sampleReport);
      }
      // Each natural point/stem pick is bound to the same owner in both
      // renderer lifetimes, even when overlapping geometry makes them differ.

      // This witness is outside the capture loop. It preserves exact public
      // reference coordinates so a failed whole-scene hash can be attributed
      // to stable records and visibility without changing the pixel gate.
      await recordCableReferenceGeometryAttribution(report, {
        caseId,
        mode,
        retainRows: REENABLE_DIAGNOSTIC,
        readSnapshot: async () => {
          const geometry = sourceGeometryEvidence(
            viewer,
            mode,
            layer,
            sourceRecords,
          );
          const lastSample = lifetime.samples.find(
            (sample) =>
              sample.caseId === caseId &&
              sample.sample === CABLE_REFERENCE_RENDER_SAMPLES - 1,
          );
          const witnessedGeometrySha256 = await shaJson({
            sourceGeometry: geometry.sourceGeometry,
            referenceGeometry: geometry.referenceGeometry,
          });
          return {
            mode,
            sourceGeometrySha256: await shaJson(geometry.sourceGeometry),
            referenceGeometrySha256: await shaJson(geometry.referenceGeometry),
            witnessedGeometrySha256,
            cameraSha256: await shaJson(cameraContracts[caseId]),
            postLoopWitnessAfterSample: lastSample?.sample ?? null,
            matchesLastSampleGeometry:
              witnessedGeometrySha256 === lastSample?.geometrySha256,
            referenceIdentitySha256: await shaJson({
              sourceRecords: sourceRecords.map(
                ({ kind, id }, sourceOrdinal) => ({
                  kind,
                  id,
                  sourceOrdinal,
                }),
              ),
              referenceEntityIds: geometry.referenceGeometry.map(
                ({ entityId }) => entityId,
              ),
            }),
            sourceCounts: {
              cableRows: geometry.sourceGeometry.cableRows.length,
              landingRows: geometry.sourceGeometry.landingRows.length,
              referenceRows: geometry.referenceGeometry.length,
            },
            referenceRows: geometry.referenceGeometry,
          };
        },
      });
      setLifecycleStage(`case-${caseId}-geometry-witness-complete`);
    }

    for (let cycle = 0; cycle < 2; cycle += 1) {
      setLifecycleStage('disable', cycle);
      const priorSources = viewer.dataSources.length;
      layer.disable();
      assert(
        overlay.visible === false && overlay.entries.length === 0,
        'Disable left cable overlay entries visible.',
      );
      assert(
        layer.getPerformanceDiagnostics().referenceCollections === 0,
        'Disable retained reference collections.',
      );
      if (mode === 'collections') {
        for (const collection of Object.values(layer.__fixtureCollections))
          assert(
            collection.isDestroyed(),
            'Disable retained a reference collection object.',
          );
        layer.__fixtureCollections = null;
      }
      setLifecycleStage('disabled-render-drain', cycle);
      await waitForPostRender(viewer);
      assert(
        viewer.dataSources.length === baselineDataSources,
        'Disable left cable DataSources attached.',
      );
      setLifecycleStage('reenable', cycle);
      let reenableObservation = null;
      let observer = null;
      const reenableObservationIdentity = {
        rendererMode: mode,
        cycle,
        phase: 'reenable-population-and-scene-stability',
      };
      if (REENABLE_DIAGNOSTIC) {
        try {
          observer = startCableReenableObservation({
            viewer,
            Cesium,
            ...reenableObservationIdentity,
          });
        } catch (error) {
          reenableObservation = {
            schema: 'gev-cable-reenable-observation/v1',
            status: 'unavailable',
            ...reenableObservationIdentity,
            setupError: String(error?.message || error).slice(0, 300),
          };
        }
      }
      try {
        layer.enable(viewer);
        setLifecycleStage('reenable-population', cycle);
        await waitForPopulation(viewer, layer, sourceRecords);
        if (mode === 'collections') {
          const source = dataSource(viewer, 'TeleGeography Cable References');
          layer.__fixtureCollections = findReferenceCollections(
            viewer,
            source.entities.values.map((entity) => entity.id),
          );
          ownedCollectionLifetimes.push(layer.__fixtureCollections);
        }
        setLifecycleStage('reenable-scene-stability', cycle);
        await waitForStableScene(viewer, layer, mode, sourceRecords);
        setLifecycleStage('reenable-scene-stable', cycle);
        if (observer)
          reenableObservation = finishCableReenableObservationSafely(
            observer,
            'completed',
            null,
            reenableObservationIdentity,
          );
      } catch (error) {
        if (observer)
          reenableObservation = finishCableReenableObservationSafely(
            observer,
            'failed',
            error,
            reenableObservationIdentity,
          );
        throw error;
      } finally {
        if (reenableObservation)
          appendCableReenableObservation(lifetime, reenableObservation);
      }
      setLifecycleStage('reenable-contract-checks', cycle);
      assert(
        viewer.dataSources.length === priorSources,
        'Re-enable did not rebuild the same DataSource population.',
      );
      assert(
        layer.getStats().count ===
          CABLE_REFERENCE_RENDER_POPULATION.referenceRecords,
        'Re-enable lost source records.',
      );
    }
    setLifecycleStage('layer-destroy');
    layer.destroy(viewer);
    setLifecycleStage('layer-destroy-render-drain');
    await waitForPostRender(viewer);
    const afterDestroy = layer.getPerformanceDiagnostics();
    const collectionsDestroyed = ownedCollectionLifetimes.every((owner) =>
      Object.values(owner).every((collection) => collection.isDestroyed()),
    );
    const collectionsDetached = ownedCollectionLifetimes.every((owner) =>
      Object.values(owner).every(
        (collection) => !viewer.scene.primitives.contains(collection),
      ),
    );
    lifetime.teardown = {
      disabled: true,
      reEnabled: true,
      dataSourcesRemoved: 3,
      collectionsRemoved:
        mode === 'collections' && collectionsDestroyed && collectionsDetached
          ? ownedCollectionLifetimes.length * 2
          : 0,
      overlayHidden: overlay.visible === false && overlay.entries.length === 0,
      destroyed: true,
      listenersAfterDestroy: afterDestroy.listeners,
      remainingDataSources: viewer.dataSources.length,
      remainingCollections: collectionsDestroyed && collectionsDetached ? 0 : 2,
    };
    assert(
      lifetime.teardown.listenersAfterDestroy === 0,
      'Destroy retained cable event listeners.',
    );
    assert(
      lifetime.teardown.remainingDataSources === baselineDataSources,
      'Destroy retained cable DataSources.',
    );
    assert(
      lifetime.teardown.remainingCollections === 0,
      'Destroy retained cable collections.',
    );
    lifetime.status = 'passed';
    return lifetime;
  } catch (error) {
    lifetime.status = 'failed';
    if (error?.cableReadinessFailure)
      lifetime.readinessFailure = error.cableReadinessFailure;
    if (error?.cableClassificationAttribution)
      lifetime.mapClassificationAttribution =
        error.cableClassificationAttribution;
    lifetime.error = String(error?.stack || error?.message || error).slice(
      0,
      4000,
    );
    throw error;
  } finally {
    const remaining = layer.getPerformanceDiagnostics();
    if (
      remaining.listeners > 0 ||
      remaining.dataSources > 0 ||
      remaining.referenceCollections > 0 ||
      viewer.dataSources.length !== baselineDataSources ||
      overlay.visible ||
      overlay.entries.length > 0
    ) {
      try {
        layer.destroy(viewer);
      } catch (error) {
        lifetime.cleanupError = String(
          error?.stack || error?.message || error,
        ).slice(0, 2000);
        if (lifetime.status === 'passed') {
          lifetime.status = 'failed';
          lifetime.error = lifetime.cleanupError;
        }
      }
    }
  }
}

async function runComparison() {
  const report = makeReport();
  let viewer = null;
  try {
    report.failedPhase = 'source-provenance';
    const [cableAsset, landingAsset] = await Promise.all([
      readBundledJson('cable-geo.json'),
      readBundledJson('landing-point-geo.json'),
    ]);
    const sourceData = await sourceDigests(
      cableAsset.json,
      landingAsset.json,
      cableAsset.sha256,
      landingAsset.sha256,
    );
    report.source = sourceData.report;
    const firstLanding = sourceData.records.find(
      (record) => record.kind === 'landing-point',
    );
    const firstCable = sourceData.records.find(
      (record) => record.kind === 'cable',
    );
    const targets = {
      default: {
        cartesian: Cesium.Cartesian3.fromDegrees(
          ...Object.values(featureReference(firstLanding.feature)),
          0,
        ),
      },
      cameraChange: {
        cartesian: Cesium.Cartesian3.fromDegrees(
          ...Object.values(featureReference(firstCable.feature)),
          0,
        ),
      },
    };
    assert(
      targets.default.cartesian && targets.cameraChange.cartesian,
      'Bundled source camera anchors are unavailable.',
    );
    report.renderClock.iso = FIXED_ISO;
    const modes = ['entities', 'collections'];
    await runCableRendererLifetimes({
      modes,
      report,
      createViewer: (mode, index, { setStage }) => {
        if (!report.error) report.failedPhase = `${mode}-viewer-init`;
        setStage('viewer-init');
        viewer = createFixtureViewer(targets.default.cartesian);
        const settings = viewerSettings(viewer);
        const environment = readPerformanceEnvironment({
          viewer,
          appCommit: EXPECTED_COMMIT,
          harnessCommit: EXPECTED_COMMIT,
        });
        assert(settings.sceneMode === 'SCENE3D', 'Fixture is not in 3D mode.');
        assert(settings.globeShown === true, 'Fixture globe is hidden.');
        assert(
          settings.terrainProvider === 'EllipsoidTerrainProvider',
          'Fixture terrain provider changed.',
        );
        assert(
          settings.resolutionScale === 1,
          'Viewer resolution scale is not 1.',
        );
        assert(settings.msaaSamples === 4, 'Viewer MSAA setting is not 4.');
        assert(
          settings.preserveDrawingBuffer === true,
          'Framebuffer preservation is unavailable.',
        );
        assert(
          settings.antialias === true,
          'WebGL context antialiasing is unavailable.',
        );
        assert(
          viewer.dataSources.length === 0,
          'Fixture viewer did not start without DataSources.',
        );
        assert(
          environment.viewport.width === 1200 &&
            environment.viewport.height === 1000 &&
            environment.viewport.dpr === 1,
          'Fixture CSS viewport changed.',
        );
        assert(
          environment.drawingBuffer.width === 960 &&
            environment.drawingBuffer.height === 640,
          'Fixture drawing buffer changed.',
        );
        if (index === 0) {
          report.settings = settings;
          report.environment = environment;
          report.viewer = {
            baselineDataSources: viewer.dataSources.length,
            sceneMode: settings.sceneMode,
            globeShown: settings.globeShown,
            terrainProvider: settings.terrainProvider,
            lifetimeCount: 2,
          };
        } else {
          assert(
            JSON.stringify(settings) === JSON.stringify(report.settings),
            'Fresh viewer settings differ between renderer lifetimes.',
          );
          assert(
            JSON.stringify(environment) === JSON.stringify(report.environment),
            'Fresh viewer environment differs between renderer lifetimes.',
          );
        }
        return viewer;
      },
      executeLifetime: async (ownedViewer, mode, index, { setStage }) => {
        setStage('fixed-clock');
        if (!report.error) report.failedPhase = `${mode}-fixed-clock`;
        assert(
          Cesium.JulianDate.toIso8601(ownedViewer.clock.currentTime, 3) ===
            FIXED_ISO,
          'Cesium clock differs from the fixed fixture time.',
        );
        assert(
          !ownedViewer.clock.shouldAnimate,
          'Cesium clock is advancing during captures.',
        );
        setStage('renderer-lifetime');
        if (!report.error) report.failedPhase = `${mode}-lifetime`;
        const lifetime = await runLifetime({
          viewer: ownedViewer,
          mode,
          activationOrder: index,
          sourceRecords: sourceData.records,
          sourceManifestSha256: sourceData.report.identitySha256,
          targets,
          report,
          setLifecycleStage: setStage,
        });
        lifetime.viewerSettingsSha256 = await shaJson(report.settings);
        lifetime.viewerEnvironmentSha256 = await shaJson(report.environment);
        return lifetime;
      },
      compareAvailable: async (completedOutcomes) => {
        const destruction = completedOutcomes.at(-1)?.viewerDestroyed;
        if (destruction === true) viewer = null;
        report.viewer ||= {};
        report.viewer.completedLifetimeCount = completedOutcomes.length;
        report.viewer.destroyedLifetimeCount = completedOutcomes.filter(
          (outcome) => outcome.viewerDestroyed,
        ).length;
      },
    });
    delete report.__nativeTargets;
    if (!report.error) report.failedPhase = 'cross-mode-comparison';
    let comparisonIndex = 0;
    let comparedGeometryCount = 0;
    let exactComparisonCount = 0;
    let comparisonFailure = null;
    const entityLifetime = report.lifetimes.find(
      (lifetime) => lifetime.mode === 'entities',
    );
    const collectionLifetime = report.lifetimes.find(
      (lifetime) => lifetime.mode === 'collections',
    );
    for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
      for (
        let sample = 0;
        sample < CABLE_REFERENCE_RENDER_SAMPLES;
        sample += 1
      ) {
        const entity = entityLifetime?.samples.find(
          (row) => row.caseId === caseId && row.sample === sample,
        );
        const candidate = collectionLifetime?.samples.find(
          (row) => row.caseId === caseId && row.sample === sample,
        );
        comparisonIndex += 1;
        if (!entity || !candidate) {
          const missingModes = [];
          if (!entity) missingModes.push('entities');
          if (!candidate) missingModes.push('collections');
          report.comparisons.push({
            caseId,
            sample,
            status: 'unavailable',
            missingModes,
            entityCaptured: Boolean(entity),
            collectionCaptured: Boolean(candidate),
          });
          continue;
        }
        comparedGeometryCount += 1;
        if (
          !entity.__rgba ||
          !candidate.__rgba ||
          entity.__rgba.length !== candidate.__rgba.length
        ) {
          report.comparisons.push({
            caseId,
            sample,
            status: 'invalid',
            reason: 'RGBA capture buffers are missing or have different sizes.',
            entityBufferLength: entity.__rgba?.length ?? null,
            collectionBufferLength: candidate.__rgba?.length ?? null,
          });
          comparisonFailure ||= `${caseId} sample ${sample + 1} has invalid RGBA capture buffers.`;
          continue;
        }
        let pixelDifferenceCount = 0;
        for (let index = 0; index < entity.__rgba.length; index += 4) {
          if (
            entity.__rgba[index] !== candidate.__rgba[index] ||
            entity.__rgba[index + 1] !== candidate.__rgba[index + 1] ||
            entity.__rgba[index + 2] !== candidate.__rgba[index + 2] ||
            entity.__rgba[index + 3] !== candidate.__rgba[index + 3]
          )
            pixelDifferenceCount += 1;
        }
        const exactPixels =
          pixelDifferenceCount === 0 &&
          entity.pixelSha256 === candidate.pixelSha256;
        const sameGeometry = entity.geometrySha256 === candidate.geometrySha256;
        const sameStyle = entity.styleSha256 === candidate.styleSha256;
        const sameSourceIdentities =
          entity.sourceIdentitySha256 === candidate.sourceIdentitySha256;
        const samePick = (left, right) =>
          Boolean(left && right) &&
          JSON.stringify([
            left.kind,
            left.sourceKind,
            left.entityId,
            left.sourceRecordId,
            left.sourceOrdinal,
            left.screen,
          ]) ===
            JSON.stringify([
              right.kind,
              right.sourceKind,
              right.entityId,
              right.sourceRecordId,
              right.sourceOrdinal,
              right.screen,
            ]);
        const samePointPick = samePick(entity.pointPick, candidate.pointPick);
        const sameStemPick = samePick(entity.stemPick, candidate.stemPick);
        const comparison = {
          caseId,
          sample,
          status: 'compared',
          pixelDifferenceCount,
          pixelSha256: entity.pixelSha256,
          exactPixels,
          sameGeometry,
          sameStyle,
          sameSourceIdentities,
          samePointPick,
          sameStemPick,
        };
        report.comparisons.push(comparison);
        if (
          exactPixels &&
          sameGeometry &&
          sameStyle &&
          sameSourceIdentities &&
          samePointPick &&
          sameStemPick
        ) {
          exactComparisonCount += 1;
        } else {
          comparisonFailure ||= `${caseId} sample ${sample + 1} differs across renderers.`;
        }
        delete entity.__rgba;
        delete candidate.__rgba;
      }
    }
    report.comparisonSummary = {
      expectedPairs: comparisonIndex,
      capturedPairs: comparedGeometryCount,
      exactPairs: exactComparisonCount,
      unavailablePairs: comparisonIndex - comparedGeometryCount,
    };
    if (comparisonIndex !== 10 || comparedGeometryCount !== 10) {
      recordCableLifecycleFailure(report, {
        mode: 'comparison',
        activationOrder: null,
        stage: 'matched-capture-completeness',
        message: `Captured ${comparedGeometryCount} of ${comparisonIndex} expected matched samples.`,
      });
    }
    if (comparisonFailure) {
      recordCableLifecycleFailure(report, {
        mode: 'comparison',
        activationOrder: null,
        stage: 'geometry-and-rendered-parity',
        message: comparisonFailure,
      });
    }
    if (!report.failures?.length && exactComparisonCount === 10) {
      report.failedPhase = null;
      report.status = 'passed';
    } else {
      report.status = 'failed';
    }
  } catch (error) {
    const failure = {
      mode: 'comparison',
      activationOrder: null,
      stage: report.failedPhase || 'comparison',
      message: String(error?.stack || error?.message || error).slice(0, 3000),
    };
    report.failures ||= [];
    report.failures.push(failure);
    report.status = 'failed';
    if (!report.error) {
      report.failedPhase = failure.stage;
      report.error = failure.message;
    }
    const activeReadinessFailure = report.lifetimes
      .map((lifetime) => lifetime.readinessFailure)
      .filter(Boolean)[0];
    if (activeReadinessFailure && !report.readinessFailure)
      report.readinessFailure = activeReadinessFailure;
  } finally {
    for (const lifetime of report.lifetimes || []) {
      for (const sample of lifetime.samples || []) delete sample.__rgba;
    }
    if (viewer) {
      try {
        if (viewer.isDestroyed() === false) viewer.destroy();
      } catch (error) {
        report.cleanup = {
          error: String(error?.message || error).slice(0, 500),
        };
        report.status = 'failed';
      }
    }
  }
  return report;
}

function downloadReport(value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: 'application/json',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `cable-reference-render-${value.applicationCommit.slice(0, 7)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  downloadButton.disabled = true;
  statusNode.textContent = 'Running complete cable reference comparison…';
  outputNode.textContent = '';
  lastReport = await runComparison();
  outputNode.textContent = JSON.stringify(lastReport, null, 2);
  statusNode.textContent =
    lastReport.status === 'passed'
      ? 'Cable reference comparison passed.'
      : `Cable reference comparison failed at ${lastReport.failedPhase || 'unknown phase'}.`;
  downloadButton.disabled = false;
  runButton.disabled = false;
  window.__cableReferenceCollectionsResult = lastReport;
});

downloadButton.addEventListener('click', () => {
  if (lastReport) downloadReport(lastReport);
});
