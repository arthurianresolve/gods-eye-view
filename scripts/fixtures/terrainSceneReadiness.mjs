/** Create the readiness record from one observed Cesium scene sample. */
export function createTerrainSceneReadinessSample({
  elapsedMs,
  frameNumber,
  postRenderCount,
  tilesLoaded,
  dataSourceDisplayReady,
  workers,
  camera,
  currentUpdateReadiness,
  controller,
}) {
  if (typeof controller?.getActiveId !== 'function')
    throw new TypeError('Scene readiness requires a current map owner reader.');
  const activeStackId = controller.getActiveId();
  if (typeof activeStackId !== 'string' || !activeStackId)
    throw new Error('Scene readiness has no current map owner.');
  return {
    elapsedMs,
    frameNumber,
    postRenderCount,
    tilesLoaded,
    dataSourceDisplayReady,
    pending: workers.pending,
    workerCounters: workers,
    workerSignature: JSON.stringify(
      workers.workers.map((worker) => ({
        kind: worker.kind,
        submitted: worker.submitted,
        completed: worker.completed,
        cancelled: worker.cancelled,
        pending: worker.pending,
        taskErrors: worker.taskErrors,
        workerErrors: worker.workerErrors,
        postErrors: worker.postErrors,
      })),
    ),
    camera,
    currentUpdateReadiness,
    activeStackId,
  };
}
