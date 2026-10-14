self.onmessage = (event) => {
  const request = event?.data;
  if (
    request?.type !== 'parse-geojson-json' ||
    request.requestId !== 1 ||
    typeof request.text !== 'string'
  )
    return;

  try {
    self.postMessage({
      type: 'geojson-json-result',
      requestId: request.requestId,
      ok: true,
      value: JSON.parse(request.text),
    });
  } catch {
    self.postMessage({
      type: 'geojson-json-result',
      requestId: request.requestId,
      ok: false,
      code: 'invalid-json',
    });
  }
};
