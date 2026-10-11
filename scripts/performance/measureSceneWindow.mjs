/** Self-contained page measurement; final-frame settling is outside the timed window. */
export async function measureSceneWindow({ durationMs, scenarioName, delay }) {
  const viewer = window.__godsEyeView.viewer;
  const scene = viewer.scene;
  const stagedClock = window.__gevPhasedMonotonicWallClockV1;
  let foregroundThroughout = document.hasFocus() && !document.hidden;
  const onBackground = () => {
    foregroundThroughout = false;
  };
  const onVisibility = () => {
    if (document.hidden) onBackground();
  };
  window.addEventListener('blur', onBackground);
  document.addEventListener('visibilitychange', onVisibility);
  const intervals = [];
  const longTasks = [];
  let previous = null;
  let renderedFrameCount = 0;
  let collecting = true;
  const onRender = () => {
    if (!collecting) return;
    renderedFrameCount += 1;
    const now = performance.now();
    if (previous != null) intervals.push(now - previous);
    previous = now;
  };
  scene.postRender.addEventListener(onRender);
  let observer = null;
  if (
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes == null ||
      PerformanceObserver.supportedEntryTypes.includes('longtask'))
  ) {
    try {
      observer = new PerformanceObserver((list) => {
        if (!collecting) return;
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      observer = null;
    }
  }
  let active = true;
  let motionStartedAt = null;
  let motionDistance = 0;
  let measurementTimer = null;
  let rejectMeasurement = () => {};
  let motionFrame = null;
  let delayTimer = null;
  let motionFinished = Promise.resolve();
  let finishMotion = () => {};
  try {
    if (stagedClock) stagedClock.startMeasurement();
    const startedAt = performance.now();
    const measurementWait = new Promise((resolve, reject) => {
      rejectMeasurement = reject;
      measurementTimer = setTimeout(resolve, durationMs);
    });
    if (scenarioName === 'scripted-motion') {
      // Rebuild the pose from one elapsed-time sample on every frame.
      // A timer-step route accumulates missed callbacks and makes a slow
      // machine travel a different distance from a fast one.
      const home = window.__gevPerformanceHome;
      const applyDistance = (distance) => {
        viewer.camera.setView({
          destination: home.position,
          orientation: { direction: home.direction, up: home.up },
          endTransform: home.transform,
        });
        viewer.camera.moveRight(distance);
        motionDistance = distance;
      };
      finishMotion = () => applyDistance((durationMs * 16) / 50);
      motionStartedAt = performance.now();
      motionFinished = new Promise((resolve) => {
        const move = () => {
          motionFrame = null;
          try {
            if (!active) {
              resolve();
              return;
            }
            const elapsed = Math.min(
              durationMs,
              Math.max(0, performance.now() - motionStartedAt),
            );
            const distance = (elapsed * 16) / 50;
            applyDistance(distance);
            if (elapsed >= durationMs) {
              resolve();
              return;
            }
            motionFrame = requestAnimationFrame(move);
          } catch (error) {
            active = false;
            rejectMeasurement(error);
            resolve();
          }
        };
        move();
      });
    }
    if (delay > 0) {
      delayTimer = setInterval(() => {
        const start = performance.now();
        while (performance.now() - start < delay) {}
      }, 1000);
    }
    await measurementWait;
    const measurementEndedAt = performance.now();
    const clockEnd = stagedClock?.finishMeasurement?.() ?? null;
    // Close every timing observer before endpoint/final-frame work. A
    // slow final render must not inflate the measured motion window.
    observer
      ?.takeRecords?.()
      .forEach((entry) => longTasks.push(entry.duration));
    collecting = false;
    observer?.disconnect();
    scene.postRender.removeEventListener(onRender);
    active = false;
    await motionFinished;
    clearInterval(delayTimer);
    // Slow frames must still reach the same absolute route endpoint.
    finishMotion();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const renderCount = intervals.length;
    const sorted = [...intervals].sort((a, b) => a - b);
    const pick = (p) =>
      sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
        : null;
    const memory = performance.memory
      ? { usedJsHeapBytes: performance.memory.usedJSHeapSize }
      : {
          usedJsHeapBytes: null,
          reason: 'performance.memory is unavailable in this browser',
        };
    window.removeEventListener('blur', onBackground);
    document.removeEventListener('visibilitychange', onVisibility);
    return {
      durationMs: measurementEndedAt - startedAt,
      measurementWindow: {
        schema: 'gev-scene-measurement-window/v1',
        requestedDurationMs: durationMs,
        startedAtMs: startedAt,
        endedAtMs: measurementEndedAt,
        elapsedMs: measurementEndedAt - startedAt,
        settlingElapsedMs: performance.now() - measurementEndedAt,
        includesSettlingFrames: false,
      },
      renderedFrameCount,
      frameCount: renderCount,
      frameIntervalMs: {
        p50: pick(0.5),
        p95: pick(0.95),
        max: sorted.at(-1) ?? null,
        samples: sorted.length,
        reason: sorted.length
          ? null
          : 'no scene postRender samples in this window',
      },
      longTasks: {
        count: observer ? longTasks.length : null,
        maxMs: longTasks.length ? Math.max(...longTasks) : null,
        reason: observer ? null : 'longtask PerformanceObserver is unavailable',
      },
      memory,
      layers: [],
      totalObjects: null,
      focused: document.hasFocus(),
      visible: !document.hidden,
      trackedAircraftId: viewer.trackedEntity?.gevTrackedId || null,
      injectedDelayMs: delay || 0,
      quality: null,
      detection: {
        mode: null,
        reason:
          'Candidate-only detection diagnostics are disabled for comparable capture.',
      },
      performanceSnapshot: null,
      performanceSnapshotReason:
        'Candidate-only runtime snapshots are disabled for comparable capture.',
      foregroundThroughout,
      cameraPath: {
        id:
          scenarioName === 'scripted-motion'
            ? 'elapsed-move-right-v1'
            : 'parked-v1',
        motionDistancePx: motionDistance,
        motionDistanceM: motionDistance,
      },
      phasedClockEnd: clockEnd,
    };
  } finally {
    collecting = false;
    active = false;
    clearTimeout(measurementTimer);
    if (motionFrame !== null) cancelAnimationFrame(motionFrame);
    clearInterval(delayTimer);
    observer?.disconnect();
    scene.postRender.removeEventListener(onRender);
    window.removeEventListener('blur', onBackground);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

/** Reject missing timing boundaries and accidental inclusion of final-frame work. */
export function assertSceneMeasurementWindow(sample, requestedDurationMs) {
  const value = sample?.measurementWindow;
  if (
    value?.schema !== 'gev-scene-measurement-window/v1' ||
    value.includesSettlingFrames !== false ||
    value.requestedDurationMs !== requestedDurationMs ||
    !Number.isFinite(requestedDurationMs) ||
    requestedDurationMs <= 0 ||
    ![
      value.startedAtMs,
      value.endedAtMs,
      value.elapsedMs,
      value.settlingElapsedMs,
      sample.durationMs,
    ].every(Number.isFinite) ||
    value.startedAtMs < 0 ||
    value.elapsedMs < requestedDurationMs ||
    value.settlingElapsedMs < 0 ||
    sample.durationMs !== value.elapsedMs ||
    Math.abs(value.endedAtMs - value.startedAtMs - value.elapsedMs) > 0.000001
  ) {
    throw new TypeError(
      'Invalid or missing isolated scene measurement window.',
    );
  }
  return true;
}
