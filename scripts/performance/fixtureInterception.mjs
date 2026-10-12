/** Resolve paused requests directly, without pairing Fetch and Network events. */
export const MAX_FIXTURE_INTERCEPTION_ERRORS = 8;
const ERROR_PHASES = new Set([
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
    url: () => request.url,
    postData: () => request.postData,
    method: () => request.method,
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

export async function interceptFixtureSession(
  client,
  base,
  respond,
  onError,
  { onFulfilled, getErrorContext } = {},
) {
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
  client.on('Fetch.requestPaused', async (event) => {
    let phase = 'request-command';
    try {
      const [method, params] = await fixtureRequestCommand(
        event,
        base,
        respond,
      );
      phase = 'command-send';
      await client.send(method, params);
      if (method === 'Fetch.fulfillRequest') {
        try {
          phase = 'fulfillment-callback';
          onFulfilled?.({
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
      await client
        .send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Failed',
        })
        .catch(() => {});
      if (
        !/Target closed|Session closed|Invalid InterceptionId|Invalid state|Invalid session/i.test(
          error.message,
        )
      )
        reportError(error, phase);
    }
  });
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
}
