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

/** Wait for the exact preflight Worker targets to disappear before app auditing. */
export async function waitForPreflightWorkerTargetsClosed({
  getTargets,
  workerUrls = null,
  timeoutMs = 2000,
  pollMs = 25,
  settleMs = 100,
  now = () => performance.now(),
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  if (
    typeof getTargets !== 'function' ||
    (workerUrls !== null && !Array.isArray(workerUrls))
  )
    throw new TypeError('Preflight worker target inputs are required.');
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isFinite(pollMs) ||
    pollMs < 1 ||
    !Number.isFinite(settleMs) ||
    settleMs < 0
  )
    throw new TypeError('Preflight target wait bounds are invalid.');
  const expected = workerUrls === null ? null : new Set(workerUrls);
  const isExpectedWorker = (target) =>
    target?.type === 'worker' && (!expected || expected.has(target.url));
  const startedAt = now();
  let absentSince = null;
  while (now() - startedAt <= timeoutMs) {
    const remaining = getTargets().filter(isExpectedWorker).length;
    if (remaining === 0) {
      absentSince ??= now();
      if (now() - absentSince >= settleMs)
        return {
          closed: true,
          remainingCount: 0,
          waitMs: Math.max(0, now() - startedAt),
        };
    } else {
      absentSince = null;
    }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (now() - startedAt))));
  }
  const remainingCount = getTargets().filter(isExpectedWorker).length;
  return {
    closed: remainingCount === 0 && settleMs === 0,
    remainingCount,
    waitMs: Math.max(0, now() - startedAt),
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
    if (url.username || url.password)
      throw new Error(
        `Observed code request failed build-root integrity (credentialed URL; protocol=${url.protocol}; resourceType=${String(request.resourceType).slice(0, 24)}).`,
      );
    if (!url.pathname.startsWith(prefix))
      throw new Error(
        `Observed code request failed build-root integrity (outside path; protocol=${url.protocol}; sameOrigin=true; resourceType=${String(request.resourceType).slice(0, 24)}).`,
      );
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
