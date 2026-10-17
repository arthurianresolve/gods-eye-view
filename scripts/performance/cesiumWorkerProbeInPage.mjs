/**
 * Exercise a page's already-loaded Cesium worker path without importing source
 * modules from the application origin. Keeping this function self-contained
 * lets Puppeteer serialize it into both Vite development and sealed preview
 * builds, where `/scripts` and `/src` are intentionally not published.
 */
export async function runCesiumWorkerProbeInPage(
  { includeDiagnostics = false, timeoutMs = 10_000 } = {},
) {
  const CesiumRef = globalThis.Cesium;
  if (
    !CesiumRef?.BoxGeometry ||
    !CesiumRef?.Cartesian3 ||
    !CesiumRef?.TaskProcessor
  )
    throw new Error('The page did not expose the loaded Cesium worker APIs.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new RangeError('Worker probe timeout is invalid.');

  const geometry = new CesiumRef.BoxGeometry({
    minimum: new CesiumRef.Cartesian3(-1, -1, -1),
    maximum: new CesiumRef.Cartesian3(1, 1, 1),
  });
  const parameters = {
    subTasks: [{ geometry, moduleName: 'createBoxGeometry' }],
  };
  const tasks = [
    { id: 'geometry-cold', parameters },
    { id: 'geometry-reuse', parameters },
    {
      id: 'geometry-error',
      parameters: {
        subTasks: [{ moduleName: 'createBoxGeometry', modulePath: 'invalid' }],
      },
      expectError: /Must only set moduleName or modulePath/,
    },
    { id: 'geometry-recovery', parameters },
  ];
  const processor = new CesiumRef.TaskProcessor('createGeometry', 1);
  const startedAt = performance.now();
  const results = [];
  try {
    for (const task of tasks) {
      let timer;
      const work = processor.scheduleTask(task.parameters);
      if (!work) throw new Error('Worker probe task was not accepted.');
      try {
        let outcome = 'resolved';
        try {
          await Promise.race([
            work,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                const error = new Error(
                  'Worker completion timed out: ' + task.id,
                );
                error.code = 'WORKER_PROBE_TIMEOUT';
                reject(error);
              }, timeoutMs);
            }),
          ]);
        } catch (error) {
          if (error.code === 'WORKER_PROBE_TIMEOUT') throw error;
          if (
            !task.expectError ||
            !task.expectError.test(String(error.message))
          )
            throw error;
          outcome = 'rejected-as-expected';
        }
        if (task.expectError && outcome !== 'rejected-as-expected')
          throw new Error('Worker failed to reject invalid task: ' + task.id);
        if (processor._activeTasks !== 0)
          throw new Error(
            'Worker probe retained active tasks after settlement.',
          );
        results.push({ id: task.id, outcome });
      } finally {
        clearTimeout(timer);
      }
    }
    const probe = {
      status: 'passed',
      durationMs: performance.now() - startedAt,
      tasks: results,
    };
    return includeDiagnostics
      ? {
          probe,
          diagnostics: globalThis.__gevSoakWorkers?.snapshot?.() || null,
        }
      : probe;
  } finally {
    processor.destroy();
  }
}
