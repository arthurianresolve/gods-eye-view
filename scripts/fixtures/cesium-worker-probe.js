import * as Cesium from 'cesium';
import { probeWorkerCompletion } from '../performance/workerProbe.mjs';

/** Same assets and interception as the app, including a dynamic geometry import. */
export async function runCesiumWorkerProbe() {
  const geometry = new Cesium.BoxGeometry({
    minimum: new Cesium.Cartesian3(-1, -1, -1),
    maximum: new Cesium.Cartesian3(1, 1, 1),
  });
  const parameters = {
    subTasks: [{ geometry, moduleName: 'createBoxGeometry' }],
  };
  return probeWorkerCompletion({
    createProcessor: () => new Cesium.TaskProcessor('createGeometry', 1),
    tasks: [
      { id: 'geometry-cold', parameters },
      { id: 'geometry-reuse', parameters },
      {
        id: 'geometry-error',
        parameters: {
          subTasks: [
            { moduleName: 'createBoxGeometry', modulePath: 'invalid' },
          ],
        },
        expectError: /Must only set moduleName or modulePath/,
      },
      { id: 'geometry-recovery', parameters },
    ],
  });
}
