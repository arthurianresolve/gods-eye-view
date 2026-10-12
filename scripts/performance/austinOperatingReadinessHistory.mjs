const MAX_SELECTED_LAYERS = 8;
const MAX_HISTORY_ENTRIES = 16;
const MAX_TEXT = 160;

function safeText(value, maximum = MAX_TEXT) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(
      /\b(authorization|bearer|token|api[_-]?key|password|secret)\b\s*[:=]?\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .slice(0, maximum);
}

function safeCompactText(value, maximum) {
  return safeText(value, maximum).replace(/[^\x20-\x7e]/g, '?');
}

function safeErrorName(error) {
  const name = String(error?.name || 'Error');
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(name) ? name : 'Error';
}

function finiteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function finiteHostTime(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function projectSnapshot(value, selectedLayerIds) {
  if (
    value?.schema !== 'gev-austin-readiness-failure/v1' ||
    value.selectedLayerCount !== selectedLayerIds.length ||
    !Array.isArray(value.layers) ||
    value.layers.length !== selectedLayerIds.length
  )
    return null;
  const layers = [];
  for (let index = 0; index < selectedLayerIds.length; index += 1) {
    const row = value.layers[index];
    if (row?.id !== selectedLayerIds[index]) return null;
    const ownership = row.ownership;
    layers.push({
      id: selectedLayerIds[index],
      enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
      count: finiteCount(row.count),
      loading: typeof row.loading === 'boolean' ? row.loading : null,
      loadingLoaded: finiteCount(row.loadingLoaded),
      loadingTotal: finiteCount(row.loadingTotal),
      ownership:
        ownership && typeof ownership === 'object'
          ? {
              timers: finiteCount(ownership.timers),
              pendingJobs: finiteCount(ownership.pendingJobs),
              primitives: finiteCount(ownership.primitives),
              dataSources: finiteCount(ownership.dataSources),
            }
          : null,
      status: typeof row.status === 'string' ? safeText(row.status, 80) : null,
      error: row.error == null ? null : safeText(row.error),
    });
  }
  return {
    schema: 'gev-austin-readiness-failure/v1',
    selectedLayerCount: selectedLayerIds.length,
    layers,
  };
}

export function encodeAustinOperatingReadinessSnapshot(snapshot) {
  if (
    snapshot?.schema !== 'gev-austin-readiness-failure/v1' ||
    !Array.isArray(snapshot.layers) ||
    snapshot.layers.length !== snapshot.selectedLayerCount ||
    snapshot.layers.length > MAX_SELECTED_LAYERS
  )
    return null;
  const layers = snapshot.layers.map((layer) => [
    safeCompactText(layer.id, 32),
    typeof layer.enabled === 'boolean' ? layer.enabled : null,
    finiteCount(layer.count),
    typeof layer.loading === 'boolean' ? layer.loading : null,
    finiteCount(layer.loadingLoaded),
    finiteCount(layer.loadingTotal),
    typeof layer.status === 'string' ? safeCompactText(layer.status, 16) : null,
    layer.error == null ? null : safeCompactText(layer.error, 16),
    finiteCount(layer.ownership?.timers),
    finiteCount(layer.ownership?.pendingJobs),
    finiteCount(layer.ownership?.primitives),
    finiteCount(layer.ownership?.dataSources),
  ]);
  const encoded = JSON.stringify({
    schema: snapshot.schema,
    selectedLayerCount: snapshot.selectedLayerCount,
    layers,
  });
  return Buffer.byteLength(encoded, 'utf8') <= 1024 ? encoded : null;
}

function validateIdentity(documentRole, documentId, phase) {
  if (!/^[a-z0-9-]{1,48}$/i.test(documentRole || ''))
    throw new TypeError('Readiness history document role is invalid.');
  if (!/^[a-z0-9._:-]{1,96}$/i.test(documentId || ''))
    throw new TypeError('Readiness history document ID is invalid.');
  if (!/^[a-z0-9-]{1,64}$/i.test(phase || ''))
    throw new TypeError('Readiness history phase is invalid.');
}

/**
 * Start an opt-in, read-only Runtime.evaluate sampler for setup readiness.
 * It never installs page globals and retains at most 16 projected observations.
 */
export function createAustinOperatingReadinessHistory(
  page,
  {
    observerSource,
    selectedLayerIds,
    documentRole,
    documentId,
    phase = 'source-readiness-wait',
    disconnectedEvent,
    now = () => performance.now(),
    timers = globalThis,
    intervalMs = 1000,
    attachTimeoutMs = 1000,
    commandTimeoutMs = 1500,
    detachTimeoutMs = 250,
  } = {},
) {
  validateIdentity(documentRole, documentId, phase);
  if (
    typeof observerSource !== 'string' ||
    observerSource.length < 40 ||
    observerSource.length > 20_000
  )
    throw new TypeError('Readiness history observer source is invalid.');
  if (
    !Array.isArray(selectedLayerIds) ||
    selectedLayerIds.length < 1 ||
    selectedLayerIds.length > MAX_SELECTED_LAYERS ||
    selectedLayerIds.some(
      (id) => typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id),
    )
  )
    throw new TypeError('Readiness history layer selection is invalid.');
  if (
    intervalMs !== 1000 ||
    !Number.isSafeInteger(attachTimeoutMs) ||
    attachTimeoutMs < 1 ||
    attachTimeoutMs > 1000 ||
    !Number.isSafeInteger(commandTimeoutMs) ||
    commandTimeoutMs < 1 ||
    commandTimeoutMs > 2000 ||
    !Number.isSafeInteger(detachTimeoutMs) ||
    detachTimeoutMs < 1 ||
    detachTimeoutMs > 500
  )
    throw new RangeError('Readiness history bounds are invalid.');

  const ids = [...selectedLayerIds];
  const expression = `(${observerSource})(${JSON.stringify(ids)})`;
  const entries = [];
  let omittedCount = 0;
  let status = 'starting';
  let stopReason = null;
  let session = null;
  let attachTimer = null;
  let pollTimer = null;
  let commandTimer = null;
  let pendingRequest = null;
  let nextSequence = 1;
  let detachPromise = null;
  let detachedStatus = 'not-requested';
  let disconnected = false;
  let stopped = false;
  let listenerRemovalStatus = 'not-requested';
  let attachPromise = null;
  let lateAttachCleanupStatus = 'not-applicable';
  let disconnectEvent = disconnectedEvent ?? 'disconnected';

  const clearTimer = (field, clearFn) => {
    if (field !== null) clearFn.call(timers, field);
  };
  const append = (record) => {
    if (entries.length >= MAX_HISTORY_ENTRIES) {
      entries.shift();
      omittedCount += 1;
    }
    entries.push({
      sequence: nextSequence++,
      documentRole,
      documentId,
      phase,
      ...record,
    });
  };
  const clearPolling = () => {
    clearTimer(pollTimer, timers.clearInterval);
    pollTimer = null;
    clearTimer(commandTimer, timers.clearTimeout);
    commandTimer = null;
  };
  const removeDisconnectListener = () => {
    if (!session || listenerRemovalStatus !== 'not-requested') return;
    try {
      if (typeof session.off === 'function') {
        session.off(disconnectEvent, onDisconnected);
        listenerRemovalStatus = 'confirmed';
      } else if (typeof session.removeListener === 'function') {
        session.removeListener(disconnectEvent, onDisconnected);
        listenerRemovalStatus = 'confirmed';
      } else {
        listenerRemovalStatus = 'unsupported';
      }
    } catch {
      listenerRemovalStatus = 'failed';
    }
  };
  const boundedDetach = (ownedSession) => {
    if (detachedStatus !== 'not-requested') return detachPromise;
    detachedStatus = 'pending';
    const operation = Promise.resolve()
      .then(() => ownedSession.detach())
      .then(
        () => {
          detachedStatus = 'confirmed';
          return 'confirmed';
        },
        () => {
          detachedStatus = 'failed';
          return 'failed';
        },
      );
    let timeout;
    detachPromise = Promise.race([
      operation,
      new Promise((resolve) => {
        timeout = timers.setTimeout(() => {
          if (detachedStatus === 'pending') detachedStatus = 'timeout';
          resolve('timeout');
        }, detachTimeoutMs);
      }),
    ]).then((outcome) => {
      clearTimer(timeout, timers.clearTimeout);
      return outcome;
    });
    return detachPromise;
  };
  const onDisconnected = () => {
    if (disconnected) return;
    disconnected = true;
    stopped = true;
    pendingRequest = null;
    clearPolling();
    if (detachedStatus === 'pending' || detachedStatus === 'not-requested')
      detachedStatus = 'confirmed-disconnected';
    removeDisconnectListener();
    stopReason ||= 'session-disconnected';
    status = 'disconnected';
    append({
      status: 'disconnected',
      hostStartedAtMs: null,
      hostCompletedAtMs: finiteHostTime(now()),
      errorKind: null,
      snapshot: null,
    });
  };
  const stopSampling = (nextStatus) => {
    stopped = true;
    status = nextStatus;
    stopReason ||= nextStatus;
    clearPolling();
    pendingRequest = null;
    clearTimer(attachTimer, timers.clearTimeout);
    attachTimer = null;
    removeDisconnectListener();
    if (session && !disconnected) void boundedDetach(session);
  };
  const sample = () => {
    if (stopped || status !== 'recording' || !session || pendingRequest) return;
    const startedAt = now();
    const request = Promise.resolve().then(() =>
      session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: false,
        silent: true,
      }),
    );
    pendingRequest = request;
    commandTimer = timers.setTimeout(() => {
      if (pendingRequest !== request || stopped) return;
      pendingRequest = null;
      append({
        status: 'command-timeout',
        hostStartedAtMs: finiteHostTime(startedAt),
        hostCompletedAtMs: finiteHostTime(now()),
        errorKind: 'runtime-evaluate-timeout',
        snapshot: null,
      });
      stopSampling('stalled');
    }, commandTimeoutMs);
    request.then(
      (response) => {
        if (pendingRequest !== request) return;
        pendingRequest = null;
        clearTimer(commandTimer, timers.clearTimeout);
        commandTimer = null;
        if (stopped) return;
        if (response?.exceptionDetails) {
          append({
            status: 'evaluation-failed',
            hostStartedAtMs: finiteHostTime(startedAt),
            hostCompletedAtMs: finiteHostTime(now()),
            errorKind: 'runtime-evaluation-exception',
            snapshot: null,
          });
          stopSampling('failed');
          return;
        }
        const snapshot = projectSnapshot(response?.result?.value, ids);
        if (!snapshot) {
          append({
            status: 'invalid-snapshot',
            hostStartedAtMs: finiteHostTime(startedAt),
            hostCompletedAtMs: finiteHostTime(now()),
            errorKind: 'unexpected-readiness-shape',
            snapshot: null,
          });
          stopSampling('failed');
          return;
        }
        append({
          status: 'observed',
          hostStartedAtMs: finiteHostTime(startedAt),
          hostCompletedAtMs: finiteHostTime(now()),
          errorKind: null,
          snapshot,
        });
      },
      (error) => {
        if (pendingRequest !== request) return;
        pendingRequest = null;
        clearTimer(commandTimer, timers.clearTimeout);
        commandTimer = null;
        if (stopped) return;
        append({
          status: 'evaluation-failed',
          hostStartedAtMs: finiteHostTime(startedAt),
          hostCompletedAtMs: finiteHostTime(now()),
          errorKind: safeErrorName(error),
          snapshot: null,
        });
        stopSampling('failed');
      },
    );
  };

  const start = () => {
    if (status !== 'starting') return;
    status = 'attaching';
    attachTimer = timers.setTimeout(() => {
      if (status !== 'attaching') return;
      append({
        status: 'session-timeout',
        hostStartedAtMs: null,
        hostCompletedAtMs: now(),
        errorKind: 'cdp-session-create-timeout',
        snapshot: null,
      });
      stopSampling('unavailable');
    }, attachTimeoutMs);
    attachPromise = Promise.resolve()
      .then(() => page.createCDPSession())
      .then(
        (createdSession) => {
          if (status !== 'attaching' || stopped) {
            session = createdSession;
            lateAttachCleanupStatus = 'pending';
            return boundedDetach(createdSession).then((result) => {
              lateAttachCleanupStatus = result;
            });
          }
          clearTimer(attachTimer, timers.clearTimeout);
          attachTimer = null;
          session = createdSession;
          try {
            session.on(disconnectEvent, onDisconnected);
          } catch {
            append({
              status: 'session-listener-failed',
              hostStartedAtMs: null,
              hostCompletedAtMs: finiteHostTime(now()),
              errorKind: 'cdp-listener-registration-failed',
              snapshot: null,
            });
            stopSampling('failed');
            return;
          }
          status = 'recording';
          sample();
          pollTimer = timers.setInterval(sample, intervalMs);
        },
        (error) => {
          if (status !== 'attaching') return;
          clearTimer(attachTimer, timers.clearTimeout);
          attachTimer = null;
          append({
            status: 'session-create-failed',
            hostStartedAtMs: null,
            hostCompletedAtMs: finiteHostTime(now()),
            errorKind: safeErrorName(error),
            snapshot: null,
          });
          stopSampling('unavailable');
        },
      );
  };

  const snapshot = () => ({
    schema: 'gev-austin-operating-readiness-history/v1',
    documentRole,
    documentId,
    phase,
    status,
    stopReason,
    intervalMs,
    entryLimit: MAX_HISTORY_ENTRIES,
    commandTimeoutMs,
    attachTimeoutMs,
    omittedCount,
    samples: entries.map((entry) => structuredClone(entry)),
    session: {
      creationStatus: disconnected
        ? 'disconnected'
        : session
          ? 'created'
          : status === 'unavailable'
            ? 'unavailable'
            : 'pending-or-not-created',
      detachStatus: disconnected ? 'confirmed-disconnected' : detachedStatus,
      disconnectListenerRemoval: listenerRemovalStatus,
      lateAttachCleanupStatus,
    },
  });

  const stop = async (reason) => {
    if (!stopped) {
      stopReason = safeText(reason, 64) || 'stopped';
      const finalStatus =
        status === 'recording' || status === 'attaching' ? 'stopped' : status;
      stopSampling(finalStatus);
    }
    if (attachPromise && !session && !disconnected) {
      let timeout;
      await Promise.race([
        attachPromise,
        new Promise((resolve) => {
          timeout = timers.setTimeout(resolve, attachTimeoutMs);
        }),
      ]);
      clearTimer(timeout, timers.clearTimeout);
    }
    if (session && !disconnected)
      await boundedDetach(session).catch(() => 'failed');
    return snapshot();
  };

  start();
  return { stop, snapshot };
}

/** Preserve the supplied readiness predicate/options while owning sampler cleanup. */
export async function waitForAustinOperatingReadiness(
  waitForReadiness,
  historyObserver = null,
) {
  if (typeof waitForReadiness !== 'function')
    throw new TypeError('Austin readiness wait callback is required.');
  let value = null;
  let error = null;
  try {
    value = await waitForReadiness();
  } catch (caught) {
    error = caught;
  }
  const history = historyObserver
    ? await historyObserver.stop(error ? 'readiness-wait-failed' : 'ready')
    : null;
  return { status: error ? 'failed' : 'ready', value, error, history };
}
