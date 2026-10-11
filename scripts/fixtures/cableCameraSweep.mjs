/**
 * Wait for camera movement to settle at the completed flight pose, then for a
 * completed frame in which camera-dependent layer work can consume that pose.
 */
export function createCableCameraSweepGate(
  camera,
  scene,
  { timeoutMs = 12_000, readPose, samePose } = {},
) {
  if (
    typeof camera?.moveEnd?.addEventListener !== 'function' ||
    typeof scene?.postRender?.addEventListener !== 'function' ||
    typeof scene?.requestRender !== 'function' ||
    typeof readPose !== 'function' ||
    typeof samePose !== 'function' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new TypeError('Camera sweep gate inputs are invalid.');

  let finished = false;
  let flightComplete = false;
  let moveEndSeen = false;
  let moveEndPose = null;
  let expectedPose;
  let moveEndRemove = null;
  let postRenderRemove = null;
  let timer = null;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    moveEndRemove?.();
    moveEndRemove = null;
    postRenderRemove?.();
    postRenderRemove = null;
  };
  const finish = (value) => {
    if (finished) return;
    finished = true;
    cleanup();
    resolvePromise(value);
  };
  const fail = (error) => {
    if (finished) return;
    finished = true;
    cleanup();
    rejectPromise(error);
  };

  const onPostRender = () => {
    let finalPoseMatches = false;
    try {
      finalPoseMatches =
        flightComplete && samePose(readPose(), expectedPose) === true;
    } catch (error) {
      fail(error);
      return;
    }
    if (!finalPoseMatches) {
      postRenderRemove?.();
      postRenderRemove = null;
      moveEndSeen = false;
      moveEndPose = null;
      return;
    }
    const frameNumber = scene.frameState?.frameNumber;
    finish({
      status: 'swept',
      frameNumber: Number.isSafeInteger(frameNumber) ? frameNumber : null,
      finalPoseVerified: true,
      flightCompleteVerified: true,
    });
  };
  const maybeArmPostRender = () => {
    if (!flightComplete || !moveEndSeen || postRenderRemove || finished) return;
    let moveEndMatchesFinalPose = false;
    try {
      moveEndMatchesFinalPose = samePose(moveEndPose, expectedPose) === true;
    } catch (error) {
      fail(error);
      return;
    }
    if (!moveEndMatchesFinalPose) {
      moveEndSeen = false;
      moveEndPose = null;
      return;
    }
    try {
      const remove = scene.postRender.addEventListener(onPostRender);
      postRenderRemove =
        typeof remove === 'function'
          ? remove
          : () => scene.postRender.removeEventListener(onPostRender);
      scene.requestRender();
    } catch (error) {
      fail(error);
    }
  };
  const onMoveEnd = () => {
    try {
      moveEndPose = readPose();
      moveEndSeen = true;
      maybeArmPostRender();
    } catch (error) {
      fail(error);
    }
  };

  timer = setTimeout(
    () => fail(new Error('Camera final-pose sweep did not complete in time.')),
    timeoutMs,
  );
  try {
    const remove = camera.moveEnd.addEventListener(onMoveEnd);
    moveEndRemove =
      typeof remove === 'function'
        ? remove
        : () => camera.moveEnd.removeEventListener(onMoveEnd);
  } catch (error) {
    fail(error);
  }

  return {
    promise,
    markFlightComplete(pose) {
      if (finished) return;
      expectedPose = pose;
      flightComplete = true;
      maybeArmPostRender();
    },
    cancel() {
      if (finished) return;
      finished = true;
      cleanup();
      resolvePromise({
        status: 'cancelled',
        frameNumber: null,
        finalPoseVerified: false,
        flightCompleteVerified: false,
      });
    },
  };
}
