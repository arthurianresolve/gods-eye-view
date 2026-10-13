/** Resolve paused requests directly, without pairing Fetch and Network events. */
export const MAX_FIXTURE_INTERCEPTION_ERRORS = 8;
const ERROR_PHASES = new Set([
  'before-continue',
  'request-command',
  'command-send',
  'fulfillment-callback',
]);
const LIFECYCLE_STAGES = new Set(['active', 'releasing', 'released']);

export function createFixtureInterceptionErrorRecorder({ limit = 8 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 8)
    throw new RangeError('Fixture interception error limit must be 0–8.');
  const records = [];
  const onError = (error, context = {}) => {
    if (records.length >= limit) return;
    const phase = ERROR_PHASES.has(context.phase) ? context.phase : 'unknown';
    const lifecycleStage = LIFECYCLE_STAGES.has(context.lifecycleStage)
      ? context.lifecycleStage
      : 'unknown';
    const documentRole = /^[a-z0-9-]{1,48}$/i.test(context.documentRole || '')
      ? context.documentRole
      : null;
    const documentId = /^[a-z0-9._:-]{1,96}$/i.test(context.documentId || '')
      ? context.documentId
      : null;
    const message = String(error?.message || 'Fixture interception failed')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
      .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[path]')
      .replace(/(?<![\w.])\/(?:[^\s"'<>]+\/)*[^\s"'<>]*/g, '[path]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [redacted]')
      .replace(
        /\b(token|password|secret|authorization)\b["']?\s*[:=]\s*["']?[^"'&\s,;}\]]+/gi,
        '$1=[redacted]',
      )
      .slice(0, 240);
    records.push({
      message,
      phase,
      documentRole,
      documentId,
      sessionOrdinal:
        Number.isSafeInteger(context.sessionOrdinal) &&
        context.sessionOrdinal > 0
          ? context.sessionOrdinal
          : null,
      lifecycleStage,
    });
  };
  return { records, onError };
}

export async function fixtureRequestCommand(event, base, respond) {
  const { requestId, request } = event;
  const url = new URL(request.url);
  let response = await respond?.(url, {
    requestId,
    url: () => request.url,
    postData: () => request.postData,
    method: () => request.method,
    resourceType: () => event.resourceType ?? null,
    signal: event.signal,
  });
  if (
    !response &&
    ['http:', 'https:'].includes(url.protocol) &&
    url.origin !== new URL(base).origin
  )
    return ['Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }];
  if (!response && url.pathname.startsWith('/api/'))
    response = {
      status: 503,
      contentType: 'application/json',
      body: '{"error":"fixture-offline"}',
    };
  if (!response) return ['Fetch.continueRequest', { requestId }];
  return [
    'Fetch.fulfillRequest',
    {
      requestId,
      responseCode: response.status ?? 200,
      responseHeaders: Object.entries({
        ...(response.contentType
          ? { 'content-type': response.contentType }
          : {}),
        ...response.headers,
      }).map(([name, value]) => ({ name, value: String(value) })),
      body: Buffer.from(response.body ?? '').toString('base64'),
    },
  ];
}

export async function closeTargetBeforeFixtureInterceptionRelease(
  page,
  interception,
) {
  let targetClosed = false;
  let error = null;
  let release = null;
  try {
    if (!page || typeof page.isClosed !== 'function')
      throw new Error('Fixture interception page owner is unavailable.');
    if (!page.isClosed()) await page.close();
    targetClosed = page.isClosed();
    if (!targetClosed)
      throw new Error('Fixture interception page closure was not confirmed.');
  } catch (closeError) {
    error = closeError;
    try {
      targetClosed = page?.isClosed?.() === true;
    } catch {
      targetClosed = false;
    }
  }
  if (targetClosed && interception) {
    try {
      release = await interception.releaseSession({ targetClosed: true });
    } catch (releaseError) {
      error ||= releaseError;
    }
  }
  return {
    targetClosed,
    release,
    error,
    confirmed: targetClosed && !error && release?.confirmed === true,
  };
}

export async function interceptFixtureSession(
  client,
  base,
  respond,
  onError,
  { onFulfilled, getErrorContext, onBeforeContinue } = {},
) {
  let acceptingRequests = true;
  let listenerRemovalConfirmed = false;
  let listenerRemovalVerification = null;
  let listenerRemovalErrorKind = null;
  let unexpectedLateRequestCount = 0;
  let pendingPreparationCount = 0;
  let cancelledPreparationCount = 0;
  let pendingAbortSubscriptions = 0;
  let drainCommandFailures = 0;
  let initialStopCounts = null;
  const pendingHandlers = new Set();
  const pendingCommands = new Set();
  const preparationAbort = new AbortController();
  const reportError = (error, phase) => {
    try {
      onError?.(error, {
        ...(typeof getErrorContext === 'function' ? getErrorContext() : {}),
        phase,
      });
    } catch {
      // Evidence callbacks must not strand or reclassify the intercepted request.
    }
  };
  const sendTracked = async (method, params) => {
    let sent;
    try {
      sent = client.send(method, params);
    } catch (error) {
      drainCommandFailures += 1;
      throw error;
    }
    const operation = Promise.resolve(sent);
    pendingCommands.add(operation);
    try {
      return await operation;
    } catch (error) {
      drainCommandFailures += 1;
      throw error;
    } finally {
      pendingCommands.delete(operation);
    }
  };
  const handlePausedRequest = async (event) => {
    if (!acceptingRequests) {
      unexpectedLateRequestCount += 1;
      reportError(
        new Error('Paused fixture request arrived after interception stopped.'),
        'command-send',
      );
      // This callback may be a stale copied listener. The retired target will
      // cancel its paused request; never send protocol commands after stop.
      return;
    }
    let phase = 'request-command';
    try {
      pendingPreparationCount += 1;
      let requestCommand;
      let removeAbortListener = null;
      try {
        const aborted = new Promise((resolve) => {
          const onAbort = () => resolve(null);
          removeAbortListener = () =>
            preparationAbort.signal.removeEventListener('abort', onAbort);
          pendingAbortSubscriptions += 1;
          if (preparationAbort.signal.aborted) onAbort();
          else
            preparationAbort.signal.addEventListener('abort', onAbort, {
              once: true,
            });
        });
        const prepared = await Promise.race([
          (async () => {
            if (onBeforeContinue) {
              phase = 'before-continue';
              await onBeforeContinue({
                url: event.request.url,
                method: event.request.method,
                postData: event.request.postData ?? null,
                signal: preparationAbort.signal,
              });
            }
            if (preparationAbort.signal.aborted) return null;
            phase = 'request-command';
            return fixtureRequestCommand(
              { ...event, signal: preparationAbort.signal },
              base,
              respond,
            );
          })(),
          aborted,
        ]);
        if (!prepared) {
          cancelledPreparationCount += 1;
          return;
        }
        requestCommand = prepared;
      } finally {
        if (removeAbortListener) {
          removeAbortListener();
          pendingAbortSubscriptions -= 1;
        }
        pendingPreparationCount -= 1;
      }
      if (!acceptingRequests) {
        cancelledPreparationCount += 1;
        return;
      }
      const [method, params] = requestCommand;
      phase = 'command-send';
      await sendTracked(method, params);
      if (method === 'Fetch.fulfillRequest') {
        try {
          phase = 'fulfillment-callback';
          onFulfilled?.({
            requestId: event.requestId,
            url: event.request.url,
            method: event.request.method,
            status: params.responseCode,
            bodyBase64: params.body,
          });
        } catch (error) {
          reportError(error, phase);
        }
      }
    } catch (error) {
      // A broken fixture must not leave a worker fetch permanently suspended.
      if (acceptingRequests)
        await sendTracked('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Failed',
        }).catch(() => {});
      if (
        !/Target closed|Session closed|Invalid InterceptionId|Invalid state|Invalid session/i.test(
          error.message,
        )
      )
        reportError(error, phase);
    }
  };
  const listener = (event) => {
    const operation = handlePausedRequest(event);
    pendingHandlers.add(operation);
    operation.then(
      () => pendingHandlers.delete(operation),
      () => pendingHandlers.delete(operation),
    );
    return operation;
  };
  client.on('Fetch.requestPaused', listener);
  try {
    await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  } catch (error) {
    acceptingRequests = false;
    try {
      if (typeof client.off === 'function')
        client.off('Fetch.requestPaused', listener);
      else client.removeListener?.('Fetch.requestPaused', listener);
    } catch {
      // Preserve the Fetch.enable failure as the primary error.
    }
    throw error;
  }

  const controller = {
    async stopAndDrain() {
      if (acceptingRequests) {
        initialStopCounts = {
          pendingAtStop: pendingHandlers.size,
          pendingPreparationAtStop: pendingPreparationCount,
          pendingAbortSubscriptionsAtStop: pendingAbortSubscriptions,
          pendingCommandsAtStop: pendingCommands.size,
        };
        acceptingRequests = false;
        preparationAbort.abort();
        const removeListener =
          typeof client.off === 'function'
            ? client.off.bind(client)
            : typeof client.removeListener === 'function'
              ? client.removeListener.bind(client)
              : null;
        if (!removeListener) {
          listenerRemovalErrorKind = 'listener-removal-unavailable';
        } else {
          try {
            removeListener('Fetch.requestPaused', listener);
            listenerRemovalConfirmed =
              typeof client.listeners !== 'function' ||
              !client.listeners('Fetch.requestPaused').includes(listener);
            listenerRemovalVerification =
              typeof client.listeners === 'function'
                ? 'event-listener-snapshot'
                : 'remove-listener-call-acknowledged';
            if (!listenerRemovalConfirmed)
              listenerRemovalErrorKind = 'listener-removal-unconfirmed';
          } catch (error) {
            listenerRemovalErrorKind =
              error?.name === 'Error'
                ? 'listener-removal-error'
                : 'listener-removal-failed';
          }
        }
      }

      initialStopCounts ||= {
        pendingAtStop: pendingHandlers.size,
        pendingPreparationAtStop: pendingPreparationCount,
        pendingAbortSubscriptionsAtStop: pendingAbortSubscriptions,
        pendingCommandsAtStop: pendingCommands.size,
      };
      let rejectedDrainOperations = 0;
      while (pendingCommands.size > 0 || pendingHandlers.size > 0) {
        const settled = await Promise.allSettled([
          ...pendingCommands,
          ...pendingHandlers,
        ]);
        for (const result of settled) {
          if (result.status === 'rejected') {
            rejectedDrainOperations += 1;
            reportError(result.reason, 'command-send');
          }
        }
        await Promise.resolve();
      }
      return {
        schema: 'gev-fixture-interception-drain/v1',
        confirmed:
          listenerRemovalConfirmed &&
          pendingCommands.size === 0 &&
          pendingAbortSubscriptions === 0 &&
          rejectedDrainOperations === 0 &&
          drainCommandFailures === 0,
        listenerRemovalConfirmed,
        listenerRemovalVerification,
        listenerRemovalErrorKind,
        ...initialStopCounts,
        pendingCommandsAfterDrain: pendingCommands.size,
        pendingPreparationsAfterDrain: pendingPreparationCount,
        pendingAbortSubscriptionsAfterDrain: pendingAbortSubscriptions,
        rejectedDrainOperations,
        drainCommandFailures,
        cancelledPreparationCount,
        unexpectedLateRequestCount,
      };
    },
    async releaseSession({ targetClosed = false } = {}) {
      const interception = await controller.stopAndDrain();
      let fetchDisable = 'not-attempted';
      let detach = 'not-attempted';
      if (targetClosed) {
        fetchDisable = 'target-closed';
        detach = 'target-closed';
      }
      return {
        schema: 'gev-fixture-interception-release/v1',
        interception,
        fetchDisable,
        detach,
        confirmed:
          interception.confirmed &&
          interception.unexpectedLateRequestCount === 0 &&
          targetClosed,
      };
    },
  };
  return controller;
}
