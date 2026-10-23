/** Serialized page callback: establish a fixed frame route after map journeys. */
export function establishMapFrameCaptureHomeInPage(route) {
  const viewer = window.__godsEyeView.viewer;
  const camera = viewer.camera;
  if (viewer.trackedEntity)
    throw new Error('Map frame route cannot own a tracked camera.');
  const destination = viewer.scene.globe.ellipsoid.cartographicToCartesian({
    longitude: (route.start.longitude * Math.PI) / 180,
    latitude: (route.start.latitude * Math.PI) / 180,
    height: route.start.heightM,
  });
  camera.cancelFlight?.();
  camera.setView({
    destination,
    orientation: {
      heading: route.headingRadians,
      pitch: route.pitchRadians,
      roll: 0,
    },
  });
  window.__gevPerformanceHome = {
    position: camera.position.clone(),
    direction: camera.direction.clone(),
    up: camera.up.clone(),
    transform: camera.transform.clone(),
  };
  viewer.scene.requestRender();
}
