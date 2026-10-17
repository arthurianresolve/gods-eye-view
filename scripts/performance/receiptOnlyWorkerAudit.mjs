const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_PATHS = 2048;
const MAX_TARGETS = 256;

function boundedStrings(values, maximum, label) {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    values.some((value) => typeof value !== 'string' || value.length > 4096)
  )
    throw new TypeError(`${label} exceeds its bound.`);
  return [...new Set(values)].sort();
}

function isBoundedSet(values, maximum, expectedValues) {
  return (
    Array.isArray(values) &&
    values.length <= maximum &&
    values.every(
      (value) =>
        typeof value === 'string' &&
        value.length <= 4096 &&
        expectedValues.has(value),
    ) &&
    new Set(values).size === values.length
  );
}

function receiptedPath(url, baseUrl, expectedPaths) {
  let base;
  let target;
  try {
    base = new URL(baseUrl);
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.username || target.password || target.hash) return null;
  if (target.origin !== base.origin) return null;
  const prefix = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  const rootPath = prefix.slice(0, -1) || '/';
  let relativePath = '';
  if (target.pathname.startsWith(prefix)) {
    try {
      relativePath = decodeURIComponent(target.pathname.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return relativePath && expectedPaths.has(relativePath) ? relativePath : null;
}

function isSameOriginBlobUrl(value, baseUrl) {
  const url = new URL(value);
  const base = new URL(baseUrl);
  return url.protocol === 'blob:' && url.origin === base.origin;
}

/**
 * Collect receipt-only executable observations from Puppeteer page events.
 * Raw URLs remain in this bounded in-memory owner and are never serialized.
 */
export function createReceiptOnlyWorkerAuditCollector({
  baseUrl,
  expectedAssetPaths,
} = {}) {
  const expected = new Set(
    boundedStrings(expectedAssetPaths, MAX_PATHS, 'Receipt paths'),
  );
  const base = new URL(baseUrl);
  const prefix = base.pathname.endsWith('/')
    ? base.pathname
    : `${base.pathname}/`;
  const requested = new Set();
  const workers = new Set();
  const blobs = new Set();
  let unreceiptedExecutableCount = 0;
  let overflowCount = 0;

  const boundedAdd = (set, value, limit) => {
    if (set.has(value)) return;
    if (set.size >= limit) overflowCount += 1;
    else set.add(value);
  };

  const observeRequest = (request) => {
    if (!['script', 'worker', 'serviceworker'].includes(request.resourceType()))
      return;
    let url;
    try {
      url = new URL(request.url());
    } catch {
      unreceiptedExecutableCount += 1;
      return;
    }
    if (url.protocol === 'blob:') {
      if (url.origin !== base.origin) {
        unreceiptedExecutableCount += 1;
        return;
      }
      boundedAdd(blobs, url.href, MAX_TARGETS);
      return;
    }
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith(prefix)
    ) {
      unreceiptedExecutableCount += 1;
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      relative = '';
    }
    if (!relative || !expected.has(relative)) {
      unreceiptedExecutableCount += 1;
      return;
    }
    boundedAdd(requested, relative, MAX_PATHS);
  };

  const observeWorker = (worker) => {
    try {
      const url = new URL(worker.url());
      if (url.protocol === 'blob:') {
        if (url.origin !== base.origin) {
          unreceiptedExecutableCount += 1;
          return;
        }
        boundedAdd(blobs, url.href, MAX_TARGETS);
      }
      boundedAdd(workers, url.href, MAX_TARGETS);
    } catch {
      unreceiptedExecutableCount += 1;
    }
  };

  const attach = (page) => {
    if (!page || typeof page.on !== 'function')
      throw new TypeError('Receipt-only observer requires a Puppeteer page.');
    const requestListener = (request) => observeRequest(request);
    const workerListener = (worker) => observeWorker(worker);
    page.on('request', requestListener);
    page.on('workercreated', workerListener);
    let active = true;
    return () => {
      if (!active) return false;
      if (typeof page.off === 'function') {
        page.off('request', requestListener);
        page.off('workercreated', workerListener);
      } else if (typeof page.removeListener === 'function') {
        page.removeListener('request', requestListener);
        page.removeListener('workercreated', workerListener);
      } else return false;
      active = false;
      return true;
    };
  };

  return {
    attach,
    observeRequest,
    observeWorker,
    createDocument({
      documentRole,
      documentId,
      appCommit,
      harnessCommit,
      receiptSha256,
      embeddedWorkerContract,
      liveWorkers = [],
    } = {}) {
      for (const worker of liveWorkers) {
        let url;
        try {
          url = new URL(worker.url()).href;
        } catch {
          unreceiptedExecutableCount += 1;
          continue;
        }
        if (!workers.has(url)) unreceiptedExecutableCount += 1;
      }
      return createReceiptOnlyWorkerAuditDocument({
        documentRole,
        documentId,
        appCommit,
        harnessCommit,
        receiptSha256,
        baseUrl: base.href,
        expectedAssetPaths: [...expected],
        requestedAssetPaths: [...requested],
        workerTargetUrls: [...workers],
        blobRequestUrls: [...blobs],
        unreceiptedExecutableCount,
        overflowCount,
        embeddedWorkerContract,
      });
    },
    snapshot() {
      return {
        requestedAssetPaths: [...requested].sort(),
        workerTargetCount: workers.size,
        blobRequestCount: blobs.size,
        unreceiptedExecutableCount,
        overflowCount,
      };
    },
  };
}

/**
 * Project host-observed executable paths without wrapping page Blob/Worker APIs.
 * Blob worker bodies remain explicitly unattested by this mode.
 */
export function createReceiptOnlyWorkerAuditDocument({
  documentRole,
  documentId,
  appCommit,
  harnessCommit,
  receiptSha256,
  baseUrl,
  expectedAssetPaths,
  requestedAssetPaths,
  workerTargetUrls,
  blobRequestUrls,
  unreceiptedExecutableCount = 0,
  overflowCount = 0,
  embeddedWorkerContract,
} = {}) {
  if (
    typeof documentRole !== 'string' ||
    !documentRole ||
    documentRole.length > 80 ||
    typeof documentId !== 'string' ||
    !documentId ||
    documentId.length > 160 ||
    !SHA1.test(appCommit || '') ||
    !SHA1.test(harnessCommit || '') ||
    !SHA256.test(receiptSha256 || '')
  )
    throw new TypeError('Receipt-only worker audit identity is invalid.');
  if (
    !Number.isSafeInteger(unreceiptedExecutableCount) ||
    unreceiptedExecutableCount < 0
  )
    throw new TypeError('Unreceipted executable request count is invalid.');
  if (!Number.isSafeInteger(overflowCount) || overflowCount < 0)
    throw new TypeError('Receipt-only worker audit overflow is invalid.');
  if (unreceiptedExecutableCount || overflowCount)
    throw new Error(
      'Unreceipted executable requests or audit overflow were observed.',
    );

  const expected = boundedStrings(
    expectedAssetPaths,
    MAX_PATHS,
    'Receipt paths',
  );
  const requested = boundedStrings(
    requestedAssetPaths,
    MAX_PATHS,
    'Requested paths',
  );
  const workers = boundedStrings(
    workerTargetUrls,
    MAX_TARGETS,
    'Worker targets',
  );
  const blobs = boundedStrings(blobRequestUrls, MAX_TARGETS, 'Blob requests');
  const expectedSet = new Set(expected);
  if (!expectedSet.has('index.html'))
    throw new Error('Receipt-only worker audit requires receipted index.html.');
  if (!requested.some((assetPath) => expectedSet.has(assetPath)))
    throw new Error('No receipted executable asset request was observed.');
  if (requested.some((assetPath) => !expectedSet.has(assetPath)))
    throw new Error(
      'An executable asset request was outside the build receipt.',
    );
  const workerAssetPaths = new Set();
  let blobWorkerTargetCount = 0;
  for (const target of workers) {
    if (isSameOriginBlobUrl(target, baseUrl)) {
      blobWorkerTargetCount += 1;
      continue;
    }
    const workerPath = receiptedPath(target, baseUrl, expectedSet);
    if (!workerPath)
      throw new Error(
        'A worker target was outside the receipted application origin.',
      );
    workerAssetPaths.add(workerPath);
  }
  for (const blobUrl of blobs) {
    if (!isSameOriginBlobUrl(blobUrl, baseUrl))
      throw new Error(
        'A Blob executable request was outside the application origin.',
      );
  }
  if (
    embeddedWorkerContract?.schema !==
      'gev-cesium-embedded-worker-contract/v1' ||
    embeddedWorkerContract.bundlePath !== 'cesium/Cesium.js' ||
    !SHA256.test(embeddedWorkerContract.bundleSha256 || '') ||
    !SHA256.test(embeddedWorkerContract.workerSourceSha256 || '') ||
    !Number.isSafeInteger(embeddedWorkerContract.allowedModuleCount) ||
    embeddedWorkerContract.allowedModuleCount < 1 ||
    embeddedWorkerContract.allowedModuleCount > MAX_PATHS
  )
    throw new Error(
      'Receipt-derived Cesium worker source identity is unavailable.',
    );

  return {
    schema: 'gev-receipt-only-worker-audit-document/v1',
    status: 'receipt-paths-validated-live-worker-body-unattested',
    documentRole,
    documentId,
    provenance: { appCommit, harnessCommit, receiptSha256 },
    requestedAssetPaths: requested,
    workerTargets: {
      count: workers.length,
      blobCount: blobWorkerTargetCount,
      receiptedAssetPaths: [...workerAssetPaths].sort(),
    },
    blobRequestCount: blobs.length,
    workerSource: {
      derivation: 'receipt-embedded-cesium-bundle',
      bundlePath: embeddedWorkerContract.bundlePath,
      bundleSha256: embeddedWorkerContract.bundleSha256,
      workerSourceSha256: embeddedWorkerContract.workerSourceSha256,
      allowedModuleCount: embeddedWorkerContract.allowedModuleCount,
      liveBlobBodyAttestation: 'unavailable-by-design',
    },
    pageInstrumentation: {
      createObjectUrlWrapped: false,
      workerApiWrapped: false,
      blobBodyRegistryInstalled: false,
      debuggerAttached: false,
      profilerEnabled: false,
      observation: 'external-puppeteer-request-and-worker-target-events-only',
    },
  };
}

function validDocument(document, expected) {
  return (
    document?.schema === 'gev-receipt-only-worker-audit-document/v1' &&
    document.status === 'receipt-paths-validated-live-worker-body-unattested' &&
    document.documentRole === expected.documentRole &&
    document.documentId === expected.documentId &&
    document.provenance?.appCommit === expected.appCommit &&
    document.provenance?.harnessCommit === expected.harnessCommit &&
    document.provenance?.receiptSha256 === expected.receiptSha256 &&
    isBoundedSet(
      document.requestedAssetPaths,
      MAX_PATHS,
      expected.assetPaths,
    ) &&
    document.requestedAssetPaths.length > 0 &&
    document.workerTargets &&
    Number.isSafeInteger(document.workerTargets.count) &&
    document.workerTargets.count >= 0 &&
    document.workerTargets.count <= MAX_TARGETS &&
    Number.isSafeInteger(document.workerTargets.blobCount) &&
    document.workerTargets.blobCount >= 0 &&
    document.workerTargets.blobCount <= MAX_TARGETS &&
    document.workerTargets.blobCount <= document.workerTargets.count &&
    isBoundedSet(
      document.workerTargets.receiptedAssetPaths,
      MAX_PATHS,
      expected.assetPaths,
    ) &&
    Number.isSafeInteger(document.blobRequestCount) &&
    document.blobRequestCount >= 0 &&
    document.blobRequestCount <= MAX_TARGETS &&
    document.workerSource?.derivation === 'receipt-embedded-cesium-bundle' &&
    document.workerSource?.bundlePath === 'cesium/Cesium.js' &&
    document.workerSource?.bundleSha256 === expected.bundleSha256 &&
    document.workerSource?.workerSourceSha256 === expected.workerSourceSha256 &&
    document.workerSource?.allowedModuleCount === expected.allowedModuleCount &&
    document.workerSource?.liveBlobBodyAttestation ===
      'unavailable-by-design' &&
    document.pageInstrumentation?.createObjectUrlWrapped === false &&
    document.pageInstrumentation?.workerApiWrapped === false &&
    document.pageInstrumentation?.blobBodyRegistryInstalled === false &&
    document.pageInstrumentation?.debuggerAttached === false &&
    document.pageInstrumentation?.profilerEnabled === false &&
    document.pageInstrumentation?.observation ===
      'external-puppeteer-request-and-worker-target-events-only'
  );
}

/** Validate receipt-only evidence against exact app, harness, receipt and docs. */
export function validateReceiptOnlyWorkerAuditEnvelope({
  pageAssetAudit,
  appCommit,
  harnessCommit,
  receiptSha256,
  expectedDocuments,
  expectedAssetPaths,
  bundleSha256,
  workerSourceSha256,
  allowedModuleCount,
} = {}) {
  if (
    pageAssetAudit?.schema !== 'gev-receipt-only-worker-audit/v1' ||
    pageAssetAudit.status !== 'all-document-receipt-paths-validated' ||
    pageAssetAudit.workerAuditMode !== 'receipt-only' ||
    pageAssetAudit.appCommit !== appCommit ||
    pageAssetAudit.harnessCommit !== harnessCommit ||
    pageAssetAudit.receiptSha256 !== receiptSha256 ||
    !SHA1.test(appCommit || '') ||
    !SHA1.test(harnessCommit || '') ||
    !SHA256.test(receiptSha256 || '') ||
    !SHA256.test(bundleSha256 || '') ||
    !SHA256.test(workerSourceSha256 || '') ||
    !Number.isSafeInteger(allowedModuleCount) ||
    allowedModuleCount < 1 ||
    allowedModuleCount > MAX_PATHS ||
    !Array.isArray(expectedDocuments) ||
    expectedDocuments.length < 1 ||
    expectedDocuments.length > 64 ||
    expectedDocuments.some(
      (document) =>
        typeof document?.documentRole !== 'string' ||
        !document.documentRole ||
        document.documentRole.length > 80 ||
        typeof document?.documentId !== 'string' ||
        !document.documentId ||
        document.documentId.length > 160,
    ) ||
    !Array.isArray(pageAssetAudit.workerAuditDocuments) ||
    pageAssetAudit.workerAuditDocuments.length !== expectedDocuments.length ||
    !Number.isSafeInteger(pageAssetAudit.scriptRequestCount) ||
    pageAssetAudit.scriptRequestCount < 1
  )
    return false;
  let assetPaths;
  try {
    assetPaths = new Set(
      boundedStrings(expectedAssetPaths, MAX_PATHS, 'Receipt paths'),
    );
  } catch {
    return false;
  }
  if (
    !assetPaths.has('index.html') ||
    !isBoundedSet(pageAssetAudit.loadedAssetPaths, MAX_PATHS, assetPaths) ||
    pageAssetAudit.unexpectedAssetPaths?.length !== 0 ||
    pageAssetAudit.liveBlobBodyAttestation !== 'unavailable-by-design' ||
    pageAssetAudit.pageInstrumentation?.createObjectUrlWrapped !== false ||
    pageAssetAudit.pageInstrumentation?.workerApiWrapped !== false ||
    pageAssetAudit.pageInstrumentation?.blobBodyRegistryInstalled !== false ||
    pageAssetAudit.pageInstrumentation?.debuggerAttached !== false ||
    pageAssetAudit.pageInstrumentation?.profilerEnabled !== false ||
    pageAssetAudit.pageInstrumentation?.observation !==
      'external-puppeteer-request-and-worker-target-events-only' ||
    pageAssetAudit.workerSource?.derivation !==
      'receipt-embedded-cesium-bundle' ||
    pageAssetAudit.workerSource?.bundlePath !== 'cesium/Cesium.js' ||
    pageAssetAudit.workerSource?.bundleSha256 !== bundleSha256 ||
    pageAssetAudit.workerSource?.workerSourceSha256 !== workerSourceSha256 ||
    pageAssetAudit.workerSource?.allowedModuleCount !== allowedModuleCount
  )
    return false;
  const expectedByIdentity = new Map(
    expectedDocuments.map((document) => [
      `${document.documentRole}\u0000${document.documentId}`,
      document,
    ]),
  );
  if (expectedByIdentity.size !== expectedDocuments.length) return false;
  const seen = new Set();
  for (const document of pageAssetAudit.workerAuditDocuments) {
    const key = `${document?.documentRole}\u0000${document?.documentId}`;
    const expected = expectedByIdentity.get(key);
    if (
      !expected ||
      seen.has(key) ||
      !validDocument(document, {
        ...expected,
        appCommit,
        harnessCommit,
        receiptSha256,
        assetPaths,
        bundleSha256,
        workerSourceSha256,
        allowedModuleCount,
      })
    )
      return false;
    seen.add(key);
  }
  return seen.size === expectedByIdentity.size;
}
