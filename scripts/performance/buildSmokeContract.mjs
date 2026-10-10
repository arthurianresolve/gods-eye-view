const CODE_RESOURCE_TYPES = new Set(['script', 'worker', 'serviceworker']);
const CODE_PATH = /\.(?:m?js)$/i;
export const WORKER_PREFLIGHT_PATH =
  '/__gev_performance_smoke_worker_preflight__';

const WORKER_PREFLIGHT_HTML =
  '<!doctype html><meta charset="utf-8"><title>QA worker preflight</title>';

/** Fulfill only the exact same-origin inert document used by the worker probe. */
export function respondToWorkerPreflight(url, baseUrl) {
  const expected = new URL(WORKER_PREFLIGHT_PATH, baseUrl);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.search ||
    url.hash
  )
    return undefined;
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    headers: { 'cache-control': 'no-store' },
    body: WORKER_PREFLIGHT_HTML,
  };
}

/** Navigate before creating a blob worker, then exclude those harness probes from app requests. */
export async function runSameOriginWorkerPreflight({
  page,
  baseUrl,
  verifyNetwork,
  resetRequestAudit,
} = {}) {
  if (!page || typeof verifyNetwork !== 'function')
    throw new TypeError('Worker preflight inputs are required.');
  const expected = new URL(WORKER_PREFLIGHT_PATH, baseUrl);
  const response = await page.goto(expected.href, {
    waitUntil: 'domcontentloaded',
    timeout: 10_000,
  });
  if (!response || response.status() >= 400)
    throw new Error('Harness worker preflight document failed to load.');
  const landed = new URL(page.url());
  if (
    landed.origin !== expected.origin ||
    landed.pathname !== expected.pathname ||
    landed.search ||
    landed.hash
  )
    throw new Error(
      'Harness worker preflight left its exact same-origin page.',
    );
  const workerNetworkProbe = await verifyNetwork();
  const discardedAudit = resetRequestAudit?.() ?? null;
  return {
    status: 'passed',
    scope:
      'harness-generated same-origin inert document; excluded from app code audit',
    workerNetworkProbe,
    discardedAudit,
  };
}

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
