import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const EMBEDDED_WORKER_PATTERN =
  /globalThis\.CESIUM_WORKERS=atob\("([A-Za-z0-9+/=]+)"\)/g;
const WORKER_MODULE_ID = /^[A-Za-z0-9_$-]{1,160}$/;
const WORKER_WRAPPER =
  /^\s*importScripts\((["'])(blob:[^"'\r\n]+)\1\);\s*CesiumWorkers\[("|')([A-Za-z0-9_$-]+)\3\]\(\);\s*$/;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_EMBEDDED_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_WORKER_BLOB_RECORDS = 128;
export const MAX_WORKER_TARGETS = 64;
export const MAX_WORKER_BLOB_BYTES = 2 * 1024 * 1024;
export const MAX_WORKER_BLOB_TOTAL_BYTES = 32 * 1024 * 1024;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function validateRelativePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new TypeError('Cesium bundle receipt path is invalid.');
  return value;
}

/** Derive the worker source and module names from receipt-backed Cesium assets. */
export function deriveCesiumEmbeddedWorkerContract({
  bundlePath,
  bundleBytes,
  assets,
} = {}) {
  validateRelativePath(bundlePath);
  if (!Buffer.isBuffer(bundleBytes) || bundleBytes.length > MAX_BUNDLE_BYTES)
    throw new Error('Receipted Cesium bundle is missing or exceeds its bound.');
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > 2048)
    throw new Error('Cesium receipt asset list is invalid.');
  const matchingBundle = assets.filter((asset) => asset?.path === bundlePath);
  if (matchingBundle.length !== 1)
    throw new Error('Cesium bundle is not uniquely present in the receipt.');
  const receiptBundle = matchingBundle[0];
  if (
    receiptBundle.bytes !== bundleBytes.length ||
    receiptBundle.sha256 !== sha256(bundleBytes)
  )
    throw new Error('Cesium bundle bytes do not match the build receipt.');

  const bundleText = bundleBytes.toString('utf8');
  const matches = [...bundleText.matchAll(EMBEDDED_WORKER_PATTERN)];
  if (matches.length !== 1)
    throw new Error('Cesium bundle has no unique embedded worker payload.');
  const encoded = matches[0][1];
  if (
    encoded.length > Math.ceil(MAX_EMBEDDED_SOURCE_BYTES / 3) * 4 ||
    encoded.length % 4 !== 0
  )
    throw new Error('Embedded Cesium worker payload exceeds its bound.');
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.length < 1 ||
    decoded.length > MAX_EMBEDDED_SOURCE_BYTES ||
    decoded.toString('base64') !== encoded
  )
    throw new Error('Embedded Cesium worker payload is not canonical base64.');

  // Cesium calls atob(), then constructs a Blob from that Latin-1 string.
  // Blob string parts are UTF-8 encoded, so hash the exact resulting bytes.
  const embeddedWorkerBytes = Buffer.from(decoded.toString('latin1'), 'utf8');
  const embeddedWorkerSource = embeddedWorkerBytes.toString('utf8');
  const workersPrefix = `${bundlePath.slice(0, bundlePath.lastIndexOf('/') + 1)}Workers/`;
  const workerIds = new Set();
  for (const asset of assets) {
    if (
      typeof asset?.path !== 'string' ||
      !asset.path.startsWith(workersPrefix)
    )
      continue;
    const relative = asset.path.slice(workersPrefix.length);
    if (!/^[A-Za-z0-9_$-]{1,160}\.js$/.test(relative)) continue;
    if (
      !Number.isInteger(asset.bytes) ||
      asset.bytes < 0 ||
      !SHA256.test(asset.sha256 || '')
    )
      throw new Error('Receipted Cesium worker asset metadata is invalid.');
    workerIds.add(relative.slice(0, -3));
  }
  if (workerIds.size < 1 || workerIds.size > 512)
    throw new Error('Receipted Cesium worker module list is invalid.');

  return {
    schema: 'gev-cesium-embedded-worker-contract/v1',
    bundlePath,
    bundleSha256: receiptBundle.sha256,
    workerSourceSha256: sha256(embeddedWorkerBytes),
    workerSourceBytes: embeddedWorkerBytes.length,
    embeddedWorkerSource,
    allowedModuleIds: [...workerIds].sort(),
    maxBlobRecords: MAX_WORKER_BLOB_RECORDS,
    maxWorkerTargets: MAX_WORKER_TARGETS,
    maxBlobBytes: MAX_WORKER_BLOB_BYTES,
    maxTotalBlobBytes: MAX_WORKER_BLOB_TOTAL_BYTES,
  };
}

/** Install a bounded creation-time registry; returns worker bodies only on demand. */
export function installCesiumWorkerBlobAudit() {
  const key = '__gevCesiumWorkerBlobAuditV1';
  const maxRetainedBytes = 32 * 1024 * 1024;
  if (window[key]) return;
  const nativeCreateObjectURL = URL.createObjectURL;
  if (typeof nativeCreateObjectURL !== 'function')
    throw new Error('URL.createObjectURL is unavailable for worker audit.');
  const records = [];
  const byUrl = new Map();
  let createdScriptBlobCount = 0;
  let retainedBytes = 0;
  let overflowCount = 0;
  const wrappedCreateObjectURL = function (blob) {
    const url = Reflect.apply(nativeCreateObjectURL, this, [blob]);
    if (
      blob instanceof Blob &&
      /^(?:application|text)\/(?:javascript|ecmascript)$/i.test(blob.type)
    ) {
      createdScriptBlobCount += 1;
      if (
        records.length >= 128 ||
        blob.size > 2 * 1024 * 1024 ||
        retainedBytes + blob.size > maxRetainedBytes
      )
        overflowCount += 1;
      else {
        const record = {
          url,
          type: String(blob.type || ''),
          byteLength: blob.size,
          blob,
        };
        records.push(record);
        byUrl.set(url, record);
        retainedBytes += blob.size;
      }
    }
    return url;
  };
  const restoreAudit = () => {
    const createdScriptBlobCountAtRestore = createdScriptBlobCount;
    const overflowCountAtRestore = overflowCount;
    if (URL.createObjectURL === wrappedCreateObjectURL)
      URL.createObjectURL = nativeCreateObjectURL;
    records.length = 0;
    byUrl.clear();
    createdScriptBlobCount = 0;
    retainedBytes = 0;
    overflowCount = 0;
    return {
      nativeCreateObjectURLRestored:
        URL.createObjectURL === nativeCreateObjectURL,
      registryEmpty:
        records.length === 0 &&
        byUrl.size === 0 &&
        retainedBytes === 0 &&
        createdScriptBlobCount === 0 &&
        overflowCount === 0,
      createdScriptBlobCountAtRestore,
      overflowCountAtRestore,
    };
  };
  URL.createObjectURL = wrappedCreateObjectURL;
  Object.defineProperty(window, key, {
    configurable: false,
    enumerable: false,
    value: {
      metadata() {
        return {
          createdBlobCount: createdScriptBlobCount,
          overflowCount,
          maxRetainedBytes,
          records: records.map(({ url, type, byteLength }) => ({
            url,
            type,
            byteLength,
          })),
        };
      },
      async readWorkerBodies(workerUrls) {
        if (!Array.isArray(workerUrls) || workerUrls.length > 64)
          throw new Error('Worker target list exceeds its audit bound.');
        const requested = new Set(workerUrls);
        const output = [];
        let totalBytes = 0;
        const include = async (url) => {
          if (output.some((entry) => entry.url === url)) return;
          const record = byUrl.get(url);
          if (!record) throw new Error('Worker blob body was not captured.');
          if (
            !Number.isInteger(record.byteLength) ||
            record.byteLength < 0 ||
            record.byteLength > 2 * 1024 * 1024 ||
            totalBytes + record.byteLength > maxRetainedBytes
          )
            throw new Error('Worker blob body exceeds its audit bound.');
          totalBytes += record.byteLength;
          output.push({
            url: record.url,
            type: record.type,
            byteLength: record.byteLength,
            body: await record.blob.text(),
          });
        };
        for (const url of requested) {
          await include(url);
        }
        for (const record of records) await include(record.url);
        return {
          createdBlobCount: createdScriptBlobCount,
          overflowCount,
          totalReadBytes: totalBytes,
          maxRetainedBytes,
          records: output,
        };
      },
      async readAndRestoreWorkerBodies(workerUrls) {
        if (!Array.isArray(workerUrls) || workerUrls.length > 64)
          throw new Error('Worker target list exceeds its audit bound.');
        // Freeze creation-time metadata and body references synchronously,
        // then detach the observer before the first asynchronous Blob read.
        const frozenRecords = records.slice();
        const frozenCreatedBlobCount = createdScriptBlobCount;
        const frozenOverflowCount = overflowCount;
        const frozenByUrl = new Map(
          frozenRecords.map((record) => [record.url, record]),
        );
        const requested = new Set(workerUrls);
        const restoration = restoreAudit();
        const output = [];
        let totalBytes = 0;
        let readError = false;
        try {
          for (const url of requested) {
            if (!frozenByUrl.has(url))
              throw new Error('Worker blob body was not captured.');
          }
          const include = async (url) => {
            if (output.some((entry) => entry.url === url)) return;
            const record = frozenByUrl.get(url);
            if (!record) throw new Error('Worker blob body was not captured.');
            if (
              !Number.isInteger(record.byteLength) ||
              record.byteLength < 0 ||
              record.byteLength > 2 * 1024 * 1024 ||
              totalBytes + record.byteLength > maxRetainedBytes
            )
              throw new Error('Worker blob body exceeds its audit bound.');
            totalBytes += record.byteLength;
            output.push({
              url: record.url,
              type: record.type,
              byteLength: record.byteLength,
              body: await record.blob.text(),
            });
          };
          for (const url of requested) await include(url);
          for (const record of frozenRecords) await include(record.url);
        } catch {
          output.length = 0;
          totalBytes = 0;
          readError = true;
        } finally {
          frozenRecords.length = 0;
          frozenByUrl.clear();
          requested.clear();
        }
        return {
          createdBlobCount: frozenCreatedBlobCount,
          overflowCount: frozenOverflowCount,
          totalReadBytes: totalBytes,
          maxRetainedBytes,
          records: output,
          readError,
          restoration,
        };
      },
      reset() {
        records.length = 0;
        byUrl.clear();
        createdScriptBlobCount = 0;
        retainedBytes = 0;
        overflowCount = 0;
      },
      restore() {
        return restoreAudit();
      },
    },
  });
}

export function resetCesiumWorkerBlobAudit() {
  window.__gevCesiumWorkerBlobAuditV1?.reset();
}

export function restoreCesiumWorkerBlobAudit() {
  const audit = window.__gevCesiumWorkerBlobAuditV1;
  return audit
    ? audit.restore()
    : {
        nativeCreateObjectURLRestored: false,
        registryEmpty: true,
        createdScriptBlobCountAtRestore: 0,
        overflowCountAtRestore: 0,
      };
}

/** Read frozen prewarm bodies through Puppeteer's page boundary. */
export function readAndRestoreCesiumWorkerBodies(auditPage, workerUrls) {
  if (!auditPage || typeof auditPage.evaluate !== 'function')
    throw new TypeError('A browser page is required for the worker audit.');
  return auditPage.evaluate((urls) => {
    const audit = window.__gevCesiumWorkerBlobAuditV1;
    if (!audit) return null;
    return audit.readAndRestoreWorkerBodies(urls);
  }, workerUrls);
}

/** Return bounded, URL-free metadata to diagnose a failed worker-blob audit. */
export function summarizeCesiumWorkerBlobEvidence({
  workerUrls = [],
  observedBlobUrls = [],
  blobAudit,
  requests = [],
  maxEntries = 32,
} = {}) {
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 64 ||
    !Array.isArray(workerUrls) ||
    !Array.isArray(observedBlobUrls) ||
    !Array.isArray(blobAudit?.records) ||
    !Array.isArray(requests)
  )
    throw new TypeError('Worker blob diagnostic inputs are invalid.');

  const workerSet = new Set(workerUrls);
  const records = new Map(
    blobAudit.records.map((record) => [record.url, record]),
  );
  const requestCounts = new Map();
  let blobRequestCount = 0;
  for (const request of requests) {
    if (!request?.url?.startsWith('blob:')) continue;
    blobRequestCount += 1;
    const current = requestCounts.get(request.url) || {
      count: 0,
      resourceTypes: new Set(),
    };
    current.count += 1;
    if (typeof request.resourceType === 'string')
      current.resourceTypes.add(request.resourceType.slice(0, 24));
    requestCounts.set(request.url, current);
  }

  const urls = [
    ...new Set([
      ...observedBlobUrls,
      ...workerUrls,
      ...blobAudit.records
        .map((record) => record?.url)
        .filter((url) => typeof url === 'string'),
    ]),
  ];
  const entries = urls.slice(0, maxEntries).map((url, index) => {
    const record = records.get(url);
    const body =
      typeof record?.body === 'string' ? Buffer.from(record.body) : null;
    const request = requestCounts.get(url);
    return {
      index,
      creationRecordPresent: Boolean(record),
      type: typeof record?.type === 'string' ? record.type.slice(0, 64) : null,
      byteLength: Number.isSafeInteger(record?.byteLength)
        ? record.byteLength
        : null,
      bodySha256: body ? sha256(body) : null,
      requestCount: request?.count || 0,
      requestResourceTypes: [...(request?.resourceTypes || [])]
        .sort()
        .slice(0, 8),
      workerTargetHistoryMember: workerSet.has(url),
    };
  });
  return {
    schema: 'gev-cesium-worker-blob-diagnostics/v1',
    urlValuesOmitted: true,
    retentionByteCapBytes: blobAudit.maxRetainedBytes ?? null,
    blobRequestCount,
    observedBlobCount: urls.length,
    entryCount: entries.length,
    omittedEntryCount: Math.max(0, urls.length - entries.length),
    entries,
  };
}

/** Validate created worker source/wrappers separately from observed worker targets. */
export function validateCesiumWorkerBlobs({
  contract,
  baseUrl,
  workerUrls,
  observedBlobUrls = [],
  blobAudit,
  auditMode = 'diagnostic',
} = {}) {
  if (!['diagnostic', 'prewarm'].includes(auditMode))
    throw new TypeError('Worker blob audit mode is invalid.');
  if (
    contract?.schema !== 'gev-cesium-embedded-worker-contract/v1' ||
    !SHA256.test(contract.workerSourceSha256 || '') ||
    !Array.isArray(contract.allowedModuleIds) ||
    contract.allowedModuleIds.length < 1
  )
    throw new TypeError('Receipt-derived Cesium worker contract is required.');
  if (
    !Array.isArray(workerUrls) ||
    workerUrls.length > MAX_WORKER_TARGETS ||
    !Array.isArray(observedBlobUrls) ||
    observedBlobUrls.length > MAX_WORKER_BLOB_RECORDS ||
    blobAudit?.overflowCount !== 0 ||
    !Number.isInteger(blobAudit?.createdBlobCount) ||
    blobAudit.createdBlobCount < 1 ||
    blobAudit.createdBlobCount > MAX_WORKER_BLOB_RECORDS ||
    blobAudit.maxRetainedBytes !== MAX_WORKER_BLOB_TOTAL_BYTES ||
    !Array.isArray(blobAudit.records) ||
    blobAudit.records.length > MAX_WORKER_BLOB_RECORDS
  )
    throw new Error(
      'Observed Cesium worker blob inventory is incomplete or over its bound.',
    );

  const base = new URL(baseUrl);
  const records = new Map();
  let totalBytes = 0;
  for (const record of blobAudit.records) {
    if (
      typeof record?.url !== 'string' ||
      typeof record.type !== 'string' ||
      typeof record.body !== 'string' ||
      !Number.isInteger(record.byteLength) ||
      record.byteLength < 0 ||
      record.byteLength > MAX_WORKER_BLOB_BYTES ||
      records.has(record.url)
    )
      throw new Error('Observed Cesium worker blob record is invalid.');
    const bodyBytes = Buffer.from(record.body, 'utf8');
    if (bodyBytes.length !== record.byteLength)
      throw new Error('Observed Cesium worker blob byte length changed.');
    totalBytes += bodyBytes.length;
    if (totalBytes > MAX_WORKER_BLOB_TOTAL_BYTES)
      throw new Error(
        'Observed Cesium worker blobs exceed the total byte bound.',
      );
    records.set(record.url, {
      ...record,
      bodyBytes,
      sha256: sha256(bodyBytes),
    });
  }
  if (
    !Number.isInteger(blobAudit.totalReadBytes) ||
    blobAudit.totalReadBytes !== totalBytes ||
    blobAudit.createdBlobCount !== records.size
  )
    throw new Error('Observed Cesium worker blob metadata is inconsistent.');

  const allowedModules = new Set(contract.allowedModuleIds);
  const accepted = new Set();
  const acceptedModules = new Set();
  const wrapperHashes = new Set();
  const wrappers = new Map();

  // Validate every creation record independently. Target publication is
  // asynchronous, so a valid Cesium worker wrapper can exist before Puppeteer
  // emits workercreated (or before Cesium starts it at all).
  for (const record of records.values()) {
    const url = new URL(record.url);
    if (url.protocol !== 'blob:' || url.origin !== base.origin)
      throw new Error('Created Cesium worker blob has an unexpected origin.');
    if (record.type !== 'application/javascript')
      throw new Error(
        'Created Cesium worker blob has an unexpected MIME type.',
      );
    if (
      record.body === contract.embeddedWorkerSource &&
      record.sha256 === contract.workerSourceSha256
    ) {
      accepted.add(record.url);
      continue;
    }

    const wrapper = record.body.match(WORKER_WRAPPER);
    if (!wrapper)
      throw new Error(
        'Created JavaScript blob is not a validated Cesium worker.',
      );
    const embeddedUrl = wrapper[2];
    const moduleId = wrapper[4];
    if (!WORKER_MODULE_ID.test(moduleId) || !allowedModules.has(moduleId))
      throw new Error(
        'Created Cesium worker module is absent from the receipt.',
      );
    const embeddedUrlRecord = records.get(embeddedUrl);
    if (!embeddedUrlRecord)
      throw new Error('Created Cesium worker wrapper has no captured payload.');
    const embeddedParsedUrl = new URL(embeddedUrl);
    if (
      embeddedParsedUrl.protocol !== 'blob:' ||
      embeddedParsedUrl.origin !== base.origin
    )
      throw new Error(
        'Created Cesium embedded worker payload has an unexpected origin.',
      );
    if (
      embeddedUrlRecord.type !== 'application/javascript' ||
      embeddedUrlRecord.body !== contract.embeddedWorkerSource ||
      embeddedUrlRecord.sha256 !== contract.workerSourceSha256
    )
      throw new Error(
        'Created Cesium embedded worker payload differs from receipt-derived bytes.',
      );
    wrappers.set(record.url, { moduleId, sha256: record.sha256 });
    accepted.add(record.url);
    accepted.add(embeddedUrl);
    acceptedModules.add(moduleId);
    wrapperHashes.add(record.sha256);
  }

  const targetUrls = new Set(workerUrls);
  for (const workerUrl of targetUrls) {
    const workerRecord = records.get(workerUrl);
    if (!workerRecord)
      throw new Error('Observed Cesium worker target has no captured blob.');
    const url = new URL(workerUrl);
    if (url.protocol !== 'blob:' || url.origin !== base.origin)
      throw new Error(
        'Observed Cesium worker target has an unexpected origin.',
      );
    if (!wrappers.has(workerUrl))
      throw new Error(
        'Observed Cesium worker target is not a validated wrapper.',
      );
  }
  for (const url of observedBlobUrls) {
    if (!accepted.has(url))
      throw new Error('Observed code blob is not a validated Cesium worker.');
  }
  for (const url of records.keys()) {
    if (!accepted.has(url))
      throw new Error(
        'Created JavaScript blob is not a validated Cesium worker.',
      );
  }
  return {
    acceptedBlobUrls: [...accepted],
    validatedWorkerTargetUrls: [...wrappers.keys()],
    observation: {
      schema: 'gev-cesium-worker-blob-audit/v1',
      status: 'receipt-derived-worker-blobs-validated',
      auditMode,
      instrumentation:
        auditMode === 'prewarm'
          ? 'prewarm URL.createObjectURL observer restored before warmup'
          : 'URL.createObjectURL creation observer; smoke-only diagnostic',
      createdScriptBlobCount: blobAudit.createdBlobCount,
      validatedWorkerCount: new Set(workerUrls).size,
      validatedCreatedWrapperCount: wrappers.size,
      unobservedCreatedWrapperCount: [...wrappers.keys()].filter(
        (url) => !targetUrls.has(url),
      ).length,
      validatedEmbeddedSourceCount: [...accepted].filter(
        (url) => records.get(url)?.body === contract.embeddedWorkerSource,
      ).length,
      validatedModuleIds: [...acceptedModules].sort(),
      embeddedWorkerSourceSha256: contract.workerSourceSha256,
      scriptBlobSha256: [...records.values()]
        .map((record) => record.sha256)
        .sort(),
      validatedWrapperSha256: [...wrapperHashes].sort(),
      readBytes: blobAudit.totalReadBytes,
      retentionByteCapBytes: blobAudit.maxRetainedBytes,
    },
  };
}

/** Validate only late code paths observed after the creation audit is restored. */
export function validatePrewarmedWorkerUse({
  inventory,
  expectedReceiptSha256,
  expectedWorkerSourceSha256,
  workerUrls = [],
  observedBlobUrls = [],
  workerUrlOverflow = 0,
  blobUrlOverflow = 0,
  baseUrl,
  expectedAssetPaths = [],
} = {}) {
  if (
    !SHA256.test(expectedReceiptSha256 || '') ||
    !SHA256.test(expectedWorkerSourceSha256 || '') ||
    inventory?.schema !== 'gev-prewarmed-worker-inventory/v1' ||
    inventory.status !== 'receipt-derived-worker-blobs-validated' ||
    inventory.receiptSha256 !== expectedReceiptSha256 ||
    inventory.workerSourceSha256 !== expectedWorkerSourceSha256 ||
    inventory.restoration?.nativeCreateObjectURLRestored !== true ||
    inventory.restoration?.registryEmpty !== true ||
    inventory.restoration?.createdScriptBlobCountAtRestore !==
      inventory.createdScriptBlobCount ||
    inventory.restoration?.overflowCountAtRestore !== 0 ||
    !Number.isInteger(inventory.createdScriptBlobCount) ||
    inventory.createdScriptBlobCount < 1 ||
    inventory.createdScriptBlobCount > MAX_WORKER_BLOB_RECORDS ||
    !Array.isArray(inventory.acceptedBlobUrls) ||
    inventory.acceptedBlobUrls.length < 1 ||
    inventory.acceptedBlobUrls.length !== inventory.createdScriptBlobCount ||
    inventory.acceptedBlobUrls.length > MAX_WORKER_BLOB_RECORDS ||
    !Array.isArray(inventory.validatedWorkerTargetUrls) ||
    inventory.validatedWorkerTargetUrls.length > MAX_WORKER_TARGETS ||
    !Array.isArray(workerUrls) ||
    workerUrls.length > MAX_WORKER_TARGETS ||
    !Array.isArray(observedBlobUrls) ||
    observedBlobUrls.length > MAX_WORKER_BLOB_RECORDS ||
    !Array.isArray(expectedAssetPaths) ||
    !Number.isInteger(workerUrlOverflow) ||
    workerUrlOverflow < 0 ||
    !Number.isInteger(blobUrlOverflow) ||
    blobUrlOverflow < 0
  )
    throw new Error('Prewarm worker inventory or late audit is incomplete.');
  if (workerUrlOverflow || blobUrlOverflow)
    throw new Error('Late worker audit exceeded its bounded capacity.');

  const base = new URL(baseUrl);
  const acceptedBlobs = new Set(inventory.acceptedBlobUrls);
  const approvedTargets = new Set(inventory.validatedWorkerTargetUrls);
  const expectedAssets = new Set(expectedAssetPaths);
  if (
    acceptedBlobs.size !== inventory.acceptedBlobUrls.length ||
    approvedTargets.size !== inventory.validatedWorkerTargetUrls.length
  )
    throw new Error('Prewarm worker inventory contains duplicate URLs.');
  for (const target of approvedTargets) {
    if (!acceptedBlobs.has(target))
      throw new Error('Prewarm worker target is outside its blob inventory.');
  }
  for (const value of [...acceptedBlobs, ...approvedTargets]) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Prewarm worker inventory contains an invalid URL.');
    }
    if (parsed.protocol !== 'blob:' || parsed.origin !== base.origin)
      throw new Error('Prewarm worker inventory contains an unexpected URL.');
  }

  for (const blobUrl of observedBlobUrls) {
    if (!acceptedBlobs.has(blobUrl))
      throw new Error('Late code request used a non-prewarmed blob URL.');
  }
  for (const workerUrl of workerUrls) {
    let parsed;
    try {
      parsed = new URL(workerUrl);
    } catch {
      throw new Error('Late worker target has an invalid URL.');
    }
    if (parsed.protocol === 'blob:') {
      if (!approvedTargets.has(workerUrl))
        throw new Error('Late worker target is not a prewarmed wrapper.');
      continue;
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== base.origin ||
      parsed.username ||
      parsed.password
    )
      throw new Error('Late worker target is outside the verified origin.');
    let relativePath = '';
    const prefix = base.pathname.endsWith('/')
      ? base.pathname
      : `${base.pathname}/`;
    if (parsed.pathname.startsWith(prefix)) {
      try {
        relativePath = decodeURIComponent(parsed.pathname.slice(prefix.length));
      } catch {
        relativePath = '';
      }
    }
    if (!relativePath || !expectedAssets.has(relativePath))
      throw new Error(
        'Late worker target is not in the verified build receipt.',
      );
  }
  return {
    schema: 'gev-prewarmed-worker-use/v1',
    status: 'observed-late-code-paths-within-prewarm-inventory',
    observedWorkerTargetCount: workerUrls.length,
    observedBlobRequestCount: observedBlobUrls.length,
    receiptSha256: inventory.receiptSha256,
    workerSourceSha256: inventory.workerSourceSha256,
    workerTargetOverflowCount: workerUrlOverflow,
    blobRequestOverflowCount: blobUrlOverflow,
    unusedLateBlobCreationObservable: false,
  };
}
