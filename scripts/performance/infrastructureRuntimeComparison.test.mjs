import test from 'node:test';
import assert from 'node:assert/strict';
import { infrastructureFixtureLayer } from '../fixtures/infrastructureFixtureLayer.mjs';
import { runInfrastructurePickPathControls } from '../fixtures/infrastructurePickPathDiagnostic.mjs';
import {
  countInfrastructureGraphics,
  createInfrastructureSampleReadiness,
  infrastructureCameraRevisionReady,
  compareInfrastructureRuntimeLifetimes,
  INFRASTRUCTURE_RUNTIME_CASES,
  INFRASTRUCTURE_RUNTIME_PAIRS,
  validateInfrastructureRuntimeReport,
} from './infrastructureRuntimeComparison.mjs';

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const renderClock = {
  iso: '2026-10-11T12:00:00.000Z',
  julianDayNumber: 2461325,
  secondsOfDay: 43200,
  shouldAnimate: false,
};

function sample(mode, caseId, pair, layer = infrastructureFixtureLayer()) {
  const collection = mode === 'primitive-collections';
  const id = `${caseId}-surface-${pair}`;
  const datacenter = layer.layerId === 'local-datacenters';
  const pointId = datacenter ? `${id}-point-owner` : id;
  const stemId = datacenter ? `${id}-stem-owner` : id;
  const ownerPick = (kind, entityId, screen) => ({
    entityId,
    sourceRecordId: `${entityId}-source`,
    kind,
    screen,
    ...(datacenter
      ? {
          layerId: layer.layerId,
          ownerVerified: true,
          primitiveType:
            kind === 'point'
              ? 'PointPrimitive'
              : collection
                ? 'Polyline'
                : 'Primitive',
          appearanceType:
            kind === 'stem' && !collection ? 'PolylineColorAppearance' : null,
        }
      : {}),
  });
  return {
    caseId,
    pair,
    mode,
    status: 'settled',
    sourceFeatureCount: layer.sourceFeatureCount,
    surfaceCount: layer.surfaceCount,
    entityCount: layer.entityCount,
    entitySelectionIdentity: stemId,
    identitySha256: digest,
    geometrySha256: digest,
    styleSha256: digest,
    styleAudit: {
      entityId: stemId,
      entityShow: true,
      point: {
        rawColor: [0, 0.5333333333, 1, 1],
        graphicsOrPrimitiveShow: true,
        effectiveShow: true,
      },
      stem: {
        rawColor: [0, 0.5333333333, 1, 1],
        graphicsOrPrimitiveShow: true,
        effectiveShow: true,
      },
    },
    pixelSha256: digest,
    pngBase64: 'iVBORw0KGgo=',
    pixelDifferenceCount: 1000,
    frame: { width: 960, height: 640, completedStableFrames: 3 },
    clock: { ...renderClock },
    sceneReadiness: { dataSourcesReady: true, globeTilesLoaded: true },
    cameraPosition: [1, 2, 3],
    lodDiagnostics: {
      computed: true,
      geometryDirty: false,
      cameraPosition: [1, 2, 3],
    },
    pointPick: {
      ...ownerPick('point', pointId, [100, 110]),
    },
    stemPick: ownerPick('stem', stemId, [102, 120]),
    ownership: {
      renderer: mode,
      datasourcePresent: true,
      entityCount: layer.entityCount,
      surfaceEntityCount: layer.surfaceCount,
      entitySurfaceGraphics: collection ? 0 : layer.surfaceCount,
      preservedGraphics: { ...layer.preservedGraphics },
      rendererOwners: collection ? 1 : 0,
      rendererOwnerChildren: collection ? [2] : [],
      sceneDataSourceCount: 1,
      scenePrimitiveCount: collection ? 4 : 3,
      sceneGroundPrimitiveCount: 1,
    },
    productionDiagnostics: collection
      ? {
          mode,
          owners: 1,
          attached: true,
          points: layer.surfaceCount,
          stems: layer.surfaceCount,
        }
      : null,
    layerResourceDiagnostics: {
      surfaceCollectionOwners: collection ? 1 : 0,
      surfacePoints: collection ? layer.surfaceCount : 0,
      surfaceStems: collection ? layer.surfaceCount : 0,
    },
  };
}

function lifetime(mode, layer = infrastructureFixtureLayer()) {
  const result = {
    mode,
    activationOrder: mode === 'entities' ? 0 : 1,
    activationContext: 'test fixture lifetime context',
    status: 'passed',
    activationDiagnosticMs: 100,
    activationTimingScope:
      'single-layer-activation-diagnostic-not-performance-evidence',
    sceneBaseline: {
      dataSources: 0,
      scenePrimitives: 3,
      groundPrimitives: 1,
      rendererOwners: 0,
    },
    initialOwnership: {
      dataSources: 0,
      scenePrimitives: 3,
      groundPrimitives: 1,
      rendererOwners: 0,
    },
    renderClock: { ...renderClock },
    samples: INFRASTRUCTURE_RUNTIME_CASES.flatMap((caseId) =>
      Array.from({ length: INFRASTRUCTURE_RUNTIME_PAIRS }, (_, pair) =>
        sample(mode, caseId, pair, layer),
      ),
    ),
    teardown: {
      layerDestroyed: true,
      dataSourceRemoved: true,
      rendererOwnersRemoved: true,
      instrumentationRestored: true,
      viewerKeptForNextLifetime: true,
      dataSourceCountAfterDestroy: 0,
      ownerCountAfterDestroy: 0,
      scenePrimitiveCountAfterDestroy: 3,
      groundPrimitiveCountAfterDestroy: 1,
    },
  };
  if (layer.layerId === 'local-datacenters') {
    result.cameraContract = {
      layerId: layer.layerId,
      kind: 'lookAt-world-frame',
      targetCartographic: [
        (-70.85 * Math.PI) / 180,
        (-53 * Math.PI) / 180,
        2000,
      ],
      headingRadians: 0,
      pitchRadians: -Math.PI / 3,
      sampleRangesMeters: [140_000, 170_000],
      restoredTransform: 'IDENTITY',
    };
  }
  return result;
}

function validReport(layerId = 'local-dams') {
  const layer = infrastructureFixtureLayer(layerId);
  const baseline = lifetime('entities', layer);
  const candidate = lifetime('primitive-collections', layer);
  return {
    schema: layer.schema,
    applicationCommit: commit,
    harnessCommit: commit,
    environment: {
      appCommit: commit,
      harnessCommit: commit,
      renderer: 'ANGLE test renderer',
      drawingBuffer: { width: 960, height: 640 },
    },
    source: {
      layerId,
      featureCount: layer.sourceFeatureCount,
      payloadBytes: 400,
      payloadSha256: digest,
      geometryKinds: { ...layer.geometryKinds },
    },
    candidateRepresentation: {
      id: 'production-local-infrastructure-primitive-collections/rgba8/v1',
      stemColorEncoding: 'entity-color-attribute-byte',
    },
    samplingScope:
      'five-correctness-snapshots-per-case-not-alternating-performance-runs',
    renderClock: { ...renderClock },
    viewerOwnedDisplayWarmup: {
      completedFrames: 2,
      temporaryDataSourceRemoved: true,
      dataSourcesBefore: 0,
      dataSourcesAfter: 0,
      primitiveCountsBefore: { scenePrimitives: 1, groundPrimitives: 0 },
      primitiveCountsAfter: { scenePrimitives: 3, groundPrimitives: 1 },
    },
    status: 'passed',
    lifetimes: [baseline, candidate],
    comparisons: INFRASTRUCTURE_RUNTIME_CASES.flatMap((caseId) =>
      Array.from({ length: INFRASTRUCTURE_RUNTIME_PAIRS }, (_, pair) => ({
        caseId,
        pair,
        pixelSha256Equal: true,
        identityEqual: true,
        geometryEqual: true,
        styleEqual: true,
        picksEqual: true,
        framebufferEqual: true,
      })),
    ),
    cleanup: { viewerDestroyed: true },
  };
}

function pickPathDiagnosticEnvelope() {
  const makeObservation = () => {
    const selected = { value: { id: 'prior' } };
    const frameState = {
      completedRenderRevision: 1,
      cameraPosition: [1, 2, 3],
      renderClockIso: renderClock.iso,
    };
    return {
      ...runInfrastructurePickPathControls({
        pick(kind) {
          return { id: { id: `${kind}-owner` } };
        },
        resolve(picked) {
          return {
            ownerVerified: true,
            entityId: picked.id.id,
            sourceRecordId: `${picked.id.id}-source`,
            selectionValue: picked.id,
          };
        },
        getSelection: () => selected.value,
        setSelection: (value) => {
          selected.value = value;
        },
        candidateEntityId: 'candidate-1',
        pointScreen: { x: 120, y: 200 },
        stemScreen: { x: 120, y: 230 },
        completedRenderRevision: 1,
        renderSignature: `${'c'.repeat(64)}:${'d'.repeat(64)}`,
        phase: 'initial-stable-render',
        budget: { calls: 0, limit: 5 },
        captureFrameState: frameState,
        readFrameState: () => frameState,
      }),
      caseId: 'default-style',
      pair: 0,
      cameraPosition: [1, 2, 3],
      renderClockIso: renderClock.iso,
    };
  };
  return {
    schema: 'gev-infrastructure-pick-path-diagnostic/v1',
    enabled: true,
    instrumented: true,
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    pickAcceptanceEligible: false,
    scope:
      'synchronous native scene picks in three selection-order controls; diagnostic calls never satisfy fixture pick gates',
    frameWitnessSemantics:
      'postRender count, camera position and clock only; scene.pick may advance internal preparation',
    maxCandidatesPerLifetime: 2,
    maxCompletedRenderRevisionsPerCandidate: 2,
    maxPickCallsPerLifetime: 20,
    maxPickCalls: 40,
    pickCalls: 10,
    status: 'complete',
    lifetimes: [
      {
        mode: 'entities',
        maxPickCalls: 20,
        pickCalls: 5,
        status: 'passed',
        renderRevisionObserver: { available: true, cleanupConfirmed: true },
        observations: [makeObservation()],
      },
      {
        mode: 'primitive-collections',
        maxPickCalls: 20,
        pickCalls: 5,
        status: 'passed',
        renderRevisionObserver: { available: true, cleanupConfirmed: true },
        observations: [makeObservation()],
      },
    ],
  };
}

test('pick-path instrumentation is excluded from acceptance unless explicitly opted in', () => {
  const report = validReport('local-datacenters');
  report.instrumentation = {
    pickPathDiagnostic: pickPathDiagnosticEnvelope(),
  };
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /not acceptance eligible/,
  );
  assert.equal(
    validateInfrastructureRuntimeReport(report, {
      expectedCommit: commit,
      expectedLayerId: 'local-datacenters',
      allowPickPathDiagnostic: true,
    }),
    true,
  );
  const incomplete = structuredClone(report);
  incomplete.instrumentation.pickPathDiagnostic.status =
    'partial-or-diagnostic-error';
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(incomplete, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
        allowPickPathDiagnostic: true,
      }),
    /diagnostic is incomplete/,
  );
  const forged = structuredClone(report);
  forged.instrumentation.pickPathDiagnostic.pickAcceptanceEligible = true;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(forged, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
        allowPickPathDiagnostic: true,
      }),
    /malformed/,
  );
});

test('diagnostic option requires its evidence and rejects unknown instrumentation fields', () => {
  const report = validReport('local-datacenters');
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
        allowPickPathDiagnostic: true,
      }),
    /evidence is missing/,
  );
  report.instrumentation = {
    pickPathDiagnostic: pickPathDiagnosticEnvelope(),
    payload: 'unexpected',
  };
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
        allowPickPathDiagnostic: true,
      }),
    /not acceptance eligible/,
  );
});

test('runtime report validates independent default and production lifetimes', () => {
  assert.equal(
    validateInfrastructureRuntimeReport(validReport(), {
      expectedCommit: commit,
    }),
    true,
  );
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(validReport(), {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /different requested layer/,
  );
});

test('runtime report binds the complete datacenter source and Entity inventory', () => {
  const report = validReport('local-datacenters');
  assert.equal(
    validateInfrastructureRuntimeReport(report, {
      expectedCommit: commit,
      expectedLayerId: 'local-datacenters',
    }),
    true,
  );
  const truncated = structuredClone(report);
  truncated.lifetimes[1].samples[0].entityCount--;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(truncated, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /incomplete render or ownership/,
  );
  const wrongKinds = structuredClone(report);
  wrongKinds.source.geometryKinds.Point--;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(wrongKinds, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /source inventory changed/,
  );
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, {
        expectedCommit: commit,
        expectedLayerId: 'local-dams',
      }),
    /different requested layer/,
  );
  const changedCamera = structuredClone(report);
  changedCamera.lifetimes[1].cameraContract.targetCartographic[0] += 0.01;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(changedCamera, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /different source-anchor camera contracts/,
  );
  const invalidCamera = structuredClone(report);
  invalidCamera.lifetimes[0].cameraContract.targetCartographic[0] = -70.85;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(invalidCamera, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /camera contract is missing or invalid/,
  );
  const missingOwner = structuredClone(report);
  delete missingOwner.lifetimes[0].samples[0].pointPick.ownerVerified;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(missingOwner, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /invalid native scene pick/,
  );
  const wrongSelection = structuredClone(report);
  wrongSelection.lifetimes[0].samples[0].entitySelectionIdentity =
    wrongSelection.lifetimes[0].samples[0].pointPick.entityId;
  wrongSelection.lifetimes[0].samples[0].styleAudit.entityId =
    wrongSelection.lifetimes[0].samples[0].pointPick.entityId;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(wrongSelection, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /invalid native scene pick/,
  );
  const mismatchedOwner = structuredClone(report);
  const candidateSample = mismatchedOwner.lifetimes[1].samples[0];
  candidateSample.pointPick.entityId = 'different-valid-point-owner';
  candidateSample.pointPick.sourceRecordId = 'different-valid-source';
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(mismatchedOwner, {
        expectedCommit: commit,
        expectedLayerId: 'local-datacenters',
      }),
    /differs between production renderers/,
  );
});

test('runtime report rejects synthesized ownership, duplicate Graphics, and incomplete teardown', () => {
  const wrongMode = structuredClone(validReport());
  wrongMode.lifetimes[0].mode = 'synthetic-entities';
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(wrongMode, {
        expectedCommit: commit,
      }),
    /independent default and candidate/,
  );

  const duplicate = structuredClone(validReport());
  duplicate.lifetimes[1].samples[0].ownership.entitySurfaceGraphics = 4;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(duplicate, {
        expectedCommit: commit,
      }),
    /sole production-owned collection/,
  );

  const leaked = structuredClone(validReport());
  leaked.lifetimes[0].teardown.dataSourceRemoved = false;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(leaked, { expectedCommit: commit }),
    /did not clean up/,
  );

  const missingPair = structuredClone(validReport());
  missingPair.lifetimes[1].samples.pop();
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(missingPair, {
        expectedCommit: commit,
      }),
    /sample inventory is incomplete/,
  );
});

test('runtime pair comparison requires exact pixels, geometry, style and native pick identity', () => {
  const baseline = lifetime('entities');
  const candidate = lifetime('primitive-collections');
  assert.equal(
    compareInfrastructureRuntimeLifetimes(baseline, candidate).length,
    10,
  );
  candidate.samples[0].geometrySha256 = 'c'.repeat(64);
  assert.throws(
    () => compareInfrastructureRuntimeLifetimes(baseline, candidate),
    /differs between production renderers/,
  );
});

test('runtime report recomputes comparisons and requires populated ownership baselines', () => {
  const staleFlags = validReport();
  staleFlags.lifetimes[1].samples[0].pixelSha256 = 'c'.repeat(64);
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(staleFlags, {
        expectedCommit: commit,
      }),
    /differs between production renderers/,
  );

  const duplicate = validReport();
  duplicate.comparisons[1] = structuredClone(duplicate.comparisons[0]);
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(duplicate, {
        expectedCommit: commit,
      }),
    /comparisons do not match captured samples/,
  );

  const missingBaseline = validReport();
  delete missingBaseline.lifetimes[0].initialOwnership;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(missingBaseline, {
        expectedCommit: commit,
      }),
    /initial scene ownership is missing or inconsistent/,
  );

  const inconsistentVisibility = validReport();
  inconsistentVisibility.lifetimes[1].samples[0].styleAudit.stem.effectiveShow = false;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(inconsistentVisibility, {
        expectedCommit: commit,
      }),
    /incomplete render or ownership evidence/,
  );

  const movingClock = validReport();
  movingClock.lifetimes[1].samples[0].clock.secondsOfDay += 0.001;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(movingClock, {
        expectedCommit: commit,
      }),
    /incomplete render or ownership evidence/,
  );

  const animatedClock = validReport();
  animatedClock.renderClock.shouldAnimate = true;
  for (const lifetime of animatedClock.lifetimes)
    for (const sample of lifetime.samples) sample.clock.shouldAnimate = true;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(animatedClock, {
        expectedCommit: commit,
      }),
    /comparison clock is invalid/,
  );

  const unremovedWarmup = validReport();
  unremovedWarmup.viewerOwnedDisplayWarmup.temporaryDataSourceRemoved = false;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(unremovedWarmup, {
        expectedCommit: commit,
      }),
    /display was not warmed and restored/,
  );
});

test('surface ownership excludes retained line geometry and still detects duplicate Graphics', () => {
  const surface = { point: {}, polyline: {}, polygon: {} };
  const line = { polyline: {} };
  assert.deepEqual(countInfrastructureGraphics([surface, line], [surface]), {
    surfaceGraphics: 1,
    preservedGraphics: { points: 0, polylines: 1, polygons: 1 },
  });
  surface.point = surface.polyline = undefined;
  assert.deepEqual(countInfrastructureGraphics([surface, line], [surface]), {
    surfaceGraphics: 0,
    preservedGraphics: { points: 0, polylines: 1, polygons: 1 },
  });
  surface.point = {};
  assert.equal(
    countInfrastructureGraphics([surface, line], [surface]).surfaceGraphics,
    1,
  );
  const report = validReport();
  report.lifetimes[1].samples[0].ownership.preservedGraphics.polylines--;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, { expectedCommit: commit }),
    /Preserved source geometry inventory/,
  );
});

test('runtime report requires observed renderer identity and drawing-buffer dimensions', () => {
  const report = validReport();
  report.environment.renderer = null;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, { expectedCommit: commit }),
    /observed renderer environment/,
  );
  report.environment.renderer = 'ANGLE test renderer';
  report.environment.drawingBuffer.width++;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, { expectedCommit: commit }),
    /incomplete render or ownership evidence/,
  );
});

test('late geometry completion permits a fresh native pick without polling unchanged frames', () => {
  const gate = createInfrastructureSampleReadiness();
  gate.observe('points-ready-stems-pending');
  assert.equal(gate.takePickAttempt(), false);
  gate.observe('points-ready-stems-pending');
  gate.observe('points-ready-stems-pending');
  assert.equal(gate.takePickAttempt(), true);
  for (let i = 0; i < 5; i++) {
    gate.observe('points-ready-stems-pending');
    assert.equal(gate.takePickAttempt(), false);
  }
  assert.equal(gate.observe('points-and-stems-ready'), 1);
  assert.equal(gate.takePickAttempt(), false);
  gate.observe('points-and-stems-ready');
  gate.observe('points-and-stems-ready');
  assert.equal(gate.takePickAttempt(), true);
  assert.equal(gate.takePickAttempt(), false);
});

test('stable pixels from a prior camera revision cannot satisfy the sample gate', () => {
  const gate = createInfrastructureSampleReadiness();
  for (let i = 0; i < 10; i++) {
    assert.equal(gate.observe('old-geometry', { inputsReady: false }), 0);
    assert.equal(gate.takePickAttempt(), false);
  }
  assert.equal(gate.observe('new-geometry'), 1);
  gate.observe('new-geometry');
  gate.observe('new-geometry');
  assert.equal(gate.takePickAttempt(), true);
  assert.equal(gate.observe('old-geometry', { inputsReady: false }), 0);
  assert.equal(gate.observe('new-geometry'), 1);
  assert.equal(gate.takePickAttempt(), false);
});

test('camera readiness requires consumed geometry and the current finite pose', () => {
  const observed = {
    computed: true,
    geometryDirty: false,
    cameraPosition: [1, 2, 3],
  };
  assert.equal(infrastructureCameraRevisionReady(observed, [1, 2, 3]), true);
  assert.equal(infrastructureCameraRevisionReady(observed, [1, 2, 4]), false);
  assert.equal(
    infrastructureCameraRevisionReady(
      { ...observed, geometryDirty: true },
      [1, 2, 3],
    ),
    false,
  );
  assert.equal(
    infrastructureCameraRevisionReady(
      { ...observed, computed: false },
      [1, 2, 3],
    ),
    false,
  );
  assert.equal(infrastructureCameraRevisionReady(observed, [1, 2, NaN]), false);
  const report = validReport();
  report.lifetimes[0].samples[0].cameraPosition[2]++;
  assert.throws(
    () =>
      validateInfrastructureRuntimeReport(report, { expectedCommit: commit }),
    /incomplete render or ownership/,
  );
});

test('native picks do not establish completion of the remaining scene geometry', () => {
  for (const key of ['dataSourcesReady', 'globeTilesLoaded']) {
    const report = validReport();
    report.lifetimes[1].samples[0].sceneReadiness[key] = false;
    assert.throws(
      () =>
        validateInfrastructureRuntimeReport(report, { expectedCommit: commit }),
      /incomplete render or ownership/,
    );
  }
});
