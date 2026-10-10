const CODE_RESOURCE_TYPES = new Set(['script', 'worker', 'serviceworker']);
const CODE_PATH = /\.(?:m?js)$/i;

/** Audit observed code request paths against the local build receipt. */
export function auditReceiptedCodeRequests({ requests, baseUrl, assets } = {}) {
  if (!Array.isArray(requests))
    throw new TypeError('Code requests are required.');
  if (!Array.isArray(assets) || assets.length === 0)
    throw new TypeError('Receipt assets are required.');
  const base = new URL(baseUrl);
  const prefix = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  const expected = new Set(assets.map((asset) => asset.path));
  const observed = new Set();
  let externalCodeRequests = 0;

  for (const request of requests) {
    const url = new URL(request.url);
    const isCode =
      CODE_RESOURCE_TYPES.has(request.resourceType) ||
      CODE_PATH.test(url.pathname);
    if (!isCode) continue;
    if (url.origin !== base.origin) {
      externalCodeRequests += 1;
      continue;
    }
    if (url.username || url.password || !url.pathname.startsWith(prefix))
      throw new Error('Observed code request escaped the verified build root.');
    let relative;
    try {
      relative = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      throw new Error('Observed code request path is malformed.');
    }
    if (
      !relative ||
      relative.includes('\\') ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Observed code request path is unsafe.');
    if (!expected.has(relative))
      throw new Error(
        'Observed code request is absent from the build receipt.',
      );
    observed.add(relative);
  }

  if (observed.size === 0)
    throw new Error(
      'No receipt-backed JavaScript code requests were observed.',
    );
  return {
    paths: [...observed].sort(),
    externalCodeRequests,
  };
}
