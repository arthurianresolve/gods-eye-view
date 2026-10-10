import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  deriveCesiumEmbeddedWorkerContract,
  installCesiumWorkerBlobAudit,
  MAX_WORKER_BLOB_TOTAL_BYTES,
  summarizeCesiumWorkerBlobEvidence,
  validateCesiumWorkerBlobs,
} from './cesiumWorkerBlobContract.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const BASE = 'http://127.0.0.1:4173/';

function makeContract(workerSource = 'self.postMessage("ready");') {
  const encoded = Buffer.from(workerSource, 'utf8').toString('base64');
  const bundleBytes = Buffer.from(
    `globalThis.CESIUM_WORKERS=atob("${encoded}");`,
    'utf8',
  );
  return deriveCesiumEmbeddedWorkerContract({
    bundlePath: 'cesium/Cesium.js',
    bundleBytes,
    assets: [
      {
        path: 'cesium/Cesium.js',
        bytes: bundleBytes.length,
        sha256: sha256(bundleBytes),
      },
      {
        path: 'cesium/Workers/createGeometry.js',
        bytes: 1,
        sha256: '0'.repeat(64),
      },
      {
        path: 'cesium/Workers/transferTypedArrayTest.js',
        bytes: 1,
        sha256: '0'.repeat(64),
      },
    ],
  });
}

function workerAudit(contract, { wrapper, embeddedBody } = {}) {
  const wrapperUrl = 'blob:http://127.0.0.1:4173/wrapper-id';
  const embeddedUrl = 'blob:http://127.0.0.1:4173/embedded-id';
  const body =
    wrapper ??
    `\n      importScripts("${embeddedUrl}");\n      CesiumWorkers["createGeometry"]();\n    `;
  const parent = embeddedBody ?? contract.embeddedWorkerSource;
  const records = [
    {
      url: wrapperUrl,
      type: 'application/javascript',
      byteLength: Buffer.byteLength(body),
      body,
    },
    {
      url: embeddedUrl,
      type: 'application/javascript',
      byteLength: Buffer.byteLength(parent),
      body: parent,
    },
  ];
  return {
    contract,
    baseUrl: BASE,
    workerUrls: [wrapperUrl],
    observedBlobUrls: [wrapperUrl, embeddedUrl],
    blobAudit: {
      createdBlobCount: 2,
      overflowCount: 0,
      maxRetainedBytes: MAX_WORKER_BLOB_TOTAL_BYTES,
      totalReadBytes: records.reduce(
        (sum, record) => sum + record.byteLength,
        0,
      ),
      records,
    },
  };
}

test('installed locked Cesium bundle derives worker bytes and IDs from receipt assets', async () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const bundlePath = path.join(
    repoRoot,
    'node_modules/cesium/Build/Cesium/Cesium.js',
  );
  const bundleBytes = await readFile(bundlePath);
  const workersRoot = path.join(
    repoRoot,
    'node_modules/cesium/Build/Cesium/Workers',
  );
  const workerFiles = (await readdir(workersRoot, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && /^[A-Za-z0-9_$-]+\.js$/.test(entry.name),
    )
    .map((entry) => ({
      path: `cesium/Workers/${entry.name}`,
      bytes: 1,
      sha256: '0'.repeat(64),
    }));
  const bundleAsset = {
    path: 'cesium/Cesium.js',
    bytes: bundleBytes.length,
    sha256: sha256(bundleBytes),
  };
  const contract = deriveCesiumEmbeddedWorkerContract({
    bundlePath: bundleAsset.path,
    bundleBytes,
    assets: [bundleAsset, ...workerFiles],
  });
  assert.ok(contract.workerSourceBytes > 0);
  assert.ok(contract.workerSourceSha256.match(/^[a-f0-9]{64}$/));
  assert.ok(contract.allowedModuleIds.includes('createGeometry'));
  assert.ok(contract.allowedModuleIds.includes('transferTypedArrayTest'));
});

test('embedded atob source hashing matches Latin-1 string to UTF-8 Blob conversion', () => {
  const contract = makeContract('self.name = "café";');
  const atobString = Buffer.from('self.name = "café";', 'utf8').toString(
    'latin1',
  );
  const expectedBlobText = Buffer.from(atobString, 'utf8').toString('utf8');
  assert.equal(contract.embeddedWorkerSource, expectedBlobText);
  assert.notEqual(contract.embeddedWorkerSource, 'self.name = "café";');
  assert.equal(
    contract.workerSourceSha256,
    sha256(Buffer.from(expectedBlobText, 'utf8')),
  );
});

test('receipt-derived narrow worker wrapper validates its embedded body and module ID', () => {
  const result = validateCesiumWorkerBlobs(workerAudit(makeContract()));
  assert.equal(
    result.observation.status,
    'receipt-derived-worker-blobs-validated',
  );
  assert.deepEqual(result.observation.validatedModuleIds, ['createGeometry']);
  assert.equal(result.observation.validatedWorkerCount, 1);
  assert.equal(result.observation.validatedCreatedWrapperCount, 1);
  assert.deepEqual(result.validatedWorkerTargetUrls, [
    'blob:http://127.0.0.1:4173/wrapper-id',
  ]);
  assert.equal(result.observation.unobservedCreatedWrapperCount, 0);
  assert.equal(result.observation.validatedEmbeddedSourceCount, 1);
});

test('a valid created wrapper remains validated when worker target publication is delayed', () => {
  const audit = workerAudit(makeContract());
  const embeddedUrl = audit.blobAudit.records[1].url;
  const url = 'blob:http://127.0.0.1:4173/unstarted-wrapper';
  const body = `importScripts("${embeddedUrl}"); CesiumWorkers["transferTypedArrayTest"]();`;
  const byteLength = Buffer.byteLength(body);
  audit.blobAudit.records.push({
    url,
    type: 'application/javascript',
    byteLength,
    body,
  });
  audit.blobAudit.createdBlobCount += 1;
  audit.blobAudit.totalReadBytes += byteLength;

  const result = validateCesiumWorkerBlobs(audit);
  assert.equal(result.observation.validatedWorkerCount, 1);
  assert.equal(result.observation.validatedCreatedWrapperCount, 2);
  assert.equal(result.observation.unobservedCreatedWrapperCount, 1);
  assert.deepEqual(result.observation.validatedModuleIds, [
    'createGeometry',
    'transferTypedArrayTest',
  ]);
  assert.ok(result.acceptedBlobUrls.includes(url));
});

test('created source validation does not invent worker-target evidence', () => {
  const audit = workerAudit(makeContract());
  audit.workerUrls = [];

  const result = validateCesiumWorkerBlobs(audit);
  assert.equal(result.observation.validatedCreatedWrapperCount, 1);
  assert.equal(result.observation.validatedEmbeddedSourceCount, 1);
  assert.equal(result.observation.validatedWorkerCount, 0);
  assert.equal(result.observation.unobservedCreatedWrapperCount, 1);
});

test('worker blob contract rejects malformed, noncanonical, duplicate and unbounded derivations', () => {
  const assets = [
    { path: 'cesium/Cesium.js', bytes: 0, sha256: sha256(Buffer.alloc(0)) },
    { path: 'cesium/Workers/createGeometry.js' },
  ];
  for (const bundleText of [
    'globalThis.CESIUM_WORKERS=atob("%%%=");',
    'globalThis.CESIUM_WORKERS=atob("YQ=="); globalThis.CESIUM_WORKERS=atob("Yg==");',
  ]) {
    const bytes = Buffer.from(bundleText);
    assert.throws(() =>
      deriveCesiumEmbeddedWorkerContract({
        bundlePath: 'cesium/Cesium.js',
        bundleBytes: bytes,
        assets: [
          { ...assets[0], bytes: bytes.length, sha256: sha256(bytes) },
          assets[1],
        ],
      }),
    );
  }
  const overflowBytes = Buffer.from(
    `globalThis.CESIUM_WORKERS=atob("${'A'.repeat(2_800_000)}");`,
  );
  assert.throws(
    () =>
      deriveCesiumEmbeddedWorkerContract({
        bundlePath: 'cesium/Cesium.js',
        bundleBytes: overflowBytes,
        assets: [
          {
            ...assets[0],
            bytes: overflowBytes.length,
            sha256: sha256(overflowBytes),
          },
          assets[1],
        ],
      }),
    /bound|canonical/,
  );
});

test('worker blob validator rejects wrong parent, wrapper recipe and module IDs', () => {
  const contract = makeContract();
  assert.throws(
    () =>
      validateCesiumWorkerBlobs(
        workerAudit(contract, { embeddedBody: 'wrong bytes' }),
      ),
    /differs from receipt-derived bytes/,
  );
  assert.throws(
    () =>
      validateCesiumWorkerBlobs(
        workerAudit(contract, {
          wrapper:
            'importScripts("https://provider.invalid/worker.js"); CesiumWorkers["createGeometry"]();',
        }),
      ),
    /not a validated Cesium worker/,
  );
  assert.throws(
    () =>
      validateCesiumWorkerBlobs(
        workerAudit(contract, {
          wrapper:
            '\nimportScripts("blob:http://127.0.0.1:4173/embedded-id"); CesiumWorkers["evil"]();',
        }),
      ),
    /absent from the receipt/,
  );
});

test('worker blob validator rejects escaped parents, missing records, and arbitrary observed blobs', () => {
  const contract = makeContract();
  const audit = workerAudit(contract);
  audit.blobAudit.records[0].body =
    'importScripts("blob:https://elsewhere.invalid/p"); CesiumWorkers["createGeometry"]();';
  audit.blobAudit.records[0].byteLength = Buffer.byteLength(
    audit.blobAudit.records[0].body,
  );
  audit.blobAudit.totalReadBytes = audit.blobAudit.records.reduce(
    (sum, record) => sum + record.byteLength,
    0,
  );
  assert.throws(() => validateCesiumWorkerBlobs(audit), /no captured payload/);

  const missing = workerAudit(contract);
  missing.blobAudit.records.pop();
  missing.blobAudit.createdBlobCount = 1;
  missing.blobAudit.totalReadBytes = missing.blobAudit.records.reduce(
    (sum, record) => sum + record.byteLength,
    0,
  );
  assert.throws(
    () => validateCesiumWorkerBlobs(missing),
    /no captured payload/,
  );

  const arbitrary = workerAudit(contract);
  arbitrary.observedBlobUrls.push('blob:http://127.0.0.1:4173/unrelated');
  assert.throws(
    () => validateCesiumWorkerBlobs(arbitrary),
    /not a validated Cesium worker/,
  );
});

test('worker blob validator fails closed on overflow and malformed sizes', () => {
  const contract = makeContract();
  const overflow = workerAudit(contract);
  overflow.blobAudit.overflowCount = 1;
  assert.throws(
    () => validateCesiumWorkerBlobs(overflow),
    /incomplete or over its bound/,
  );
  const wrongAggregateCap = workerAudit(contract);
  wrongAggregateCap.blobAudit.maxRetainedBytes = 8 * 1024 * 1024;
  assert.throws(
    () => validateCesiumWorkerBlobs(wrongAggregateCap),
    /incomplete or over its bound/,
  );
  const malformed = workerAudit(contract);
  malformed.blobAudit.records[0].byteLength += 1;
  assert.throws(
    () => validateCesiumWorkerBlobs(malformed),
    /byte length changed/,
  );
  const tooManyTargets = workerAudit(contract);
  tooManyTargets.workerUrls = Array.from(
    { length: 65 },
    (_, index) => `blob:http://127.0.0.1:4173/worker-${index}`,
  );
  assert.throws(
    () => validateCesiumWorkerBlobs(tooManyTargets),
    /incomplete or over its bound/,
  );
});

test('validator rejects an unobserved created script blob unrelated to a receipt worker', () => {
  const contract = makeContract();
  const audit = workerAudit(contract);
  const url = 'blob:http://127.0.0.1:4173/unrelated-script';
  const body = 'self.postMessage("unrelated");';
  audit.blobAudit.records.push({
    url,
    type: 'application/javascript',
    byteLength: Buffer.byteLength(body),
    body,
  });
  audit.blobAudit.createdBlobCount += 1;
  audit.blobAudit.totalReadBytes += Buffer.byteLength(body);
  assert.throws(
    () => validateCesiumWorkerBlobs(audit),
    /Created JavaScript blob is not a validated Cesium worker/,
  );
});

test('worker blob failure diagnostics identify unmatched evidence without exposing URLs or bodies', () => {
  const contract = makeContract();
  const audit = workerAudit(contract);
  const unmatchedUrl = 'blob:http://127.0.0.1:4173/unmatched-secret';
  const unmatchedBody = 'sensitive-worker-payload';
  audit.observedBlobUrls.push(unmatchedUrl);
  audit.blobAudit.records.push({
    url: unmatchedUrl,
    type: 'text/javascript',
    byteLength: Buffer.byteLength(unmatchedBody),
    body: unmatchedBody,
  });
  const diagnostics = summarizeCesiumWorkerBlobEvidence({
    workerUrls: audit.workerUrls,
    observedBlobUrls: audit.observedBlobUrls,
    blobAudit: audit.blobAudit,
    requests: [
      { url: unmatchedUrl, resourceType: 'script' },
      { url: unmatchedUrl, resourceType: 'worker' },
    ],
  });
  const encoded = JSON.stringify(diagnostics);
  assert.equal(diagnostics.urlValuesOmitted, true);
  assert.equal(diagnostics.blobRequestCount, 2);
  const unmatched = diagnostics.entries.find(
    (entry) => entry.bodySha256 === sha256(Buffer.from(unmatchedBody)),
  );
  assert.ok(unmatched);
  assert.equal(unmatched.creationRecordPresent, true);
  assert.equal(unmatched.type, 'text/javascript');
  assert.equal(unmatched.byteLength, Buffer.byteLength(unmatchedBody));
  assert.equal(unmatched.requestCount, 2);
  assert.deepEqual(unmatched.requestResourceTypes, ['script', 'worker']);
  assert.equal(unmatched.workerTargetHistoryMember, false);
  assert.equal(encoded.includes(unmatchedUrl), false);
  assert.equal(encoded.includes(unmatchedBody), false);
  assert.throws(
    () =>
      summarizeCesiumWorkerBlobEvidence({
        workerUrls: [],
        observedBlobUrls: [],
        blobAudit: { records: [] },
        requests: [],
        maxEntries: 65,
      }),
    /invalid/,
  );
});

test('page blob instrumentation retains bounded script blobs only and restores the native API', async () => {
  let nextId = 0;
  class TestURL {
    static createObjectURL() {
      return `blob:http://127.0.0.1:4173/test-${++nextId}`;
    }
  }
  const nativeCreateObjectURL = TestURL.createObjectURL;
  const context = vm.createContext({ window: {}, URL: TestURL, Blob });
  vm.runInContext(`(${installCesiumWorkerBlobAudit.toString()})()`, context);
  vm.runInContext(
    'URL.createObjectURL(new Blob(["worker"], { type: "application/javascript" }))',
    context,
  );
  vm.runInContext(
    'URL.createObjectURL(new Blob(["image"], { type: "image/png" }))',
    context,
  );
  const metadata = vm.runInContext(
    'window.__gevCesiumWorkerBlobAuditV1.metadata()',
    context,
  );
  assert.equal(metadata.createdBlobCount, 1);
  assert.equal(metadata.records.length, 1);
  assert.equal(metadata.records[0].type, 'application/javascript');

  vm.runInContext(
    'URL.createObjectURL(new Blob(["x".repeat(2 * 1024 * 1024 + 1)], { type: "application/javascript" }))',
    context,
  );
  assert.equal(
    vm.runInContext(
      'window.__gevCesiumWorkerBlobAuditV1.metadata().overflowCount',
      context,
    ),
    1,
  );
  vm.runInContext(
    'URL.createObjectURL(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "text/javascript" }))',
    context,
  );
  vm.runInContext(
    'URL.createObjectURL(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "application/ecmascript" }))',
    context,
  );
  vm.runInContext(
    'URL.createObjectURL(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "application/javascript" }))',
    context,
  );
  vm.runInContext(
    'URL.createObjectURL(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "application/javascript" }))',
    context,
  );
  const aggregateMetadata = vm.runInContext(
    'window.__gevCesiumWorkerBlobAuditV1.metadata()',
    context,
  );
  assert.equal(aggregateMetadata.records.length, 5);
  assert.equal(aggregateMetadata.overflowCount, 1);
  assert.equal(aggregateMetadata.maxRetainedBytes, MAX_WORKER_BLOB_TOTAL_BYTES);
  const firstRestore = JSON.parse(
    JSON.stringify(
      vm.runInContext(
        'window.__gevCesiumWorkerBlobAuditV1.restore()',
        context,
      ),
    ),
  );
  assert.equal(TestURL.createObjectURL, nativeCreateObjectURL);
  assert.deepEqual(firstRestore, {
    nativeCreateObjectURLRestored: true,
    registryEmpty: true,
    createdScriptBlobCountAtRestore: 6,
    overflowCountAtRestore: 1,
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInContext(
          'window.__gevCesiumWorkerBlobAuditV1.restore()',
          context,
        ),
      ),
    ),
    {
      nativeCreateObjectURLRestored: true,
      registryEmpty: true,
      createdScriptBlobCountAtRestore: 0,
      overflowCountAtRestore: 0,
    },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInContext(
          'window.__gevCesiumWorkerBlobAuditV1.metadata()',
          context,
        ),
      ),
    ),
    {
      createdBlobCount: 0,
      overflowCount: 0,
      maxRetainedBytes: MAX_WORKER_BLOB_TOTAL_BYTES,
      records: [],
    },
  );
});

test('worker blob instrumentation enforces the published 32 MiB aggregate cap', () => {
  class SizedBlob {
    constructor(size, type) {
      this.size = size;
      this.type = type;
    }
    async text() {
      return '';
    }
  }
  let nextId = 0;
  class TestURL {
    static createObjectURL() {
      return `blob:http://127.0.0.1:4173/sized-${++nextId}`;
    }
  }
  const context = vm.createContext({
    window: {},
    URL: TestURL,
    Blob: SizedBlob,
  });
  vm.runInContext(`(${installCesiumWorkerBlobAudit.toString()})()`, context);
  for (let index = 0; index < 16; index += 1)
    vm.runInContext(
      'URL.createObjectURL(new Blob(2097152, "application/javascript"))',
      context,
    );
  vm.runInContext(
    'URL.createObjectURL(new Blob(1, "application/javascript"))',
    context,
  );
  const metadata = JSON.parse(
    JSON.stringify(
      vm.runInContext(
        'window.__gevCesiumWorkerBlobAuditV1.metadata()',
        context,
      ),
    ),
  );
  assert.equal(MAX_WORKER_BLOB_TOTAL_BYTES, 32 * 1024 * 1024);
  assert.equal(metadata.maxRetainedBytes, MAX_WORKER_BLOB_TOTAL_BYTES);
  assert.equal(metadata.createdBlobCount, 17);
  assert.equal(metadata.records.length, 16);
  assert.equal(metadata.overflowCount, 1);
});

test('worker audit restoration reports a replaced native API and releases retained bodies', async () => {
  let nextId = 0;
  class TestURL {
    static createObjectURL() {
      return `blob:http://127.0.0.1:4173/restore-${++nextId}`;
    }
  }
  const context = vm.createContext({ window: {}, URL: TestURL, Blob });
  vm.runInContext(`(${installCesiumWorkerBlobAudit.toString()})()`, context);
  vm.runInContext(
    'URL.createObjectURL(new Blob(["worker"], { type: "application/javascript" }))',
    context,
  );
  vm.runInContext(
    'URL.createObjectURL = function substitutedCreateObjectURL() {};',
    context,
  );
  const result = JSON.parse(
    JSON.stringify(
      vm.runInContext('window.__gevCesiumWorkerBlobAuditV1.restore()', context),
    ),
  );
  assert.equal(result.nativeCreateObjectURLRestored, false);
  assert.equal(result.registryEmpty, true);
  assert.equal(result.createdScriptBlobCountAtRestore, 1);
  assert.equal(result.overflowCountAtRestore, 0);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        vm.runInContext(
          'window.__gevCesiumWorkerBlobAuditV1.metadata()',
          context,
        ),
      ),
    ),
    {
      createdBlobCount: 0,
      overflowCount: 0,
      maxRetainedBytes: MAX_WORKER_BLOB_TOTAL_BYTES,
      records: [],
    },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await vm.runInContext(
          'window.__gevCesiumWorkerBlobAuditV1.readWorkerBodies([])',
          context,
        ),
      ),
    ),
    {
      createdBlobCount: 0,
      overflowCount: 0,
      totalReadBytes: 0,
      maxRetainedBytes: MAX_WORKER_BLOB_TOTAL_BYTES,
      records: [],
    },
  );
});

test('prewarm worker inventory accepts only receipt-bound observed late code paths', async () => {
  const { validatePrewarmedWorkerUse } = await import(
    './cesiumWorkerBlobContract.mjs'
  );
  const baseUrl = 'http://127.0.0.1:4173/app/';
  const receiptSha256 = 'a'.repeat(64);
  const workerSourceSha256 = 'b'.repeat(64);
  const embedded = 'blob:http://127.0.0.1:4173/app/embedded';
  const wrapper = 'blob:http://127.0.0.1:4173/app/wrapper';
  const inventory = {
    schema: 'gev-prewarmed-worker-inventory/v1',
    status: 'receipt-derived-worker-blobs-validated',
    receiptSha256,
    workerSourceSha256,
    createdScriptBlobCount: 2,
    acceptedBlobUrls: [embedded, wrapper],
    validatedWorkerTargetUrls: [wrapper],
    restoration: {
      nativeCreateObjectURLRestored: true,
      registryEmpty: true,
      createdScriptBlobCountAtRestore: 2,
      overflowCountAtRestore: 0,
    },
  };
  const expected = {
    inventory,
    expectedReceiptSha256: receiptSha256,
    expectedWorkerSourceSha256: workerSourceSha256,
    workerUrls: [wrapper, 'http://127.0.0.1:4173/app/cesium/worker.js'],
    observedBlobUrls: [embedded, wrapper],
    baseUrl,
    expectedAssetPaths: ['cesium/worker.js'],
  };
  const checked = validatePrewarmedWorkerUse(expected);
  assert.equal(
    checked.status,
    'observed-late-code-paths-within-prewarm-inventory',
  );
  assert.equal(checked.unusedLateBlobCreationObservable, false);

  for (const [name, mutate] of [
    [
      'created count differs from accepted blob inventory',
      (input) => (input.inventory.createdScriptBlobCount = 3),
    ],
    [
      'approved target is outside accepted blobs',
      (input) => (input.inventory.validatedWorkerTargetUrls = [`${wrapper}-other`]),
    ],
    ['unknown blob request', (input) => input.observedBlobUrls.push(`${embedded}-late`)],
    ['unknown blob target', (input) => input.workerUrls.push(`${wrapper}-late`)],
    [
      'unexpected worker path',
      (input) => input.workerUrls.push('http://127.0.0.1:4173/app/unreceipted.js'),
    ],
    ['external worker target', (input) => input.workerUrls.push('https://outside.invalid/worker.js')],
    ['worker overflow', (input) => (input.workerUrlOverflow = 1)],
    ['blob overflow', (input) => (input.blobUrlOverflow = 1)],
    ['wrong receipt', (input) => (input.expectedReceiptSha256 = 'c'.repeat(64))],
    ['wrong worker source', (input) => (input.expectedWorkerSourceSha256 = 'd'.repeat(64))],
    [
      'restore count drift',
      (input) => (input.inventory.restoration.createdScriptBlobCountAtRestore = 3),
    ],
  ]) {
    const input = structuredClone(expected);
    mutate(input);
    assert.throws(
      () => validatePrewarmedWorkerUse(input),
      undefined,
      name,
    );
  }
});
