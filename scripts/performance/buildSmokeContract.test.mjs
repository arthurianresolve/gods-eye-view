import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditReceiptedCodeRequests,
  respondToWorkerPreflight,
  runSameOriginWorkerPreflight,
  waitForPreflightWorkerTargetsClosed,
  WORKER_PREFLIGHT_PATH,
} from './buildSmokeContract.mjs';

const assets = [
  { path: 'assets/index-A1.js' },
  { path: 'assets/worker-B2.mjs' },
];

test('code request audit includes receipt-backed scripts and workers only', () => {
  const result = auditReceiptedCodeRequests({
    baseUrl: 'http://127.0.0.1:4173/',
    assets,
    requests: [
      {
        url: 'http://127.0.0.1:4173/assets/index-A1.js',
        resourceType: 'script',
      },
      {
        url: 'http://127.0.0.1:4173/assets/worker-B2.mjs?module',
        resourceType: 'other',
      },
      { url: 'https://provider.invalid/remote.js', resourceType: 'script' },
      { url: 'http://127.0.0.1:4173/assets/image.png', resourceType: 'image' },
    ],
  });
  assert.deepEqual(result.paths, [
    'assets/index-A1.js',
    'assets/worker-B2.mjs',
  ]);
  assert.equal(result.externalCodeRequests, 1);
});

test('code request audit rejects missing, escaped and unsafe asset paths', () => {
  const base = {
    baseUrl: 'http://127.0.0.1:4173/app/',
    assets,
  };
  for (const request of [
    {
      url: 'http://127.0.0.1:4173/app/assets/missing.js',
      resourceType: 'script',
    },
    { url: 'http://127.0.0.1:4173/other.js', resourceType: 'script' },
    {
      url: 'http://127.0.0.1:4173/app/assets/%2e%2e/other.js',
      resourceType: 'script',
    },
  ])
    assert.throws(
      () => auditReceiptedCodeRequests({ ...base, requests: [request] }),
      /absent from the build receipt|build-root integrity|unsafe/,
    );
});

test('worker preflight navigates to a same-origin inert page before probe and resets app audit', async () => {
  const baseUrl = 'http://127.0.0.1:4173/';
  const expectedUrl = new URL(WORKER_PREFLIGHT_PATH, baseUrl).href;
  const events = [];
  let currentUrl = 'about:blank';
  const page = {
    async goto(url, options) {
      events.push(['navigate', url, options.waitUntil]);
      currentUrl = url;
      return { status: () => 200 };
    },
    url: () => currentUrl,
  };
  const result = await runSameOriginWorkerPreflight({
    page,
    baseUrl,
    verifyNetwork: async () => {
      events.push(['probe']);
      return { status: 'passed', interceptedWorkerRequests: 3 };
    },
    resetRequestAudit: () => {
      events.push(['reset-audit']);
      return { requestCount: 4, codeRequestCount: 1 };
    },
  });
  assert.deepEqual(events, [
    ['navigate', expectedUrl, 'domcontentloaded'],
    ['probe'],
    ['reset-audit'],
  ]);
  assert.equal(result.status, 'passed');
  assert.match(result.scope, /excluded from app code audit/);
  assert.deepEqual(result.discardedAudit, {
    requestCount: 4,
    codeRequestCount: 1,
  });
});

test('worker preflight only intercepts the exact same-origin document and rejects failed navigation', async () => {
  const baseUrl = 'http://127.0.0.1:4173/';
  const goodUrl = new URL(WORKER_PREFLIGHT_PATH, baseUrl);
  assert.equal(respondToWorkerPreflight(goodUrl, baseUrl).status, 200);
  assert.equal(
    respondToWorkerPreflight(
      new URL(WORKER_PREFLIGHT_PATH + '?other=1', baseUrl),
      baseUrl,
    ),
    undefined,
  );
  assert.equal(
    respondToWorkerPreflight(
      new URL(WORKER_PREFLIGHT_PATH, 'https://external.invalid/'),
      baseUrl,
    ),
    undefined,
  );

  let verified = false;
  await assert.rejects(
    runSameOriginWorkerPreflight({
      page: {
        goto: async () => ({ status: () => 404 }),
        url: () => goodUrl.href,
      },
      baseUrl,
      verifyNetwork: async () => {
        verified = true;
      },
    }),
    /failed to load/,
  );
  assert.equal(verified, false);
});

test('worker preflight rejects navigation away from the verified inert entry', async () => {
  const baseUrl = 'http://127.0.0.1:4173/';
  let verified = false;
  await assert.rejects(
    runSameOriginWorkerPreflight({
      page: {
        goto: async () => ({ status: () => 200 }),
        url: () => 'https://elsewhere.invalid/',
      },
      baseUrl,
      verifyNetwork: async () => {
        verified = true;
      },
    }),
    /left its exact same-origin page/,
  );
  assert.equal(verified, false);
});

test('worker preflight waits for target removal and a bounded settle window', async () => {
  let clock = 0;
  const workerUrls = ['blob:http://127.0.0.1:4173/fixture-worker'];
  const result = await waitForPreflightWorkerTargetsClosed({
    workerUrls,
    now: () => clock,
    sleep: async (duration) => {
      clock += duration;
    },
    getTargets: () =>
      clock < 75
        ? [{ type: 'worker', url: workerUrls[0] }]
        : [],
    timeoutMs: 200,
    pollMs: 25,
    settleMs: 50,
  });
  assert.equal(result.closed, true);
  assert.equal(result.remainingCount, 0);
  assert.ok(result.waitMs >= 125);
});

test('worker preflight fails boundedly if the exact worker target persists', async () => {
  let clock = 0;
  const workerUrl = 'blob:http://127.0.0.1:4173/fixture-worker';
  const result = await waitForPreflightWorkerTargetsClosed({
    workerUrls: [workerUrl],
    now: () => clock,
    sleep: async (duration) => {
      clock += duration;
    },
    getTargets: () => [{ type: 'worker', url: workerUrl }],
    timeoutMs: 80,
    pollMs: 20,
    settleMs: 20,
  });
  assert.equal(result.closed, false);
  assert.equal(result.remainingCount, 1);
  assert.ok(result.waitMs >= 80 && result.waitMs <= 81);
});

test('preflight disposal waits for every worker target without persisting URLs', async () => {
  let clock = 0;
  const targets = [
    { type: 'page', url: 'about:blank' },
    { type: 'worker', url: 'blob:http://127.0.0.1/opaque-id' },
  ];
  const result = await waitForPreflightWorkerTargetsClosed({
    workerUrls: null,
    now: () => clock,
    sleep: async (duration) => {
      clock += duration;
      if (clock >= 50) targets.pop();
    },
    getTargets: () => targets,
    timeoutMs: 200,
    pollMs: 25,
    settleMs: 50,
  });
  assert.deepEqual(result, {
    closed: true,
    remainingCount: 0,
    waitMs: 100,
  });
});
