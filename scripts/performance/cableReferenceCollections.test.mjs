import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CABLE_REFERENCE_RENDER_CASES,
  CABLE_REFERENCE_RENDER_POPULATION,
  CABLE_REFERENCE_RENDER_SAMPLES,
  CABLE_REFERENCE_RENDER_SCHEMA,
  validateCableReferenceCollectionsReport,
} from './cableReferenceCollections.mjs';

const commit = 'a'.repeat(40);

test('static Entity stem picks require the actual polyline appearance and owner', () => {
  const report = validReport();
  report.lifetimes[0].samples[0].stemPick.primitiveType = 'Primitive';
  report.lifetimes[0].samples[0].stemPick.appearanceType =
    'PolylineColorAppearance';
  assert.equal(
    validateCableReferenceCollectionsReport(report, { expectedCommit: commit }),
    true,
  );
  for (const invalid of [
    { appearanceType: 'PerInstanceColorAppearance' },
    { ownerVerified: false },
  ]) {
    const changed = structuredClone(report);
    Object.assign(changed.lifetimes[0].samples[0].stemPick, invalid);
    assert.throws(
      () =>
        validateCableReferenceCollectionsReport(changed, {
          expectedCommit: commit,
        }),
      /verified native owned pick/,
    );
  }
});

test('owned readiness contract rejects pending, truncated and missing observations', () => {
  const report = validReport();
  report.samplingContract = 'owned-primitives-ready/v1';
  for (const lifetime of report.lifetimes)
    for (const sample of lifetime.samples)
      sample.primitiveReadiness = {
        ready: true,
        truncated: false,
        observedOwners: 20,
        pending: [],
      };
  assert.equal(
    validateCableReferenceCollectionsReport(report, { expectedCommit: commit }),
    true,
  );
  for (const invalid of [
    undefined,
    { ready: false },
    { ready: true, truncated: true, observedOwners: 64, pending: [] },
    {
      ready: true,
      truncated: false,
      observedOwners: 20,
      pending: [{ path: 'pending' }],
    },
  ]) {
    const changed = structuredClone(report);
    changed.lifetimes[0].samples[0].primitiveReadiness = invalid;
    assert.throws(
      () =>
        validateCableReferenceCollectionsReport(changed, {
          expectedCommit: commit,
        }),
      /unfinished primitive/,
    );
  }
  report.samplingContract = 'unsupported';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(report, {
        expectedCommit: commit,
      }),
    /contract is unknown/,
  );
});
const hash = 'b'.repeat(64);
const renderClock = {
  iso: '2026-10-11T12:34:56.000Z',
  shouldAnimate: false,
};
const camera = {
  caseId: 'default-style',
  targetCartographic: [-0.5, 0.7, 2000],
  rangeMeters: 120000,
  headingRadians: 0,
  pitchRadians: -Math.PI / 3,
  restoredTransform: 'IDENTITY',
  actualCamera: {
    position: [1, 2, 3],
    direction: [0, 0, -1],
    up: [0, 1, 0],
  },
};
const pointPick = {
  kind: 'point',
  sourceKind: 'landing-point',
  entityId: 'landing-point-reference-1-landing-1',
  sourceRecordId: 'landing-1',
  sourceOrdinal: 1,
  ownerVerified: true,
  primitiveType: 'PointPrimitive',
  screen: [480, 320],
};
const stemPick = {
  ...pointPick,
  entityId: 'cable-reference-2-cable-2',
  sourceRecordId: 'cable-2',
  sourceOrdinal: 2,
  sourceKind: 'cable',
  kind: 'stem',
  primitiveType: 'PolylineCollection',
  screen: [483, 306],
};

function jsonHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sample(mode, caseId, sampleIndex) {
  const localCamera = {
    ...camera,
    caseId,
    targetCartographic: [...camera.targetCartographic],
    actualCamera: {
      position: [...camera.actualCamera.position],
      direction: [...camera.actualCamera.direction],
      up: [...camera.actualCamera.up],
    },
  };
  const localPoint = { ...pointPick };
  const localStem = { ...stemPick };
  const surfaceCount = CABLE_REFERENCE_RENDER_POPULATION.referenceRecords;
  return {
    mode,
    caseId,
    sample: sampleIndex,
    status: 'settled',
    stableFrames: 3,
    clock: { ...renderClock },
    sourceCounts: { ...CABLE_REFERENCE_RENDER_POPULATION },
    sourceIdentitySha256: hash,
    sourceManifestSha256: hash,
    viewerSettingsSha256: hash,
    viewerEnvironmentSha256: hash,
    geometrySha256: caseId === 'default-style' ? hash : 'c'.repeat(64),
    styleSha256: caseId === 'default-style' ? hash : 'd'.repeat(64),
    overlaySha256: caseId === 'default-style' ? hash : 'e'.repeat(64),
    cameraSha256: jsonHash(localCamera),
    frame: { width: 960, height: 640 },
    pixelSha256: hash,
    pngBase64: 'iVBORw0KGgo=',
    camera: localCamera,
    cameraSweep:
      caseId === 'camera-change'
        ? {
            status: 'swept',
            frameNumber: 42,
            finalPoseVerified: true,
            flightCompleteVerified: true,
            cameraEventWaitMs: 500,
          }
        : {
            status: 'not-required',
            frameNumber: null,
            finalPoseVerified: null,
            flightCompleteVerified: null,
            cameraEventWaitMs: null,
          },
    classification: {
      terrain: 'TERRAIN',
      photoreal: 'CESIUM_3D_TILE',
      afterRestore: 'TERRAIN',
    },
    visibility: {
      visibleReferences: 800,
      hiddenReferences: surfaceCount - 800,
    },
    ownership: {
      referenceCollections: mode === 'collections' ? 2 : 0,
      referencePoints: mode === 'collections' ? surfaceCount : 0,
      referenceStems: mode === 'collections' ? surfaceCount : 0,
    },
    pointPick: localPoint,
    stemPick: localStem,
  };
}

function lifetime(mode, activationOrder) {
  const samples = CABLE_REFERENCE_RENDER_CASES.flatMap((caseId) =>
    Array.from({ length: CABLE_REFERENCE_RENDER_SAMPLES }, (_, index) =>
      sample(mode, caseId, index),
    ),
  );
  return {
    mode,
    status: 'passed',
    activationOrder,
    population: { ...CABLE_REFERENCE_RENDER_POPULATION },
    sourceIdentitySha256: hash,
    sourceManifestSha256: hash,
    viewerSettingsSha256: null,
    viewerEnvironmentSha256: null,
    geometrySha256: hash,
    styleSha256: hash,
    overlaySha256: hash,
    ownership: {
      baselineDataSources: 0,
      lifetimeCount: 2,
      activeDataSources: 3,
      referenceGraphics: mode === 'entities' ? 2629 * 2 : 0,
      referenceCollections: mode === 'collections' ? 2 : 0,
      referencePoints: mode === 'collections' ? 2629 : 0,
      referenceStems: mode === 'collections' ? 2629 : 0,
    },
    teardown: {
      disabled: true,
      reEnabled: true,
      dataSourcesRemoved: 3,
      collectionsRemoved: mode === 'collections' ? 6 : 0,
      overlayHidden: true,
      destroyed: true,
      listenersAfterDestroy: 0,
      remainingDataSources: 0,
      remainingCollections: 0,
    },
    samples,
  };
}

function validReport() {
  const lifetimes = [lifetime('entities', 0), lifetime('collections', 1)];
  const comparisons = [];
  for (const caseId of CABLE_REFERENCE_RENDER_CASES) {
    for (let index = 0; index < CABLE_REFERENCE_RENDER_SAMPLES; index += 1) {
      const entity = lifetimes[0].samples.find(
        (row) => row.caseId === caseId && row.sample === index,
      );
      comparisons.push({
        caseId,
        sample: index,
        pixelDifferenceCount: 0,
        pixelSha256: entity.pixelSha256,
        exactPixels: true,
        sameGeometry: true,
        sameStyle: true,
        sameSourceIdentities: true,
        samePointPick: true,
        sameStemPick: true,
      });
    }
  }
  const report = {
    schema: CABLE_REFERENCE_RENDER_SCHEMA,
    applicationCommit: commit,
    harnessCommit: commit,
    status: 'passed',
    source: {
      population: { ...CABLE_REFERENCE_RENDER_POPULATION },
      cableGeoSha256: hash,
      landingGeoSha256: hash,
      identitySha256: hash,
    },
    renderClock: { ...renderClock },
    viewer: {
      baselineDataSources: 0,
      lifetimeCount: 2,
      sceneMode: 'SCENE3D',
      globeShown: true,
      terrainProvider: 'EllipsoidTerrainProvider',
    },
    settings: {
      requestRenderMode: false,
      resolutionScale: 1,
      msaaSamples: 4,
      preserveDrawingBuffer: true,
      antialias: true,
      webglVersion: 'WebGL 2.0 (Metal)',
    },
    environment: {
      drawingBuffer: { width: 960, height: 640 },
      viewport: { width: 1200, height: 1000, dpr: 1 },
    },
    lifetimes,
    comparisons,
  };
  for (const current of report.lifetimes) {
    current.viewerSettingsSha256 = jsonHash(report.settings);
    current.viewerEnvironmentSha256 = jsonHash(report.environment);
  }
  return report;
}

test('accepts a complete exact Entity/collection cable render comparison', () => {
  assert.equal(
    validateCableReferenceCollectionsReport(validReport(), {
      expectedCommit: commit,
    }),
    true,
  );
});

test('rejects image or geometry drift even when supplied comparison flags claim success', () => {
  const changedPixel = validReport();
  changedPixel.lifetimes[1].samples[0].pixelSha256 = 'c'.repeat(64);
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(changedPixel, {
        expectedCommit: commit,
      }),
    /differs across renderers/,
  );

  const changedGeometry = validReport();
  changedGeometry.lifetimes[1].samples[0].geometrySha256 = 'c'.repeat(64);
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(changedGeometry, {
        expectedCommit: commit,
      }),
    /differs across renderers/,
  );
});

test('rejects truncated source populations, fake picks, and incomplete teardown', () => {
  const truncated = validReport();
  truncated.lifetimes[1].population.referenceRecords -= 1;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(truncated, {
        expectedCommit: commit,
      }),
    /incomplete referenceRecords population/,
  );

  const fakePick = validReport();
  fakePick.lifetimes[1].samples[0].pointPick.ownerVerified = false;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(fakePick, {
        expectedCommit: commit,
      }),
    /not a verified native owned pick/,
  );

  const leaked = validReport();
  leaked.lifetimes[1].teardown.remainingCollections = 1;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(leaked, {
        expectedCommit: commit,
      }),
    /did not settle/,
  );
});

test('accepts independent natural point and stem owners and per-case state changes', () => {
  const report = validReport();
  const entityPoint = report.lifetimes[0].samples.find(
    (row) => row.caseId === 'default-style' && row.sample === 0,
  );
  const entityStem = report.lifetimes[0].samples.find(
    (row) => row.caseId === 'camera-change' && row.sample === 0,
  );
  assert.notEqual(
    entityPoint.pointPick.entityId,
    entityPoint.stemPick.entityId,
  );
  assert.notEqual(
    entityPoint.pointPick.sourceKind,
    entityPoint.stemPick.sourceKind,
  );
  assert.notEqual(entityPoint.geometrySha256, entityStem.geometrySha256);
  assert.equal(
    validateCableReferenceCollectionsReport(report, {
      expectedCommit: commit,
    }),
    true,
  );
});

test('rejects a different natural pick owner or unsupported primitive type', () => {
  const changedOwner = validReport();
  const collectionsPoint = changedOwner.lifetimes[1].samples.find(
    (row) => row.caseId === 'default-style' && row.sample === 0,
  ).pointPick;
  collectionsPoint.entityId = 'cable-reference-3-cable-3';
  collectionsPoint.sourceRecordId = 'cable-3';
  collectionsPoint.sourceOrdinal = 3;
  collectionsPoint.sourceKind = 'cable';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(changedOwner, {
        expectedCommit: commit,
      }),
    /differs across renderers/,
  );

  const foreignPrimitive = validReport();
  foreignPrimitive.lifetimes[1].samples[0].stemPick.primitiveType = 'Billboard';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(foreignPrimitive, {
        expectedCommit: commit,
      }),
    /not a verified native owned pick/,
  );
});

test('rejects missing camera/stability evidence, stale settings hashes, and cleanup failures', () => {
  const missingCamera = validReport();
  missingCamera.lifetimes[1].samples[0].camera.targetCartographic[1] = 99;
  missingCamera.lifetimes[1].samples[0].cameraSha256 = jsonHash(
    missingCamera.lifetimes[1].samples[0].camera,
  );
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(missingCamera, {
        expectedCommit: commit,
      }),
    /camera contract is missing or malformed/,
  );

  const missingStableFrames = validReport();
  delete missingStableFrames.lifetimes[0].samples[0].stableFrames;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(missingStableFrames, {
        expectedCommit: commit,
      }),
    /sample 1 is incomplete/,
  );

  const staleSettings = validReport();
  staleSettings.lifetimes[0].viewerSettingsSha256 = hash;
  staleSettings.lifetimes[1].viewerSettingsSha256 = hash;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(staleSettings, {
        expectedCommit: commit,
      }),
    /settings\/environment hashes are stale/,
  );

  const cleanupFailed = validReport();
  cleanupFailed.lifetimes[1].cleanupError = 'fixture cleanup failed';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(cleanupFailed, {
        expectedCommit: commit,
      }),
    /did not settle/,
  );

  const software = validReport();
  software.settings.antialias = false;
  for (const current of software.lifetimes)
    current.viewerSettingsSha256 = jsonHash(software.settings);
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(software, {
        expectedCommit: commit,
      }),
    /environment is incomplete/,
  );

  const skippedSweep = validReport();
  delete skippedSweep.lifetimes[0].samples[0].cameraSweep;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(skippedSweep, {
        expectedCommit: commit,
      }),
    /sample 1 is incomplete/,
  );

  const prematureSweep = validReport();
  const cameraChangedRow = prematureSweep.lifetimes[0].samples.find(
    (row) => row.caseId === 'camera-change',
  );
  cameraChangedRow.cameraSweep.frameNumber = 0;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(prematureSweep, {
        expectedCommit: commit,
      }),
    /camera-change sample 1 is incomplete/,
  );

  const missingMoveEndWindow = validReport();
  const noCameraWait = missingMoveEndWindow.lifetimes[0].samples.find(
    (row) => row.caseId === 'camera-change',
  );
  noCameraWait.cameraSweep.cameraEventWaitMs = null;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(missingMoveEndWindow, {
        expectedCommit: commit,
      }),
    /camera-change sample 1 is incomplete/,
  );

  const unverifiedFinalPose = validReport();
  const unverifiedRow = unverifiedFinalPose.lifetimes[0].samples.find(
    (row) => row.caseId === 'camera-change',
  );
  unverifiedRow.cameraSweep.finalPoseVerified = false;
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(unverifiedFinalPose, {
        expectedCommit: commit,
      }),
    /camera-change sample 1 is incomplete/,
  );
});

test('rejects wrong commit, changed map-stack classification, and partial screenshots', () => {
  const wrongCommit = validReport();
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(wrongCommit, {
        expectedCommit: 'd'.repeat(40),
      }),
    /source identity changed/,
  );

  const changedMapStack = validReport();
  changedMapStack.lifetimes[1].samples[0].classification.photoreal = 'TERRAIN';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(changedMapStack, {
        expectedCommit: commit,
      }),
    /sample 1 is incomplete/,
  );

  const noImage = validReport();
  noImage.lifetimes[0].samples[0].pngBase64 = '';
  assert.throws(
    () =>
      validateCableReferenceCollectionsReport(noImage, {
        expectedCommit: commit,
      }),
    /sample 1 is incomplete/,
  );
});
