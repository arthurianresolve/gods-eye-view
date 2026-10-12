import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { setInfrastructureFixtureCamera } from './infrastructureFixtureCamera.mjs';

test('datacenter fixture camera looks at the source anchor and restores world coordinates', () => {
  const calls = [];
  const viewer = {
    camera: {
      lookAt(target, headingPitchRange) {
        calls.push({ type: 'lookAt', target, headingPitchRange });
      },
      lookAtTransform(transform) {
        calls.push({ type: 'lookAtTransform', transform });
      },
      setView() {
        calls.push({ type: 'setView' });
      },
    },
    scene: {
      requestRender() {
        calls.push({ type: 'requestRender' });
      },
    },
  };
  const anchor = {
    longitude: Cesium.Math.toRadians(12.5),
    latitude: Cesium.Math.toRadians(54.25),
    height: 3,
  };

  const contract = setInfrastructureFixtureCamera(
    viewer,
    anchor,
    140_000,
    'local-datacenters',
    { requestRender: true },
  );

  assert.deepEqual(
    calls.map((call) => call.type),
    ['lookAt', 'lookAtTransform', 'requestRender'],
  );
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      calls[0].target,
      Cesium.Cartesian3.fromRadians(
        anchor.longitude,
        anchor.latitude,
        anchor.height,
      ),
      1e-8,
    ),
  );
  assert.equal(calls[0].headingPitchRange.heading, 0);
  assert.equal(calls[0].headingPitchRange.pitch, -Math.PI / 3);
  assert.equal(calls[0].headingPitchRange.range, 140_000);
  assert.equal(calls[1].transform, Cesium.Matrix4.IDENTITY);
  assert.deepEqual(contract, {
    layerId: 'local-datacenters',
    kind: 'lookAt-world-frame',
    targetCartographic: [anchor.longitude, anchor.latitude, anchor.height],
    headingRadians: 0,
    pitchRadians: -Math.PI / 3,
    rangeMeters: 140_000,
    restoredTransform: 'IDENTITY',
  });
});

test('datacenter lookAt camera points at the anchor at the declared range in a real Cesium camera', () => {
  const scene = {
    canvas: { clientWidth: 960, clientHeight: 640 },
    drawingBufferWidth: 960,
    drawingBufferHeight: 640,
    mapProjection: new Cesium.GeographicProjection(),
    mode: Cesium.SceneMode.SCENE3D,
  };
  const camera = new Cesium.Camera(scene);
  const anchor = {
    longitude: Cesium.Math.toRadians(-70.85),
    latitude: Cesium.Math.toRadians(-53),
    height: 2_000,
  };
  const target = Cesium.Cartesian3.fromRadians(
    anchor.longitude,
    anchor.latitude,
    anchor.height,
  );

  setInfrastructureFixtureCamera(
    { camera, scene: { requestRender() {} } },
    anchor,
    140_000,
    'local-datacenters',
  );

  const targetDirection = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(
      target,
      camera.positionWC,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  assert.ok(
    Cesium.Cartesian3.dot(camera.directionWC, targetDirection) > 0.999999,
  );
  assert.ok(
    Math.abs(Cesium.Cartesian3.distance(camera.positionWC, target) - 140_000) <
      1e-6,
  );
  assert.ok(Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY));
});

test('dams retain the exact historical setView camera and no implicit render request', () => {
  const calls = [];
  const viewer = {
    camera: {
      setView(options) {
        calls.push(options);
      },
      lookAt() {
        assert.fail('dams must retain their historical camera path');
      },
      lookAtTransform() {
        assert.fail('dams must not change camera transforms');
      },
    },
    scene: {
      requestRender() {
        assert.fail('render request was not requested');
      },
    },
  };
  const anchor = { longitude: 0.4, latitude: -0.7 };

  const contract = setInfrastructureFixtureCamera(
    viewer,
    anchor,
    140_000,
    'local-dams',
  );

  assert.equal(calls.length, 1);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      calls[0].destination,
      Cesium.Cartesian3.fromRadians(anchor.longitude, anchor.latitude, 140_000),
      1e-8,
    ),
  );
  assert.deepEqual(calls[0].orientation, {
    heading: 0,
    pitch: -Math.PI / 3,
    roll: 0,
  });
  assert.equal(contract.kind, 'historical-setView');
});

test('fixture camera rejects an unregistered layer instead of choosing a framing policy', () => {
  assert.throws(
    () =>
      setInfrastructureFixtureCamera(
        { camera: {} },
        { longitude: 0, latitude: 0 },
        140_000,
        'unknown-layer',
      ),
    /Unsupported infrastructure fixture layer/,
  );
});
