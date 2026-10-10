import assert from 'node:assert/strict';
import path from 'node:path';
import { verifyServedBuildAssets } from './buildProvenance.mjs';

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SUMMARY_KEYS = [
  'schema',
  'status',
  'receiptSha256',
  'assetCount',
  'totalAssetBytes',
];

function verifiedSummary(result, receipt) {
  assert.equal(result?.schema, 'gev-served-assets-verification/v1');
  assert.equal(result?.status, 'served-assets-match');
  assert.equal(result.receiptSha256, receipt.receiptSha256);
  assert.ok(Number.isInteger(result.assetCount) && result.assetCount > 0);
  assert.ok(
    Number.isInteger(result.totalAssetBytes) && result.totalAssetBytes > 0,
  );
  return Object.fromEntries(SUMMARY_KEYS.map((key) => [key, result[key]]));
}

/** Verify a local receipt against the named served app both sides of capture. */
export async function beginCaptureBuildProvenance({
  receipt,
  checkoutRoot,
  harnessRoot,
  buildRoot,
  expectedAppCommit,
  expectedHarnessCommit,
  baseUrl,
  captureUrl,
  actualHarnessRoot,
  fetchImpl = globalThis.fetch,
  verifyImpl = verifyServedBuildAssets,
} = {}) {
  assert.match(
    expectedAppCommit || '',
    SHA1,
    'Expected full application SHA is required',
  );
  assert.match(
    expectedHarnessCommit || '',
    SHA1,
    'Expected full harness SHA is required',
  );
  assert.equal(receipt?.schema, 'gev-build-provenance/v1');
  assert.equal(
    receipt?.scope,
    'unsigned local source-build receipt; not a hardware or release attestation',
  );
  assert.match(
    receipt?.receiptSha256 || '',
    SHA256,
    'Receipt SHA-256 is required',
  );
  assert.equal(
    receipt.source?.commit,
    expectedAppCommit,
    'Receipt application SHA mismatch',
  );
  assert.equal(
    receipt.harness?.commit,
    expectedHarnessCommit,
    'Receipt harness SHA mismatch',
  );
  assert.equal(
    path.resolve(harnessRoot || ''),
    path.resolve(actualHarnessRoot || ''),
    'Explicit harness checkout is not the capture script checkout.',
  );
  const base = new URL(baseUrl);
  const capture = new URL(captureUrl);
  assert.ok(!base.username && !base.password && !base.search && !base.hash);
  assert.ok(
    !capture.username && !capture.password,
    'Capture URL must not contain credentials.',
  );
  assert.equal(
    capture.origin,
    base.origin,
    'Capture URL origin differs from the verified served build.',
  );
  const basePath = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  const rootPath = basePath.slice(0, -1) || '/';
  const entryPaths = [
    ...new Set([rootPath, basePath, `${basePath}index.html`]),
  ];
  assert.ok(
    entryPaths.includes(capture.pathname),
    'Capture URL must resolve to the verified application entry point.',
  );
  assert.ok(
    receipt.assets.some((asset) => asset.path === 'index.html'),
    'Build receipt is missing the verified application entry point.',
  );

  const verify = () =>
    verifyImpl({
      receipt,
      checkoutRoot,
      harnessRoot,
      buildRoot,
      expectedAppCommit,
      expectedHarnessCommit,
      baseUrl,
      fetchImpl,
    });
  const before = verifiedSummary(await verify(), receipt);
  let completed = false;
  return {
    source: {
      schema: 'gev-capture-build-provenance/v1',
      status: 'pre-capture-served-assets-verified',
      scope:
        'unsigned local build and served-byte checks; browser response bytes are not independently attested',
      receiptSha256: receipt.receiptSha256,
      appCommit: receipt.source.commit,
      harnessCommit: receipt.harness.commit,
      entryPaths,
      expectedAssetPaths: receipt.assets.map((asset) => asset.path),
      buildRecipe: structuredClone(receipt.buildRecipe),
      before,
    },
    async verifyAfterCapture() {
      if (completed)
        throw new Error('Post-capture build verification already ran.');
      completed = true;
      const after = verifiedSummary(await verify(), receipt);
      assert.deepEqual(
        after,
        before,
        'Served build provenance changed during capture.',
      );
      this.source.status =
        'verified-local-build-and-served-assets-before-and-after';
      this.source.after = after;
      return after;
    },
  };
}
