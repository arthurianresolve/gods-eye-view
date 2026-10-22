/**
 * Serializable page observer. Install before warmup; start at the existing
 * measurement boundary. This observes the production loop without requesting
 * frames or changing any visual setting.
 */
export function installSettledIdleObservation() {
  const key = '__gevSettledIdleObservationV1';
  if (window[key])
    throw new Error('An idle observer already owns this document.');
  const scene = window.__godsEyeView?.viewer?.scene;
  if (
    !scene?.postUpdate?.addEventListener ||
    !scene?.postRender?.addEventListener ||
    !scene?.globe?.tileLoadProgressEvent?.addEventListener
  )
    throw new Error('Public idle settlement events are unavailable.');

  const now = () => performance.now();
  const pose = () => Array.from(scene.camera.viewMatrix);
  const samePose = (expected) =>
    expected.length === 16 &&
    expected.every(
      (value, index) =>
        Number.isFinite(value) && value === scene.camera.viewMatrix[index],
    );
  let previousPose = pose();
  let stableSince = null;
  let startedAt = null;
  let measurementPose = null;
  let observation = null;
  let stopped = false;
  let pendingTiles = 0;
  const removers = [];

  function observe() {
    const at = now();
    const loaded = scene.globe.tilesLoaded === true && pendingTiles === 0;
    const onDemand = scene.requestRenderMode === true;
    const unchanged = samePose(previousPose);
    if (!loaded || !onDemand || !unchanged) stableSince = null;
    if (loaded && onDemand && unchanged && stableSince == null)
      stableSince = at;
    if (!unchanged) previousPose = pose();
    if (observation) {
      observation.settlement.tilesLoadedThroughout &&= loaded;
      observation.settlement.requestRenderModeThroughout &&= onDemand;
      observation.settlement.cameraUnchanged &&= samePose(measurementPose);
    }
  }
  function onTiles(pending) {
    pendingTiles = pending;
    if (!Number.isFinite(pending) || pending !== 0) {
      stableSince = null;
      if (observation) observation.settlement.nonzeroTileProgressEvents++;
    }
    observe();
  }
  function onRender() {
    observe();
    if (startedAt == null || stopped) return;
    if (observation.completedFrameOffsetsMs.length < 2048)
      observation.completedFrameOffsetsMs.push(Math.max(0, now() - startedAt));
    else observation.framesOmitted++;
  }
  function dispose() {
    stopped = true;
    let confirmed = true;
    for (const remove of removers.splice(0)) {
      try {
        if (remove() === false) confirmed = false;
      } catch {
        confirmed = false;
      }
    }
    if (window[key] === controller) delete window[key];
    else confirmed = false;
    if (observation) observation.cleanupConfirmed = confirmed;
    return confirmed;
  }
  const controller = {
    start(at) {
      if (stopped || observation || !Number.isFinite(at))
        throw new Error('Invalid idle observation start.');
      observe();
      startedAt = at;
      measurementPose = pose();
      observation = {
        schema: 'gev-settled-idle-observation/v1',
        diagnosticOnly: false,
        durationMs: 0,
        completedFrameOffsetsMs: [],
        framesOmitted: 0,
        cleanupConfirmed: false,
        settlement: {
          tileProgressObserved: true,
          settledBeforeMs:
            stableSince == null ? 0 : Math.max(0, at - stableSince),
          initialTilesLoaded: scene.globe.tilesLoaded === true,
          finalTilesLoaded: false,
          tilesLoadedThroughout: scene.globe.tilesLoaded === true,
          requestRenderModeThroughout: scene.requestRenderMode === true,
          cameraUnchanged: true,
          nonzeroTileProgressEvents: 0,
        },
      };
    },
    stop(at) {
      if (stopped || !observation || !Number.isFinite(at) || at < startedAt)
        throw new Error('Invalid idle observation stop.');
      observe();
      observation.durationMs = at - startedAt;
      observation.settlement.finalTilesLoaded =
        scene.globe.tilesLoaded === true;
      dispose();
      return observation;
    },
    dispose,
  };
  window[key] = controller;
  try {
    removers.push(scene.postUpdate.addEventListener(observe));
    removers.push(scene.postRender.addEventListener(onRender));
    removers.push(scene.globe.tileLoadProgressEvent.addEventListener(onTiles));
    if (removers.some((remove) => typeof remove !== 'function'))
      throw new Error('Idle events did not provide removal handles.');
    observe();
  } catch (error) {
    dispose();
    throw error;
  }
  return { installed: true, schema: 'gev-settled-idle-observation/v1' };
}
