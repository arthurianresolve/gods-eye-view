import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindEvidence } from './evidence.js';
import { createWindLayer } from './index.js';

const cycle = () => ({
  runIso: new Date(Date.now() - 3_600_000).toISOString(),
  validIso: new Date(Date.now() + 3_600_000).toISOString(),
});

test('forecast evidence keeps issue, valid and receipt times distinct', () => {
  const issuedAt = Date.now() - 3_600_000;
  const validAt = Date.now() + 3_600_000;
  const receivedAt = Date.now() - 1_000;
  const evidence = createWindEvidence(
    {
      cycle: {
        runIso: new Date(issuedAt).toISOString(),
        validIso: new Date(validAt).toISOString(),
      },
      grid: { nx: 360, ny: 181 },
    },
    { latitude: 40.7128, longitude: -74.006, speed: 7 },
    { model: 'ifs', receivedAt, feedState: 'nominal' },
  );

  assert.equal(evidence.sourceId, 'ECMWF IFS');
  assert.equal(evidence.sourceUrl, 'https://www.ecmwf.int/en/forecasts');
  assert.match(evidence.licenseRef, /CC BY 4.0/);
  assert.equal(evidence.observedAt, null, 'forecast is not an observation');
  assert.equal(evidence.issuedAt, issuedAt);
  assert.equal(evidence.validFrom, validAt);
  assert.equal(evidence.displayTime, validAt);
  assert.equal(evidence.receivedAt, receivedAt);
  assert.equal(evidence.method, 'predicted');
  assert.equal(evidence.displayMethod, 'interpolated');
  assert.equal(evidence.coverage.count, 360 * 181);
  assert.equal(evidence.coverage.completeness, 'unknown');
  assert.match(evidence.limitations.join(' '), /not a direct observation/);
});

test('sampled wind readings expose forecast evidence through a user action', async () => {
  const opened = [];
  class CustomEventMock {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const eventTarget = {
    CustomEvent: CustomEventMock,
    dispatchEvent(event) {
      opened.push(event);
    },
  };
  const rendering = Object.fromEntries(
    ['attach', 'start', 'stop', 'clear', 'destroy', 'setField'].map((name) => [
      name,
      () => {},
    ]),
  );
  const container = {
    ownerDocument: {
      createElement: () => ({
        style: {},
        setAttribute() {},
        remove() {},
      }),
    },
    appendChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const viewer = {
    container,
    camera: {
      positionWC: {},
      pickEllipsoid: () => ({ longitude: 0, latitude: 0 }),
    },
    scene: {
      mode: 3,
      canvas: {
        clientWidth: 800,
        clientHeight: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
      cartesianToCanvasCoordinates: () => ({ x: 400, y: 300 }),
      postRender: { addEventListener: () => () => {} },
      requestRender() {},
    },
  };
  const cesium = {
    Cartesian2: class {},
    Ellipsoid: { WGS84: {} },
    SceneMode: { SCENE3D: 3 },
    Cartographic: { fromCartesian: (position) => position },
    Math: { toDegrees: (value) => value },
    EllipsoidalOccluder: class {
      isPointVisible() {
        return true;
      }
    },
  };
  const modelCycle = cycle();
  const layer = createWindLayer({
    feed: {
      getSnapshot: async ({ model }) => ({
        model,
        grid: { nx: 2, ny: 2, lo1: 0, la1: 90, dx: 180, dy: 180 },
        cycle: modelCycle,
        u: new Float32Array(4).fill(4),
        v: new Float32Array(4).fill(3),
      }),
    },
    cesium,
    createRendering: () => rendering,
    eventTarget,
  });
  layer.init(viewer);
  layer.enable();
  await layer.update();
  layer.setParams({ inspect: true });

  const summary = layer.getRowControls().summary;
  assert.equal(summary.reading.evidence.method, 'predicted');
  assert.equal(summary.reading.evidence.receivedAt <= Date.now(), true);
  const inspect = summary.actions.find(
    ({ id }) => id === 'inspect-wind-evidence',
  );
  assert.ok(inspect);
  inspect.onClick();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].type, 'gev:evidence-record-opened');
  assert.equal(opened[0].detail.kind, 'forecast');
  assert.equal(opened[0].detail.evidence.sourceId, 'NOAA GFS');
  layer.destroy();
});
