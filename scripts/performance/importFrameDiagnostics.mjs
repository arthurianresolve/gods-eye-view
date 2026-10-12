export const IMPORT_FRAME_EVENT_LIMIT = 32;
export const IMPORT_FAILURE_RAF_OBSERVATION_MS = 1000;

/** Failure-only CPU event spans; these are not GPU execution timings. */
export function createSceneFrameTimingDiagnostics(
  scene = globalThis.__godsEyeView?.viewer?.scene ?? null,
  {
    now = () => globalThis.performance.now(),
    PerformanceObserverClass = globalThis.PerformanceObserver,
    maxEntries = 32,
    storeAs = null,
  } = {},
) {
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 32 ||
    (storeAs !== null &&
      (typeof storeAs !== 'string' ||
        !/^__gev[A-Za-z0-9_]{1,80}$/.test(storeAs)))
  )
    throw new TypeError('Scene frame diagnostic bounds are invalid.');
  if (!scene)
    throw new TypeError('Scene frame diagnostic scene is unavailable.');
  if (storeAs && Object.hasOwn(globalThis, storeAs))
    throw new Error('Scene frame diagnostic owner key is already occupied.');
  const startedAt = now();
  const spans = { update: [], render: [] };
  const sceneEventAvailability = {
    update:
      typeof scene?.preUpdate?.addEventListener === 'function' &&
      typeof scene?.postUpdate?.addEventListener === 'function',
    render:
      typeof scene?.preRender?.addEventListener === 'function' &&
      typeof scene?.postRender?.addEventListener === 'function',
  };
  const counts = {
    update: sceneEventAvailability.update ? 0 : null,
    render: sceneEventAvailability.render ? 0 : null,
  };
  const starts = { update: null, render: null };
  const removers = [];
  const observers = [];
  const entries = { longtask: null, 'long-animation-frame': null };
  const overflow = { update: false, render: false };
  const observerErrors = [];
  const cleanupErrors = [];
  let result = null;
  let active = true;

  function append(target, value) {
    target.push(value);
    if (target.length > maxEntries) target.shift();
  }
  function add(name, event, listener) {
    if (!event?.addEventListener) return;
    const remove = event.addEventListener(listener);
    removers.push({
      name,
      remove:
        typeof remove === 'function'
          ? remove
          : () => event.removeEventListener?.(listener),
    });
  }
  function releaseListeners() {
    for (const { name, remove } of removers) {
      try {
        remove();
      } catch {
        cleanupErrors.push(`listener:${name}`);
      }
    }
    removers.length = 0;
  }
  function consume(type, records) {
    if (!active) return;
    for (const entry of records) {
      if (!Number.isFinite(entry.startTime) || entry.startTime < startedAt)
        continue;
      if (!Number.isFinite(entry.duration) || entry.duration < 0) continue;
      const row = {
        startMs: entry.startTime - startedAt,
        durationMs: entry.duration,
      };
      if (type === 'long-animation-frame') {
        for (const key of [
          'blockingDuration',
          'renderStart',
          'styleAndLayoutStart',
        ]) {
          row[key] = Number.isFinite(entry[key]) ? entry[key] : null;
        }
        // Retain timing and invocation kind only, never script URLs or names.
        row.scripts = Array.from(entry.scripts || [])
          .slice(0, 8)
          .map((script) => ({
            durationMs: Number.isFinite(script.duration)
              ? script.duration
              : null,
            invokerType: [
              'classic-script',
              'module-script',
              'event-listener',
              'user-callback',
              'resolve-promise',
              'reject-promise',
            ].includes(script.invokerType)
              ? script.invokerType
              : 'unknown',
            forcedStyleAndLayoutDurationMs: Number.isFinite(
              script.forcedStyleAndLayoutDuration,
            )
              ? script.forcedStyleAndLayoutDuration
              : null,
          }));
      }
      append(entries[type], row);
    }
  }

  try {
    for (const [name, before, after] of [
      ['update', 'preUpdate', 'postUpdate'],
      ['render', 'preRender', 'postRender'],
    ]) {
      add(before, scene?.[before], () => {
        if (active) starts[name] = now();
      });
      add(after, scene?.[after], () => {
        if (!active || starts[name] === null) return;
        counts[name]++;
        overflow[name] ||= counts[name] > maxEntries;
        append(spans[name], {
          startMs: starts[name] - startedAt,
          durationMs: Math.max(0, now() - starts[name]),
        });
        starts[name] = null;
      });
    }
    for (const type of Object.keys(entries)) {
      if (!PerformanceObserverClass?.supportedEntryTypes?.includes(type))
        continue;
      let observer;
      try {
        observer = new PerformanceObserverClass((list) =>
          consume(type, list.getEntries()),
        );
        entries[type] = [];
        observer.observe({ type, buffered: false });
        observers.push({ type, observer });
      } catch {
        try {
          observer?.disconnect();
        } catch {
          cleanupErrors.push(`observer:${type}`);
        }
        entries[type] = null;
        observerErrors.push(type);
      }
    }
  } catch (error) {
    active = false;
    for (const { type, observer } of observers) {
      try {
        observer.disconnect();
      } catch {
        cleanupErrors.push(`observer:${type}`);
      }
    }
    releaseListeners();
    throw new Error(
      'Could not install bounded scene frame timing diagnostics.',
      { cause: error },
    );
  }

  const controller = {
    stop() {
      if (result) return result;
      for (const { type, observer } of observers) {
        try {
          consume(type, observer.takeRecords());
        } catch {
          observerErrors.push(type);
        } finally {
          try {
            observer.disconnect();
          } catch {
            cleanupErrors.push(`observer:${type}`);
          }
        }
      }
      active = false;
      releaseListeners();
      result = {
        scope:
          'Failure follow-up only; wall-clock CPU event spans include stalls, not GPU execution timing',
        originPerformanceNowMs: Number.isFinite(startedAt) ? startedAt : null,
        elapsedMs: Math.max(0, now() - startedAt),
        sceneEventAvailability,
        counts,
        spans,
        overflow,
        entries,
        observerErrors,
        cleanupErrors,
        cleanupComplete: cleanupErrors.length === 0,
      };
      return result;
    },
  };
  if (storeAs) {
    globalThis[storeAs] = controller;
    return {
      status: 'installed',
      originPerformanceNowMs: Number.isFinite(startedAt) ? startedAt : null,
    };
  }
  return controller;
}

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
