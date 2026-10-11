import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateImportCoordinateKernelReport } from './importCoordinateKernelComparison.mjs';

const hash = (character) => character.repeat(64);
const commit = hash('a').slice(0, 40);
const witnesses = new Map();

async function pixelWitness(character) {
  if (witnesses.has(character)) return witnesses.get(character);
  const color = character.charCodeAt(0);
  const data = Buffer.alloc(4 * 4 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color;
    data[offset + 1] = 255 - color;
    data[offset + 2] = color ^ 0x5a;
    data[offset + 3] = 255;
  }
  const png = await sharp(data, {
    raw: { width: 4, height: 4, channels: 4 },
  })
    .png()
    .toBuffer();
  const witness = {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    pixelSha256: createHash('sha256').update(data).digest('hex'),
  };
  witnesses.set(character, witness);
  return witness;
}

async function arm(kernel, id) {
  const sample = async (shape, source, output, pixels) => {
    const witness = await pixelWitness(pixels);
    const featureId = `kernel-${shape}`;
    const entityId = `gev-import:kernel-fixture:kernel-fixture:${featureId}`;
    return {
      featureId,
      coordinateCount: 50_000,
      sourceCoordinatesSha256: hash(source),
      cartesianPositionsSha256: hash(output),
      styleSha256: hash('1'),
      pixelSha256: witness.pixelSha256,
      pngDataUrl: witness.dataUrl,
      width: 4,
      height: 4,
      loadAsyncElapsedMs: 20 + id,
      renderReadyElapsedMs: 400,
      firstUsableElapsedMs: 420 + id,
      readinessObservations: 3,
      captureElapsedMs: 4,
      nativePick: {
        recordId: featureId,
        expectedEntityId: entityId,
        pickedEntityId: entityId,
        screen: [2, 2],
        onCanvas: true,
      },
    };
  };
  return {
    status: 'passed',
    viewerDestroyed: true,
    coordinateKernel: kernel,
    applicationCommit: commit,
    harnessCommit: commit,
    environment: {
      appCommit: commit,
      harnessCommit: commit,
      renderer: 'ANGLE / OpenGL',
    },
    renderSettings: {
      sceneMode: 'SCENE3D',
      globeShow: true,
      imageryLayerCount: 0,
      clockEpoch: '2025-01-01T00:00:00.000Z',
      shouldAnimate: false,
      terrainProvider: 'EllipsoidTerrainProvider',
      width: 4,
      height: 4,
      msaaSamplesRequested: 4,
      msaaSupported: true,
      antialias: true,
      contextLost: false,
    },
    batchAttribution: { available: false },
    renderErrors: [],
    shapes: {
      line: await sample('line', 'b', 'c', 'd'),
      polygon: await sample('polygon', 'e', 'f', '0'),
    },
    clear: {
      featureCountAfter: 0,
      contextEntityCountAfter: 0,
      pendingJobsAfter: 0,
      cacheEntriesAfter: 0,
    },
  };
}

async function validReport() {
  return {
    schema: 'gev-import-coordinate-kernel/v1',
    status: 'passed',
    applicationCommit: commit,
    harnessCommit: commit,
    documentVisibilityAtStart: 'visible',
    foregroundUninterrupted: true,
    fixture: {
      lineCoordinateCount: 50_000,
      polygonCoordinateCount: 50_000,
      lineSourceSha256: hash('b'),
      polygonSourceSha256: hash('e'),
    },
    pairs: await Promise.all(
      Array.from({ length: 5 }, async (_, pair) => {
        const order =
          pair % 2
            ? ['scalar-experiment', 'cesium']
            : ['cesium', 'scalar-experiment'];
        return {
          pair,
          order,
          arms: Object.fromEntries(
            await Promise.all(
              order.map(async (kernel) => [kernel, await arm(kernel, pair)]),
            ),
          ),
        };
      }),
    ),
  };
}

test('accepts alternating full-fidelity pairs and reports first-usable timing scope', async () => {
  const result = await validateImportCoordinateKernelReport(
    await validReport(),
    commit,
  );
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.summary.pairedLoadDeltaRatios.length, 5);
  assert.equal(result.summary.pairedFirstUsableDeltaRatios.length, 5);
  assert.equal(result.summary.performanceAccepted, false);
  assert.match(result.summary.measuredScope, /first-usable/);
});

for (const [label, mutate] of [
  [
    'wrong app revision',
    (report) => {
      report.pairs[0].arms.cesium.applicationCommit = hash('f').slice(0, 40);
    },
  ],
  [
    'hidden start',
    (report) => {
      report.documentVisibilityAtStart = 'hidden';
    },
  ],
  [
    'interrupted foreground',
    (report) => {
      report.foregroundUninterrupted = false;
    },
  ],
  [
    'missing full polygon',
    (report) => {
      report.fixture.polygonCoordinateCount--;
    },
  ],
  [
    'unavailable batch timing disguised as a number',
    (report) => {
      report.pairs[0].arms.cesium.batchAttribution = {
        available: true,
        durationMs: 0,
      };
    },
  ],
  [
    'source hash not bound to the declared fixture',
    (report) => {
      report.pairs[0].arms.cesium.shapes.line.sourceCoordinatesSha256 =
        hash('8');
    },
  ],
  [
    'Cartesian output drift',
    (report) => {
      report.pairs[1].arms[
        'scalar-experiment'
      ].shapes.polygon.cartesianPositionsSha256 = hash('9');
    },
  ],
  [
    'effective style drift',
    (report) => {
      report.pairs[2].arms['scalar-experiment'].shapes.line.styleSha256 =
        hash('8');
    },
  ],
  [
    'reported pixels inconsistent with decoded PNG',
    (report) => {
      report.pairs[2].arms['scalar-experiment'].shapes.line.pixelSha256 =
        hash('7');
    },
  ],
  [
    'PNG dimensions inconsistent with decoded image',
    (report) => {
      report.pairs[2].arms.cesium.shapes.line.width = 5;
    },
  ],
  [
    'oversized PNG witness',
    (report) => {
      report.pairs[0].arms.cesium.shapes.line.pngDataUrl = `data:image/png;base64,${'A'.repeat(1_500_001)}`;
    },
  ],
  [
    'malformed PNG witness',
    (report) => {
      report.pairs[0].arms.cesium.shapes.line.pngDataUrl =
        'data:image/png;base64,AA==';
    },
  ],
  [
    'first usable time precedes load plus readiness',
    (report) => {
      report.pairs[0].arms.cesium.shapes.line.firstUsableElapsedMs = 1;
    },
  ],
  [
    'native Entity identity drift',
    (report) => {
      report.pairs[3].arms[
        'scalar-experiment'
      ].shapes.polygon.nativePick.pickedEntityId = 'kernel-polygon';
    },
  ],
  [
    'resource leak',
    (report) => {
      report.pairs[4].arms.cesium.clear.featureCountAfter = 1;
    },
  ],
  [
    'nonalternating order',
    (report) => {
      report.pairs[1].order.reverse();
    },
  ],
]) {
  test(`rejects ${label}`, async () => {
    const report = await validReport();
    mutate(report);
    assert.equal(
      (await validateImportCoordinateKernelReport(report, commit)).valid,
      false,
    );
  });
}

test('keeps a measured regression as valid evidence while failing the unchanged 10% gate', async () => {
  const report = await validReport();
  for (const pair of report.pairs)
    for (const shape of ['line', 'polygon']) {
      pair.arms['scalar-experiment'].shapes[shape].loadAsyncElapsedMs = 40;
      pair.arms['scalar-experiment'].shapes[shape].firstUsableElapsedMs = 440;
    }
  const result = await validateImportCoordinateKernelReport(report, commit);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.summary.regressionGatePassed, false);
});

test('first-usable regression fails the gate even when load time improves', async () => {
  const report = await validReport();
  for (const pair of report.pairs)
    for (const shape of ['line', 'polygon']) {
      const sample = pair.arms['scalar-experiment'].shapes[shape];
      sample.loadAsyncElapsedMs = 18;
      sample.renderReadyElapsedMs = 462;
      sample.firstUsableElapsedMs = 480;
    }
  const result = await validateImportCoordinateKernelReport(report, commit);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.summary.medianLoadDeltaRatioByShape.line.load < 0, true);
  assert.equal(result.summary.regressionGatePassed, false);
});
