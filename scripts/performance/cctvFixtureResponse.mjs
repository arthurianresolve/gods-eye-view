/** Return the deterministic CCTV fixture response for an intercepted request. */
export function captureCctvFixtureResponse(fixture, url, baseOrigin) {
  if (!baseOrigin || url.origin !== baseOrigin || url.hash) return null;
  if (url.pathname === '/api/cctv/sources' && !url.search)
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sources: fixture.sources }),
    };
  if (url.pathname === '/api/cctv/health' && !url.search)
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cameras: fixture.health }),
    };
  if (
    url.pathname === `/api/cctv/frame/${encodeURIComponent(fixture.cameraId)}`
  )
    return {
      status: 200,
      contentType: 'image/png',
      headers: { 'cache-control': 'no-store' },
      body: Buffer.from(fixture.framePngBase64, 'base64'),
    };
  return null;
}
