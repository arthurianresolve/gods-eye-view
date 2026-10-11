import test from 'node:test';
import assert from 'node:assert/strict';
import { createGround } from './ground.js';
import { SUPPORT_KEYS } from '../../data/cctvFootprint.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function record(id, source, { active = false, shipped = false } = {}) {
  const camera = {
    id,
    lat: 40,
    lon: -73,
    headingDeg: 90,
    pitchDeg: -15,
    fovDeg: 70,
    rangeM: 700,
    mountHeightM: 20,
    ...(shipped ? { groundHeights: { mountGroundM: 100 } } : {}),
  };
  const value = {
    camera,
    probeClampRangeM: 500,
    probeClampSource: source,
    groundPrior: { ellipsoid: 100 },
    groundSamples: { 'google-3d': 118 },
    groundResolved: { 'google-3d': true },
    footprintRevision: 0,
    footprintGround: null,
  };
  if (active) value.active = true;
  return value;
}

function setup() {
  const ownerA = {};
  const ownerB = {};
  const active = record('active-camera', ownerA, { active: true });
  const other = record('other-camera', ownerA);
  const calls = {
    geometry: [],
    queued: [],
    terrain: [],
    refreshTileset: 0,
    probes: 0,
  };
  const pending = [];
  let source = ownerA;
  let tilesReady = true;
  const state = {
    _viewer: { scene: { globe: { show: false } } },
    _records: [active, other],
    _recordById: new Map([
      [active.camera.id, active],
      [other.camera.id, other],
    ]),
    _activeCameraId: active.camera.id,
    _enabled: true,
    _lastAppliedRegime: 'google-3d',
    _googleGroundSource: ownerA,
    _hasGoogleGroundSource: true,
    _tilesReadyReenqueued: true,
  };
  const services = {
    terrain: {
      resolveEllipsoidalGround(coords) {
        const next = deferred();
        pending.push({ coords, ...next });
        return next.promise;
      },
    },
    ground: { resolveGroundFloorCells: async () => {} },
    mesh: {
      reconcileMeshFloorSource() {
        return { changed: false, source };
      },
    },
    render: {},
  };
  const parts = {
    geometry: {
      hasShippedFootprint: (value) => !!value.camera.groundHeights,
      footprintPose(value) {
        return {
          lat: value.camera.lat,
          lon: value.camera.lon,
          headingDeg: value.camera.headingDeg,
          pitchDeg: value.camera.pitchDeg,
          fovDeg: value.camera.fovDeg,
          rangeM: value.probeClampRangeM || value.camera.rangeM,
          mountHeightM: value.camera.mountHeightM,
        };
      },
      applyFrustumGeometry(value, ground) {
        calls.geometry.push({ id: value.camera.id, ground });
      },
      runActivationObstructionProbe(value) {
        calls.probes++;
        value.probeClampRangeM = 450;
        value.probeClampSource = source;
        value.probeClampPendingSource = null;
      },
    },
    geometryQueue: {
      enqueueGeometryRefresh(values) {
        calls.queued.push([...values]);
      },
    },
    model: {
      projectionTilesReady: () => tilesReady,
      refreshProjectionTileset() {
        calls.refreshTileset++;
      },
    },
    rendering: { refreshCoverageStyles() {} },
    presentation: { notifyListeners() {} },
  };
  const ground = createGround({ state, services, parts, source: {} });
  return {
    ownerA,
    ownerB,
    active,
    other,
    calls,
    pending,
    state,
    ground,
    setSource: (v) => (source = v),
    setTilesReady: (v) => (tilesReady = v),
  };
}

test('same visible tileset keeps mesh samples and avoids geometry work', () => {
  const env = setup();
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerA,
    },
  });
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerA,
    },
  });
  assert.deepEqual(env.calls.geometry, []);
  assert.deepEqual(env.calls.queued, []);
  assert.equal(env.calls.refreshTileset, 0);
  assert.equal(env.active.groundSamples['google-3d'], 118);
});

test('settled owner runs an activation probe deferred during switching even when owner is unchanged', () => {
  const env = setup();
  env.active.probeClampPendingMapSwitch = true;
  env.active.probeClampPendingSource = null;

  env.ground.handleMapStackChanged({
    detail: {
      status: 'switching',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerA,
    },
  });
  assert.equal(env.calls.probes, 0);
  assert.equal(env.active.probeClampPendingMapSwitch, true);

  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerA,
    },
  });
  assert.equal(env.calls.probes, 1);
  assert.equal(env.active.probeClampPendingMapSwitch, false);
  assert.equal(env.active.probeClampPendingSource, null);
  assert.equal(env.active.probeClampSource, env.ownerA);
});

test('switching event cannot rebind, while a settled new source defers the obstruction probe until tiles are ready', () => {
  const env = setup();
  env.setSource(env.ownerB);
  env.setTilesReady(false);
  env.ground.handleMapStackChanged({
    detail: {
      status: 'switching',
      surfaceOwnerKnown: true,
      surfaceOwner: null,
    },
  });
  assert.equal(env.calls.refreshTileset, 0);
  assert.equal(env.calls.probes, 0);
  assert.equal(env.active.groundSamples['google-3d'], 118);

  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerB,
    },
  });
  assert.equal(env.calls.refreshTileset, 1);
  assert.equal(
    env.calls.probes,
    0,
    'no raycast against a streaming replacement',
  );
  assert.equal(env.active.probeClampRangeM, null);
  assert.equal(env.active.probeClampPendingSource, env.ownerB);

  assert.equal(env.ground.updatePendingGoogleProbe(), false);
  assert.equal(env.calls.probes, 0);
  env.setTilesReady(true);
  assert.equal(env.ground.updatePendingGoogleProbe(), true);
  assert.equal(env.calls.probes, 1);
  assert.equal(env.active.probeClampRangeM, 450);
  assert.equal(env.active.probeClampSource, env.ownerB);
  assert.equal(env.active.probeClampPendingSource, null);
});

test('new visible tileset invalidates only its mesh-ground owner and refreshes a dependent clamp footprint', async () => {
  const env = setup();
  // Begin a DEM request for the old clamp pose. Its response must not replace
  // the result requested after the tileset probe changes the effective range.
  const oldRequest = env.ground.resolveFootprintGround(env.active);
  assert.equal(env.pending.length, 1);
  env.setSource(env.ownerB);
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerB,
    },
  });

  assert.equal(env.active.groundSamples['google-3d'], undefined);
  assert.equal(env.other.groundSamples['google-3d'], undefined);
  assert.equal(env.other.groundResolved['google-3d'], false);
  assert.equal(
    env.other.footprintGround,
    null,
    'independent DEM footprint remains untouched',
  );
  assert.equal(env.active.probeClampRangeM, 450);
  assert.equal(env.active.probeClampSource, env.ownerB);
  assert.equal(env.calls.refreshTileset, 1);
  assert.equal(env.calls.queued.length, 1);
  assert.deepEqual(env.calls.queued[0], [env.active, env.other]);
  assert.equal(
    env.pending.length,
    2,
    'new effective footprint pose triggers one fresh DEM lookup',
  );

  env.pending[1].resolve(
    SUPPORT_KEYS.map(() => ({ ellipsoid: 22, source: 'reearth' })),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.active.footprintGround.supports.bl, 22);
  const accepted = env.active.footprintGround;
  env.pending[0].resolve(
    SUPPORT_KEYS.map(() => ({ ellipsoid: 99, source: 'reearth' })),
  );
  await oldRequest;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    env.active.footprintGround,
    accepted,
    'late result from old pose is dropped',
  );
  assert.equal(env.active.footprintGround.supports.bl, 22);
});

test('provider owner changes do not invalidate shipped footprint samples', () => {
  const env = setup();
  const shipped = record('shipped-camera', env.ownerA, { shipped: true });
  env.state._records = [shipped];
  env.state._recordById = new Map([[shipped.camera.id, shipped]]);
  env.state._activeCameraId = shipped.camera.id;
  env.setSource(env.ownerB);
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerB,
    },
  });
  assert.equal(shipped.groundSamples['google-3d'], 118);
  assert.equal(shipped.groundResolved['google-3d'], true);
  assert.equal(shipped.footprintGround, null);
  assert.deepEqual(env.calls.queued, []);
});

test('a superseded pending owner cannot probe after a later settled source wins', () => {
  const env = setup();
  env.setSource(env.ownerB);
  env.setTilesReady(false);
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerB,
    },
  });
  assert.equal(env.active.probeClampPendingSource, env.ownerB);
  assert.equal(env.calls.probes, 0);

  env.setSource(env.ownerA);
  env.setTilesReady(true);
  env.ground.handleMapStackChanged({
    detail: {
      status: 'ready',
      surfaceOwnerKnown: true,
      surfaceOwner: env.ownerA,
    },
  });
  assert.equal(env.calls.probes, 1);
  assert.equal(env.active.probeClampSource, env.ownerA);
  assert.equal(env.active.probeClampPendingSource, null);
  assert.equal(
    env.ground.updatePendingGoogleProbe(),
    false,
    'no deferred callback remains owned by the replaced tileset',
  );
  assert.equal(env.calls.probes, 1);
});
