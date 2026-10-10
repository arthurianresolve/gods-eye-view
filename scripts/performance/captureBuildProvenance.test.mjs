import test from 'node:test';
import assert from 'node:assert/strict';
import { beginCaptureBuildProvenance } from './captureBuildProvenance.mjs';

const appSha = 'a'.repeat(40);
const harnessSha = 'b'.repeat(40);
const receipt = {
  schema: 'gev-build-provenance/v1',
  scope:
    'unsigned local source-build receipt; not a hardware or release attestation',
  receiptSha256: 'c'.repeat(64),
  source: { commit: appSha },
  harness: { commit: harnessSha },
  assets: [{ path: 'index.html' }],
  buildRecipe: {
    nodeVersion: 'v24.0.0',
    npmVersion: '11.0.0',
    packageLockSha256: 'd'.repeat(64),
  },
};
const result = {
  schema: 'gev-served-assets-verification/v1',
  status: 'served-assets-match',
  receiptSha256: receipt.receiptSha256,
  assetCount: 2,
  totalAssetBytes: 4096,
};

test('capture provenance binds full application and harness SHAs to the receipt', async () => {
  let verifies = 0;
  const capture = await beginCaptureBuildProvenance({
    receipt,
    expectedAppCommit: appSha,
    expectedHarnessCommit: harnessSha,
    checkoutRoot: 'app-checkout',
    harnessRoot: 'harness-root',
    actualHarnessRoot: 'harness-root',
    buildRoot: 'build-root',
    baseUrl: 'http://127.0.0.1:4173/',
    captureUrl: 'http://127.0.0.1:4173/?welcome=0',
    verifyImpl: async () => {
      verifies += 1;
      return result;
    },
  });
  assert.equal(verifies, 1);
  assert.equal(capture.source.appCommit, appSha);
  assert.equal(capture.source.harnessCommit, harnessSha);
  assert.match(capture.source.scope, /not independently attested/);
  assert.equal(capture.source.status, 'pre-capture-served-assets-verified');
  assert.deepEqual(await capture.verifyAfterCapture(), result);
  assert.equal(
    capture.source.status,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.deepEqual(capture.source.after, result);
  assert.equal(verifies, 2);
  await assert.rejects(capture.verifyAfterCapture(), /already ran/);
});

test('capture provenance rejects wrong SHAs and changes between the two served checks', async () => {
  await assert.rejects(
    beginCaptureBuildProvenance({
      receipt,
      expectedAppCommit: 'e'.repeat(40),
      expectedHarnessCommit: harnessSha,
      harnessRoot: 'harness-root',
      actualHarnessRoot: 'harness-root',
      baseUrl: 'http://127.0.0.1:4173/',
      captureUrl: 'http://127.0.0.1:4173/',
      verifyImpl: async () => result,
    }),
    /Receipt application SHA mismatch/,
  );
  await assert.rejects(
    beginCaptureBuildProvenance({
      receipt,
      expectedAppCommit: appSha,
      expectedHarnessCommit: 'f'.repeat(40),
      harnessRoot: 'harness-root',
      actualHarnessRoot: 'harness-root',
      baseUrl: 'http://127.0.0.1:4173/',
      captureUrl: 'http://127.0.0.1:4173/',
      verifyImpl: async () => result,
    }),
    /Receipt harness SHA mismatch/,
  );

  let verifies = 0;
  const capture = await beginCaptureBuildProvenance({
    receipt,
    expectedAppCommit: appSha,
    expectedHarnessCommit: harnessSha,
    harnessRoot: 'harness-root',
    actualHarnessRoot: 'harness-root',
    baseUrl: 'http://127.0.0.1:4173/',
    captureUrl: 'http://127.0.0.1:4173/',
    verifyImpl: async () => {
      verifies += 1;
      return verifies === 1 ? result : { ...result, totalAssetBytes: 4097 };
    },
  });
  await assert.rejects(capture.verifyAfterCapture(), /changed during capture/);
});

test('capture provenance rejects a different served root or harness checkout', async () => {
  const base = {
    receipt,
    expectedAppCommit: appSha,
    expectedHarnessCommit: harnessSha,
    harnessRoot: 'harness-root',
    actualHarnessRoot: 'harness-root',
    baseUrl: 'http://127.0.0.1:4173/',
    captureUrl: 'http://127.0.0.1:4173/',
    verifyImpl: async () => result,
  };
  await assert.rejects(
    beginCaptureBuildProvenance({
      ...base,
      captureUrl: 'http://127.0.0.1:4174/',
    }),
    /origin differs/,
  );
  await assert.rejects(
    beginCaptureBuildProvenance({
      ...base,
      captureUrl: 'http://127.0.0.1:4173/austin',
    }),
    /application entry point/,
  );
  await assert.rejects(
    beginCaptureBuildProvenance({ ...base, harnessRoot: 'different-checkout' }),
    /not the capture script checkout/,
  );
});
