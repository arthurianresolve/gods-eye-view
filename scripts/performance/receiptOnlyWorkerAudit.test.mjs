import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createReceiptOnlyWorkerAuditCollector,
  createReceiptOnlyWorkerAuditDocument,
  validateReceiptOnlyWorkerAuditEnvelope,
} from './receiptOnlyWorkerAudit.mjs';
import { getCaptureReadinessReasons } from './captureComparisonContract.mjs';
import { deriveCesiumEmbeddedWorkerContract } from './cesiumWorkerBlobContract.mjs';
import {
  beginCaptureBuildProvenance,
  projectPublicCaptureBuildProvenance,
} from './captureBuildProvenance.mjs';

const identity = {
  documentRole: 'provider-sample-1',
  documentId: 'provider-document-1',
  appCommit: 'a'.repeat(40),
  harnessCommit: 'b'.repeat(40),
  receiptSha256: 'c'.repeat(64),
  baseUrl: 'http://127.0.0.1:4173/',
  expectedAssetPaths: ['index.html', 'assets/app.js', 'cesium/Cesium.js'],
  requestedAssetPaths: ['assets/app.js', 'cesium/Cesium.js'],
  workerTargetUrls: [
    'blob:http://127.0.0.1:4173/worker-id',
    'http://127.0.0.1:4173/cesium/Cesium.js',
  ],
  blobRequestUrls: ['blob:http://127.0.0.1:4173/worker-id'],
  embeddedWorkerContract: {
    schema: 'gev-cesium-embedded-worker-contract/v1',
    bundlePath: 'cesium/Cesium.js',
    bundleSha256: 'd'.repeat(64),
    workerSourceSha256: 'e'.repeat(64),
    allowedModuleCount: 12,
  },
};

function makeEnvelope(caseIdentity = identity) {
  const document = createReceiptOnlyWorkerAuditDocument(caseIdentity);
  return {
    schema: 'gev-receipt-only-worker-audit/v1',
    status: 'all-document-receipt-paths-validated',
    workerAuditMode: 'receipt-only',
    appCommit: caseIdentity.appCommit,
    harnessCommit: caseIdentity.harnessCommit,
    receiptSha256: caseIdentity.receiptSha256,
    liveBlobBodyAttestation: 'unavailable-by-design',
    pageInstrumentation: {
      createObjectUrlWrapped: false,
      workerApiWrapped: false,
      blobBodyRegistryInstalled: false,
      debuggerAttached: false,
      profilerEnabled: false,
      observation: 'external-puppeteer-request-and-worker-target-events-only',
    },
    workerSource: document.workerSource,
    scriptRequestCount: caseIdentity.requestedAssetPaths.length,
    loadedAssetPaths: [...caseIdentity.requestedAssetPaths],
    unexpectedAssetPaths: [],
    workerAuditDocuments: [document],
  };
}

function validate(pageAssetAudit, caseIdentity = identity) {
  return validateReceiptOnlyWorkerAuditEnvelope({
    pageAssetAudit,
    appCommit: caseIdentity.appCommit,
    harnessCommit: caseIdentity.harnessCommit,
    receiptSha256: caseIdentity.receiptSha256,
    expectedDocuments: [
      {
        documentRole: caseIdentity.documentRole,
        documentId: caseIdentity.documentId,
      },
    ],
    expectedAssetPaths: caseIdentity.expectedAssetPaths,
    bundlePath: caseIdentity.embeddedWorkerContract.bundlePath,
    bundleSha256: caseIdentity.embeddedWorkerContract.bundleSha256,
    workerSourceSha256: caseIdentity.embeddedWorkerContract.workerSourceSha256,
    allowedModuleCount: caseIdentity.embeddedWorkerContract.allowedModuleCount,
  });
}

test('receipt-only audit records receipt-derived worker identity without page hooks', () => {
  const document = createReceiptOnlyWorkerAuditDocument(identity);
  assert.equal(
    document.status,
    'receipt-paths-validated-live-worker-body-unattested',
  );
  assert.equal(
    document.workerSource.liveBlobBodyAttestation,
    'unavailable-by-design',
  );
  assert.equal(document.workerTargets.blobCount, 1);
  assert.deepEqual(document.workerTargets.receiptedAssetPaths, [
    'cesium/Cesium.js',
  ]);
  for (const value of Object.values(document.pageInstrumentation))
    if (typeof value === 'boolean') assert.equal(value, false);
  assert.equal(validate(makeEnvelope()), true);
});

test('receipt-only envelope accepts a digest-versioned Cesium bundle path', () => {
  const bundlePath = `cesium/${'f'.repeat(64)}/Cesium.js`;
  const digestIdentity = {
    ...identity,
    expectedAssetPaths: ['index.html', 'assets/app.js', bundlePath],
    requestedAssetPaths: ['assets/app.js', bundlePath],
    workerTargetUrls: [
      'blob:http://127.0.0.1:4173/worker-id',
      `http://127.0.0.1:4173/${bundlePath}`,
    ],
    embeddedWorkerContract: { ...identity.embeddedWorkerContract, bundlePath },
  };
  const envelope = makeEnvelope(digestIdentity);
  assert.equal(validate(envelope, digestIdentity), true);
  assert.equal(envelope.workerSource.bundlePath, bundlePath);
});

test('receipt-only audit rejects a missing script request count', () => {
  const envelope = makeEnvelope();
  delete envelope.scriptRequestCount;
  assert.equal(validate(envelope), false);
});

test('receipt-only audit consumes the actual receipt-derived Cesium worker contract', () => {
  const workerSource = 'self.postMessage("ready");';
  const bundleBytes = Buffer.from(
    `globalThis.CESIUM_WORKERS=atob("${Buffer.from(workerSource).toString('base64')}");`,
  );
  const embeddedWorkerContract = deriveCesiumEmbeddedWorkerContract({
    bundlePath: 'cesium/Cesium.js',
    bundleBytes,
    assets: [
      {
        path: 'cesium/Cesium.js',
        bytes: bundleBytes.length,
        sha256: createHash('sha256').update(bundleBytes).digest('hex'),
      },
      ...['createGeometry', 'transferTypedArrayTest'].map((id) => ({
        path: `cesium/Workers/${id}.js`,
        bytes: 1,
        sha256: '0'.repeat(64),
      })),
    ],
  });
  const document = createReceiptOnlyWorkerAuditDocument({
    ...identity,
    embeddedWorkerContract,
  });
  assert.equal(document.workerSource.allowedModuleCount, 2);
  assert.equal(
    document.workerSource.allowedModuleCount,
    embeddedWorkerContract.allowedModuleIds.length,
  );
  assert.equal(
    document.workerSource.workerSourceSha256,
    createHash('sha256').update(workerSource).digest('hex'),
  );
  assert.equal(
    document.workerSource.liveBlobBodyAttestation,
    'unavailable-by-design',
  );
});

test('capture event collector validates live receipt paths and rejects late executable requests', () => {
  const page = new EventEmitter();
  const collector = createReceiptOnlyWorkerAuditCollector({
    baseUrl: identity.baseUrl,
    expectedAssetPaths: identity.expectedAssetPaths,
  });
  const dispose = collector.attach(page);
  const request = (url, resourceType = 'script') => ({
    url: () => url,
    resourceType: () => resourceType,
  });
  page.emit('request', request('http://127.0.0.1:4173/index.html'));
  page.emit('request', request('http://127.0.0.1:4173/assets/app.js?v=1'));
  page.emit('request', request('http://127.0.0.1:4173/cesium/Cesium.js'));
  const worker = { url: () => identity.workerTargetUrls[0] };
  page.emit('workercreated', worker);
  assert.deepEqual(collector.snapshot().requestedAssetPaths, [
    'assets/app.js',
    'cesium/Cesium.js',
    'index.html',
  ]);
  const document = collector.createDocument({
    ...identity,
    liveWorkers: [worker],
  });
  assert.equal(
    document.status,
    'receipt-paths-validated-live-worker-body-unattested',
  );
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  const before = collector.snapshot();
  page.emit('request', request('https://unknown.example/late.js'));
  assert.deepEqual(collector.snapshot(), before);

  const latePage = new EventEmitter();
  const lateCollector = createReceiptOnlyWorkerAuditCollector({
    baseUrl: identity.baseUrl,
    expectedAssetPaths: identity.expectedAssetPaths,
  });
  const disposeLate = lateCollector.attach(latePage);
  latePage.emit('request', request('http://127.0.0.1:4173/index.html'));
  latePage.emit('request', request('http://127.0.0.1:4173/assets/app.js'));
  latePage.emit('request', request('http://127.0.0.1:4173/late-worker.js'));
  assert.throws(
    () => lateCollector.createDocument({ ...identity }),
    /unreceipted executable requests/i,
  );
  assert.equal(disposeLate(), true);
});

test('capture collector output is validated by the comparison readiness consumer', () => {
  const page = new EventEmitter();
  const collector = createReceiptOnlyWorkerAuditCollector({
    baseUrl: identity.baseUrl,
    expectedAssetPaths: identity.expectedAssetPaths,
  });
  const dispose = collector.attach(page);
  const request = (url) => ({
    url: () => url,
    resourceType: () => 'script',
  });
  page.emit('request', request(`${identity.baseUrl}index.html`));
  page.emit('request', request(`${identity.baseUrl}assets/app.js`));
  page.emit('request', request(`${identity.baseUrl}cesium/Cesium.js`));
  const worker = { url: () => identity.workerTargetUrls[0] };
  page.emit('workercreated', worker);
  const document = collector.createDocument({
    ...identity,
    liveWorkers: [worker],
  });
  assert.equal(dispose(), true);
  const pageAssetAudit = makeEnvelope();
  pageAssetAudit.workerAuditDocuments = [document];
  pageAssetAudit.workerSource = document.workerSource;
  pageAssetAudit.loadedAssetPaths = document.requestedAssetPaths;
  const source = {
    appCommit: identity.appCommit,
    harnessCommit: identity.harnessCommit,
    buildProvenance: {
      appCommit: identity.appCommit,
      harnessCommit: identity.harnessCommit,
      receiptSha256: identity.receiptSha256,
    },
  };
  const evidence = {
    pageAssetAudit,
    expectedDocuments: [
      { documentRole: identity.documentRole, documentId: identity.documentId },
    ],
    expectedAssetPaths: identity.expectedAssetPaths,
    bundleSha256: identity.embeddedWorkerContract.bundleSha256,
    workerSourceSha256: identity.embeddedWorkerContract.workerSourceSha256,
    allowedModuleCount: identity.embeddedWorkerContract.allowedModuleCount,
  };
  const readiness = () =>
    getCaptureReadinessReasons({
      workerAuditMode: 'receipt-only',
      receiptOnlyWorkerAuditEvidence: evidence,
      source,
      fixture: { schema: 'gev-austin-operating-fixture/v1' },
    });
  assert.equal(
    readiness().includes('receipt-only-worker-audit-evidence-is-incomplete'),
    false,
  );
  const wrongReceipt = structuredClone(pageAssetAudit);
  wrongReceipt.workerAuditDocuments[0].provenance.receiptSha256 = 'f'.repeat(
    64,
  );
  evidence.pageAssetAudit = wrongReceipt;
  assert.equal(
    readiness().includes('receipt-only-worker-audit-evidence-is-incomplete'),
    true,
  );
});

test('receipt-only audit rejects unknown executable paths, origins, and overflow', () => {
  assert.throws(
    () =>
      createReceiptOnlyWorkerAuditDocument({
        ...identity,
        unreceiptedExecutableCount: 1,
      }),
    /outside|observed/i,
  );
  assert.throws(
    () =>
      createReceiptOnlyWorkerAuditDocument({
        ...identity,
        workerTargetUrls: ['https://unreceipted.example/worker.js'],
      }),
    /outside/i,
  );
  assert.throws(
    () =>
      createReceiptOnlyWorkerAuditDocument({
        ...identity,
        overflowCount: 1,
      }),
    /overflow/i,
  );
});

test('receipt-only envelope rejects forged identities, receipt, and page instrumentation', () => {
  const valid = makeEnvelope();
  assert.equal(validate(valid), true);
  const wrongDocument = structuredClone(valid);
  wrongDocument.workerAuditDocuments[0].documentId = 'replacement';
  assert.equal(validate(wrongDocument), false);
  const wrongReceipt = structuredClone(valid);
  wrongReceipt.workerAuditDocuments[0].provenance.receiptSha256 = 'f'.repeat(
    64,
  );
  assert.equal(validate(wrongReceipt), false);
  const instrumented = structuredClone(valid);
  instrumented.pageInstrumentation.workerApiWrapped = true;
  assert.equal(validate(instrumented), false);
  const malformed = structuredClone(valid);
  malformed.workerAuditDocuments[0].workerSource = null;
  assert.equal(validate(malformed), false);
  const tooManyWorkers = structuredClone(valid);
  tooManyWorkers.workerAuditDocuments[0].workerTargets.count = 257;
  tooManyWorkers.workerAuditDocuments[0].workerTargets.blobCount = 1;
  assert.equal(validate(tooManyWorkers), false);
  const tooManyBlobs = structuredClone(valid);
  tooManyBlobs.workerAuditDocuments[0].blobRequestCount = 257;
  assert.equal(validate(tooManyBlobs), false);
  const malformedContract = structuredClone(valid);
  malformedContract.workerSource.bundleSha256 = null;
  assert.equal(validate(malformedContract), false);
  assert.equal(
    validateReceiptOnlyWorkerAuditEnvelope({
      pageAssetAudit: valid,
      appCommit: identity.appCommit,
      harnessCommit: identity.harnessCommit,
      receiptSha256: identity.receiptSha256,
      expectedDocuments: [
        {
          documentRole: identity.documentRole,
          documentId: identity.documentId,
        },
      ],
      expectedAssetPaths: identity.expectedAssetPaths,
      bundleSha256: identity.embeddedWorkerContract.bundleSha256,
      workerSourceSha256: identity.embeddedWorkerContract.workerSourceSha256,
      allowedModuleCount: undefined,
    }),
    false,
  );
});

test('comparison readiness validates the receipt-only record and preserves the Austin cadence blocker', () => {
  const pageAssetAudit = makeEnvelope();
  const source = {
    appCommit: identity.appCommit,
    harnessCommit: identity.harnessCommit,
    buildProvenance: {
      appCommit: identity.appCommit,
      harnessCommit: identity.harnessCommit,
      receiptSha256: identity.receiptSha256,
    },
  };
  const receiptOnlyWorkerAuditEvidence = {
    pageAssetAudit,
    expectedDocuments: [
      { documentRole: identity.documentRole, documentId: identity.documentId },
    ],
    expectedAssetPaths: identity.expectedAssetPaths,
    bundleSha256: identity.embeddedWorkerContract.bundleSha256,
    workerSourceSha256: identity.embeddedWorkerContract.workerSourceSha256,
    allowedModuleCount: identity.embeddedWorkerContract.allowedModuleCount,
  };
  const reasons = getCaptureReadinessReasons({
    workerAuditMode: 'receipt-only',
    workerBlobAuditInstrumented: false,
    receiptOnlyWorkerAuditEvidence,
    source,
    fixture: { schema: 'gev-austin-operating-fixture/v1' },
  });
  assert.equal(
    reasons.includes('receipt-only-worker-audit-evidence-is-incomplete'),
    false,
  );
  assert.equal(
    reasons.includes(
      'austin-satellite-boundary-sampling-remains-frame-cadence-dependent',
    ),
    true,
  );
  pageAssetAudit.pageInstrumentation.workerApiWrapped = true;
  assert.equal(
    getCaptureReadinessReasons({
      workerAuditMode: 'receipt-only',
      receiptOnlyWorkerAuditEvidence,
      source,
      fixture: { schema: 'gev-austin-operating-fixture/v1' },
    }).includes('receipt-only-worker-audit-evidence-is-incomplete'),
    true,
  );
});

test('public provenance projection keeps receipt paths available through actual receipt-only readiness validation', async () => {
  const receipt = {
    schema: 'gev-build-provenance/v1',
    scope:
      'unsigned local source-build receipt; not a hardware or release attestation',
    receiptSha256: identity.receiptSha256,
    source: { commit: identity.appCommit },
    harness: { commit: identity.harnessCommit },
    assets: identity.expectedAssetPaths.map((assetPath) => ({
      path: assetPath,
    })),
    buildRecipe: {
      nodeVersion: 'v24.0.0',
      npmVersion: '11.0.0',
      packageLockSha256: 'f'.repeat(64),
    },
  };
  const verifiedAssets = {
    schema: 'gev-served-assets-verification/v1',
    status: 'served-assets-match',
    receiptSha256: receipt.receiptSha256,
    assetCount: receipt.assets.length,
    totalAssetBytes: 4096,
  };
  const startCaptureProvenance = () =>
    beginCaptureBuildProvenance({
      receipt,
      expectedAppCommit: identity.appCommit,
      expectedHarnessCommit: identity.harnessCommit,
      checkoutRoot: 'app-checkout',
      harnessRoot: 'harness-root',
      actualHarnessRoot: 'harness-root',
      buildRoot: 'build-root',
      baseUrl: identity.baseUrl,
      captureUrl: identity.baseUrl,
      verifyImpl: async () => verifiedAssets,
    });
  const captureProvenance = await startCaptureProvenance();
  const expectedAssetPaths = captureProvenance.source.expectedAssetPaths;
  const publicBuildProvenance = projectPublicCaptureBuildProvenance(
    captureProvenance.source,
  );
  assert.notEqual(publicBuildProvenance, captureProvenance.source);
  assert.equal(publicBuildProvenance.expectedAssetPaths, undefined);
  assert.equal(publicBuildProvenance.entryPaths, undefined);
  assert.deepEqual(
    captureProvenance.source.expectedAssetPaths,
    expectedAssetPaths,
  );
  assert.deepEqual(captureProvenance.source.entryPaths, ['/', '/index.html']);

  await captureProvenance.verifyAfterCapture();
  const finalPublicBuildProvenance = projectPublicCaptureBuildProvenance(
    captureProvenance.source,
  );
  assert.equal(
    finalPublicBuildProvenance.status,
    'verified-local-build-and-served-assets-before-and-after',
  );
  assert.deepEqual(finalPublicBuildProvenance.before, verifiedAssets);
  assert.deepEqual(finalPublicBuildProvenance.after, verifiedAssets);
  assert.equal(finalPublicBuildProvenance.expectedAssetPaths, undefined);
  assert.equal(finalPublicBuildProvenance.entryPaths, undefined);
  assert.deepEqual(
    captureProvenance.source.expectedAssetPaths,
    expectedAssetPaths,
  );

  const pageAssetAudit = makeEnvelope();
  finalPublicBuildProvenance.pageAssetAudit = pageAssetAudit;
  const finalSource = {
    appCommit: identity.appCommit,
    harnessCommit: identity.harnessCommit,
    provenanceStatus: finalPublicBuildProvenance.status,
    buildProvenance: finalPublicBuildProvenance,
  };
  const makeEvidence = (expectedPaths) => ({
    pageAssetAudit,
    expectedDocuments: [
      { documentRole: identity.documentRole, documentId: identity.documentId },
    ],
    expectedAssetPaths: expectedPaths,
    bundleSha256: identity.embeddedWorkerContract.bundleSha256,
    workerSourceSha256: identity.embeddedWorkerContract.workerSourceSha256,
    allowedModuleCount: identity.embeddedWorkerContract.allowedModuleCount,
  });
  const readinessReasons = getCaptureReadinessReasons({
    workerAuditMode: 'receipt-only',
    workerBlobAuditInstrumented: false,
    receiptOnlyWorkerAuditEvidence: makeEvidence(
      captureProvenance.source.expectedAssetPaths,
    ),
    source: finalSource,
    fixture: { schema: 'gev-austin-operating-fixture/v1' },
  });
  assert.equal(
    readinessReasons.includes(
      'receipt-only-worker-audit-evidence-is-incomplete',
    ),
    false,
  );

  const legacyCaptureProvenance = await startCaptureProvenance();
  const legacySource = {
    appCommit: identity.appCommit,
    harnessCommit: identity.harnessCommit,
    buildProvenance: legacyCaptureProvenance.source,
  };
  legacySource.buildProvenance.pageAssetAudit = pageAssetAudit;
  delete legacySource.buildProvenance.expectedAssetPaths;
  delete legacySource.buildProvenance.entryPaths;
  const legacyReasons = getCaptureReadinessReasons({
    workerAuditMode: 'receipt-only',
    workerBlobAuditInstrumented: false,
    receiptOnlyWorkerAuditEvidence: makeEvidence(
      legacyCaptureProvenance.source.expectedAssetPaths,
    ),
    source: legacySource,
    fixture: { schema: 'gev-austin-operating-fixture/v1' },
  });
  assert.equal(
    legacyReasons.includes('receipt-only-worker-audit-evidence-is-incomplete'),
    true,
  );
});
