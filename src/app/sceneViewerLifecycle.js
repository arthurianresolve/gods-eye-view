import { disposeCameraVerbs } from '../cameraVerbs.js';
import { uninstallRenderGovernor } from '../renderGovernor.js';

/** Release application-owned viewer behavior before destroying the viewer. */
export function destroyApplicationSceneViewer(viewer) {
  const errors = [];
  try {
    disposeCameraVerbs(viewer);
  } catch (error) {
    errors.push(error);
  }
  try {
    uninstallRenderGovernor(viewer);
  } catch (error) {
    errors.push(error);
  }
  try {
    if (!viewer.isDestroyed()) viewer.destroy();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Scene viewer cleanup failed');
  }
}
