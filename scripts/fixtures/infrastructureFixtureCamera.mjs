import * as Cesium from 'cesium';
import { infrastructureFixtureLayer } from './infrastructureFixtureLayer.mjs';

const DATACENTER_LAYER_ID = 'local-datacenters';
const CAMERA_HEADING = 0;
const CAMERA_PITCH = -Math.PI / 3;

/**
 * Aim a fixture camera at its actual source anchor. Dams retain their
 * historical setView pose; datacenters use lookAt so the anchor stays in the
 * camera frustum, then return the camera to the world identity transform.
 */
export function setInfrastructureFixtureCamera(
  viewer,
  anchor,
  heightMeters,
  layerId,
  { requestRender = false } = {},
) {
  infrastructureFixtureLayer(layerId);
  if (layerId === DATACENTER_LAYER_ID) {
    const targetHeight = Number.isFinite(anchor?.height) ? anchor.height : 0;
    const target = Cesium.Cartesian3.fromRadians(
      anchor.longitude,
      anchor.latitude,
      targetHeight,
    );
    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(CAMERA_HEADING, CAMERA_PITCH, heightMeters),
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    if (requestRender) viewer.scene.requestRender();
    return {
      layerId,
      kind: 'lookAt-world-frame',
      targetCartographic: [anchor.longitude, anchor.latitude, targetHeight],
      headingRadians: CAMERA_HEADING,
      pitchRadians: CAMERA_PITCH,
      rangeMeters: heightMeters,
      restoredTransform: 'IDENTITY',
    };
  }

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      anchor.longitude,
      anchor.latitude,
      heightMeters,
    ),
    orientation: { heading: 0, pitch: CAMERA_PITCH, roll: 0 },
  });
  if (requestRender) viewer.scene.requestRender();
  return {
    layerId,
    kind: 'historical-setView',
    destinationCartographic: [anchor.longitude, anchor.latitude, heightMeters],
    headingRadians: 0,
    pitchRadians: CAMERA_PITCH,
    rollRadians: 0,
  };
}
