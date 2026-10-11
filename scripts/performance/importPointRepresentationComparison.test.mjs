import assert from 'node:assert/strict';
import test from 'node:test';
import { compareImportPointRepresentationReports } from './importPointRepresentationComparison.mjs';

const hash = (digit) => digit.repeat(64);

function makeRun(representation) {
  const entity = representation === 'entity';
  const pointState = {
    available: true,
    renderer: representation,
    expectedCount: 5000,
    entityCount: 5000,
    visualizerItemCount: entity ? 5000 : 0,
    primitiveCount: 5000,
    blendOption: 2,
    entityOrderAndStateSha256: hash('1'),
    entityToPrimitiveAssignmentSha256: hash('2'),
    primitiveDrawOrderAndStateSha256: hash('3'),
    nativePickWitness: {
      tested: 1,
      importedHits: 1,
      rows: [
        {
          targetId: 'gev-import:fixture:0',
          screen: [100, 100],
          pickedEntityId: 'gev-import:fixture:0',
        },
      ],
    },
  };
  const samples = [];
  for (let pair = 0; pair < 5; pair++)
    for (const mode of ['synchronous', 'cooperative'])
      samples.push({
        pair,
        mode,
        features: 5000,
        pixelSha256: hash('a'),
        pointVisualState: structuredClone(pointState),
      });
  return {
    schema: 'gev-hosted-native-renderer/v1',
    status: 'passed',
    hardwareRenderingAvailable: true,
    renderingEvidence: [
      { accelerationVerified: true },
      { accelerationVerified: true },
    ],
    captureMatrix: { status: 'passed' },
    importBatches: {
      schema: 'gev-import-batches/v2',
      status: 'passed',
      applicationCommit: 'a'.repeat(40),
      harnessCommit: 'a'.repeat(40),
      fixture: 'synthetic-5000-import-points/v1',
      pointRepresentation: representation,
      featureLimit: 5000,
      workload: 'paired',
      captureMode: 'pixels',
      viewerConstruction: 'application-wrapper',
      environment: {
        appCommit: 'a'.repeat(40),
        harnessCommit: 'a'.repeat(40),
        renderer: 'test-renderer',
        viewport: { width: 960, height: 640, dpr: 1 },
        drawingBuffer: { width: 960, height: 640 },
      },
      renderConfiguration: {
        pointRepresentation: representation,
        viewerConstruction: 'application-wrapper',
        captureMode: 'pixels',
        preserveDrawingBuffer: true,
        renderDemand: false,
        msaaSamplesRequested: 4,
        antialias: true,
        msaaSupported: true,
        webglContextAttributes: { antialias: true },
        sceneMode: 3,
        canvas: {
          cssWidth: 960,
          cssHeight: 640,
          drawingBufferWidth: 960,
          drawingBufferHeight: 640,
        },
        camera: { position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0] },
      },
      warmedResources: {
        importedFeatureCount: 5000,
        pointPrimitiveCount: 5000,
        entities: entity ? 5000 : 0,
      },
      samples,
      largeGeometry: {
        exactOutputParity: true,
        synchronous: { rows: [{ id: 'line', geometrySha256: hash('b') }] },
        cooperative: { rows: [{ id: 'line', geometrySha256: hash('b') }] },
      },
      cancellation: {
        attempted: 12,
        abortErrors: 12,
        pendingJobsAfter: 0,
        featureCountAfter: 0,
        pointPrimitiveCountAfter: 0,
        ownershipReleased: true,
      },
    },
  };
}

test('matches five fresh Entity and point-collection runs with exact native state and pixels', () => {
  const compared = compareImportPointRepresentationReports(
    makeRun('entity'),
    makeRun('primitive-collection'),
  );
  assert.equal(compared.valid, true, compared.errors.join('; '));
  assert.equal(compared.summary.pixelSamplesCompared, 10);
  assert.equal(compared.summary.pointStateSamplesCompared, 10);
  assert.equal(compared.summary.performanceAcceptanceEligible, false);
});

test('rejects changed pixels, point identity/order, native picks, or effective render settings', () => {
  const entity = makeRun('entity');
  const collection = makeRun('primitive-collection');
  collection.importBatches.samples[0].pixelSha256 = hash('c');
  collection.importBatches.samples[1].pointVisualState.nativePickWitness.rows[0].pickedEntityId =
    'gev-import:fixture:other';
  collection.importBatches.samples[2].pointVisualState.primitiveDrawOrderAndStateSha256 =
    hash('d');
  collection.importBatches.renderConfiguration.camera.position[0] = 4;
  const compared = compareImportPointRepresentationReports(entity, collection);
  assert.equal(compared.valid, false);
  assert.ok(
    compared.errors.some((error) => error.includes('pixel output differs')),
  );
  assert.ok(
    compared.errors.some((error) =>
      error.includes('point identity/style/order/picks differ'),
    ),
  );
  assert.ok(
    compared.errors.includes('effective render settings or camera differ'),
  );
});

test('rejects missing, duplicate, mislabeled, or unaccelerated renderer evidence', () => {
  const entity = makeRun('entity');
  const collection = makeRun('primitive-collection');
  collection.importBatches.samples.pop();
  collection.importBatches.samples.push(
    structuredClone(entity.importBatches.samples[0]),
  );
  collection.importBatches.pointRepresentation = 'entity';
  collection.hardwareRenderingAvailable = false;
  const compared = compareImportPointRepresentationReports(entity, collection);
  assert.equal(compared.valid, false);
  assert.ok(
    compared.errors.some((error) => error.includes('accelerated rendering')),
  );
  assert.ok(
    compared.errors.some((error) => error.includes('duplicate sample')),
  );
  assert.ok(
    compared.errors.some((error) => error.includes('renderer identity')),
  );
});

test('rejects incomplete warmup, geometry, or cancellation ownership', () => {
  const entity = makeRun('entity');
  const collection = makeRun('primitive-collection');
  collection.importBatches.warmedResources.pointPrimitiveCount = 4999;
  collection.importBatches.largeGeometry.cooperative.rows = [];
  collection.importBatches.cancellation.pointPrimitiveCountAfter = 1;
  const compared = compareImportPointRepresentationReports(entity, collection);
  assert.equal(compared.valid, false);
  assert.ok(
    compared.errors.some((error) => error.includes('warmup population')),
  );
  assert.ok(
    compared.errors.includes('cooperative line/polygon geometry differs'),
  );
  assert.ok(
    compared.errors.some((error) =>
      error.includes('cancellation/primitive cleanup'),
    ),
  );
});
