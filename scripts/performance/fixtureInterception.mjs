/** Resolve paused requests directly, without pairing Fetch and Network events. */
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
  { onFulfilled } = {},
) {
  let active = true;
  const onPaused = async (event) => {
    if (!active) return;
    let command = null;
    try {
      const [method, params] = await fixtureRequestCommand(
        event,
        base,
        respond,
      );
      if (!active) return;
      command = method;
      await client.send(method, params);
      if (!active) return;
      if (method === 'Fetch.fulfillRequest') {
        try {
          onFulfilled?.({
            url: event.request.url,
            method: event.request.method,
            status: params.responseCode,
            bodyBase64: params.body,
          });
        } catch (error) {
          onError?.(error, { command, stage: 'delivery-observer' });
        }
      }
    } catch (error) {
      // The owner releases this observer before disabling Fetch. Work already
      // queued for that discarded document must not publish into a new one.
      if (!active) return;
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
        onError?.(error, { command, stage: 'request-resolution' });
    }
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    client.off?.('Fetch.requestPaused', onPaused);
  };
  client.on('Fetch.requestPaused', onPaused);
  try {
    await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
