import test from 'node:test';
import assert from 'node:assert/strict';
import { auditReceiptedCodeRequests } from './buildSmokeContract.mjs';

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
      /absent from the build receipt|escaped|unsafe/,
    );
});
