export const IMPORT_FRAME_EVENT_LIMIT = 32;
export const IMPORT_FAILURE_RAF_OBSERVATION_MS = 1000;

const LIFECYCLE_EVENTS = [
  ['window', 'focus'],
  ['window', 'blur'],
  ['window', 'pagehide'],
  ['window', 'pageshow'],
  ['document', 'visibilitychange'],
  ['document', 'freeze'],
  ['document', 'resume'],
];

/** Opt-in, bounded browser state recorder for the isolated import fixture. */
export function createImportFrameDiagnostics({
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const startedAt = now();
  const events = [];
  let active = true;

  const record = (type) => {
    if (!active) return;
    events.push({
      tMs: Math.max(0, now() - startedAt),
      type,
      visible: documentTarget?.visibilityState ?? null,
      focused: documentTarget?.hasFocus?.() ?? null,
    });
    if (events.length > IMPORT_FRAME_EVENT_LIMIT) events.shift();
  };

  const listeners = [];
  for (const [targetName, type] of LIFECYCLE_EVENTS) {
    const target = targetName === 'window' ? windowTarget : documentTarget;
    if (!target?.addEventListener || !target?.removeEventListener) continue;
    const listener = () => record(type);
    target.addEventListener(type, listener);
    listeners.push({ target, type, listener });
  }

  const snapshotCanvas = (canvas) => {
    const rect = canvas?.getBoundingClientRect?.();
    const width = Number(windowTarget?.innerWidth);
    const height = Number(windowTarget?.innerHeight);
    const validRect =
      rect &&
      [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite);
    const intersection = validRect
      ? {
          left: Math.max(0, rect.left),
          top: Math.max(0, rect.top),
          right: Math.min(width, rect.right),
          bottom: Math.min(height, rect.bottom),
        }
      : null;
    if (intersection) {
      intersection.width = Math.max(0, intersection.right - intersection.left);
      intersection.height = Math.max(0, intersection.bottom - intersection.top);
      intersection.area = intersection.width * intersection.height;
    }
    const rectArea = validRect
      ? Math.max(0, rect.right - rect.left) *
        Math.max(0, rect.bottom - rect.top)
      : 0;
    const viewport = {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      visualWidth: Number.isFinite(windowTarget?.visualViewport?.width)
        ? windowTarget.visualViewport.width
        : null,
      visualHeight: Number.isFinite(windowTarget?.visualViewport?.height)
        ? windowTarget.visualViewport.height
        : null,
      visualOffsetLeft: Number.isFinite(
        windowTarget?.visualViewport?.offsetLeft,
      )
        ? windowTarget.visualViewport.offsetLeft
        : null,
      visualOffsetTop: Number.isFinite(windowTarget?.visualViewport?.offsetTop)
        ? windowTarget.visualViewport.offsetTop
        : null,
    };
    return {
      visible: documentTarget?.visibilityState ?? null,
      focused: documentTarget?.hasFocus?.() ?? null,
      viewport,
      canvasRect: validRect
        ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null,
      canvasViewportIntersection: intersection,
      canvasViewportIntersectionRatio:
        rectArea > 0 && intersection ? intersection.area / rectArea : null,
    };
  };

  return Object.freeze({
    snapshotCanvas,
    events: () => events.map((event) => ({ ...event })),
    dispose() {
      if (!active) return;
      active = false;
      for (const { target, type, listener } of listeners)
        target.removeEventListener(type, listener);
      listeners.length = 0;
    },
  });
}

/** Observe browser RAF/timer delivery while a failed fixture viewer stays alive. */
export function observeImportFrameHealth({
  durationMs = IMPORT_FAILURE_RAF_OBSERVATION_MS,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
  const duration = Number.isFinite(durationMs)
    ? Math.min(1500, Math.max(1, durationMs))
    : IMPORT_FAILURE_RAF_OBSERVATION_MS;
  if (
    typeof requestFrame !== 'function' ||
    typeof cancelFrame !== 'function' ||
    typeof setIntervalFn !== 'function' ||
    typeof clearIntervalFn !== 'function' ||
    typeof setTimeoutFn !== 'function' ||
    typeof clearTimeoutFn !== 'function'
  )
    return Promise.resolve({ status: 'unavailable' });

  return new Promise((resolve) => {
    const startedAt = now();
    let previousFrameAt = null;
    let previousTimerAt = startedAt;
    let firstFrameDelayMs = null;
    let firstTimerDelayMs = null;
    let frames = 0;
    let timerTicks = 0;
    let maximumFrameGapMs = null;
    let maximumTimerGapMs = null;
    let frameId = null;
    let intervalId = null;
    let timeoutId = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (frameId !== null) cancelFrame(frameId);
      if (intervalId !== null) clearIntervalFn(intervalId);
      if (timeoutId !== null) clearTimeoutFn(timeoutId);
      const endedAt = now();
      const trailingFrameGapMs =
        previousFrameAt === null
          ? null
          : Math.max(0, endedAt - previousFrameAt);
      const trailingTimerGapMs =
        timerTicks === 0 ? null : Math.max(0, endedAt - previousTimerAt);
      resolve({
        status: 'observed',
        elapsedMs: Math.max(0, endedAt - startedAt),
        frames,
        firstFrameDelayMs,
        trailingFrameGapMs,
        timerTicks,
        firstTimerDelayMs,
        maximumFrameGapMs: frames < 2 ? null : maximumFrameGapMs,
        maximumTimerGapMs: timerTicks < 2 ? null : maximumTimerGapMs,
        trailingTimerGapMs,
      });
    };

    const tick = () => {
      if (finished) return;
      const current = now();
      if (firstFrameDelayMs === null)
        firstFrameDelayMs = Math.max(0, current - startedAt);
      if (previousFrameAt !== null) {
        const frameGap = current - previousFrameAt;
        maximumFrameGapMs = Math.max(maximumFrameGapMs ?? 0, frameGap);
      }
      previousFrameAt = current;
      frames++;
      frameId = requestFrame(tick);
    };

    try {
      frameId = requestFrame(tick);
      intervalId = setIntervalFn(() => {
        if (finished) return;
        const current = now();
        if (firstTimerDelayMs === null)
          firstTimerDelayMs = Math.max(0, current - startedAt);
        const timerGap = current - previousTimerAt;
        maximumTimerGapMs = Math.max(maximumTimerGapMs ?? 0, timerGap);
        previousTimerAt = current;
        timerTicks++;
      }, 20);
      timeoutId = setTimeoutFn(finish, duration);
    } catch {
      finish();
    }
  });
}
