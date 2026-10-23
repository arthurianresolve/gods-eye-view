import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Camera, Cartesian3, Ellipsoid, GeographicProjection } from 'cesium';
import { establishMapFrameCaptureHomeInPage } from './mapFrameCaptureHome.mjs';
import { MAP_STREAMING_ROUTE } from './mapStreamingCapture.mjs';

test('map frame home replaces differing startup poses with the pinned fixture route', () => {
  const homes = [];
  for (const longitude of [-97.7, -97.73]) {
    const scene = {
      canvas: { clientWidth: 1440, clientHeight: 900 },
      drawingBufferWidth: 2880,
      drawingBufferHeight: 1800,
      mapProjection: new GeographicProjection(Ellipsoid.WGS84),
      globe: { ellipsoid: Ellipsoid.WGS84 },
      requestRender() {},
    };
    const camera = new Camera(scene);
    camera.setView({
      destination: Cartesian3.fromDegrees(longitude, 30.27, 12000),
    });
    let cancelled = false;
    camera.cancelFlight = () => {
      cancelled = true;
    };
    const window = { __godsEyeView: { viewer: { scene, camera } } };
    vm.runInNewContext(
      `(${establishMapFrameCaptureHomeInPage.toString()})(route)`,
      { window, route: MAP_STREAMING_ROUTE },
    );
    assert.equal(cancelled, true);
    const home = window.__gevPerformanceHome;
    assert.ok(
      Cartesian3.distance(
        home.position,
        Cartesian3.fromDegrees(-97.72, 30.27, 6000),
      ) < 0.001,
    );
    assert.ok(Math.abs(camera.pitch + Math.PI / 2) < 1e-8);
    camera.moveRight(100);
    assert.ok(Cartesian3.distance(home.position, camera.position) > 99);
    homes.push(JSON.parse(JSON.stringify(home)));
  }
  assert.deepEqual(homes[0], homes[1]);
});
