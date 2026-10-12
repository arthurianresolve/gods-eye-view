import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SCRIPT = path.join(ROOT, 'scripts', 'capture-scene-performance.mjs');
const harnessSha = 'b'.repeat(40);
const appSha = 'a'.repeat(40);

async function readLifecycleWitness(witnessPath, childResult) {
  try {
    return await readFile(witnessPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const details = {
      status: childResult.status,
      signal: childResult.signal,
      spawnErrorCode: childResult.error?.code ?? null,
      spawnError: String(childResult.error?.message || '').slice(0, 240),
      stderr: String(childResult.stderr || '').slice(-1200),
      stdout: String(childResult.stdout || '').slice(-600),
    };
    throw new Error(
      `Capture CLI did not create its lifecycle witness: ${JSON.stringify(details)}`,
      { cause: error },
    );
  }
}

async function runCaptureReleaseCase(
  t,
  { closeAckRejected = false, omitDisconnectedEventExport = false } = {},
) {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), 'gev-fixture-release-cli-'),
  );
  const tempBase = path.resolve(os.tmpdir());
  const resolvedTempRoot = path.resolve(tempRoot);
  if (!resolvedTempRoot.startsWith(`${tempBase}${path.sep}`))
    throw new Error('Fixture release test directory escaped the temp root.');
  t.after(async () => rm(resolvedTempRoot, { recursive: true, force: true }));
  const witnessPath = path.join(tempRoot, 'lifecycle.txt');
  const mockPuppeteerPath = path.join(tempRoot, 'mock-puppeteer.mjs');
  const mockProvenancePath = path.join(tempRoot, 'mock-provenance.mjs');
  const mockWorkerContractPath = path.join(
    tempRoot,
    'mock-worker-contract.mjs',
  );
  const mockChildProcessPath = path.join(tempRoot, 'mock-child-process.mjs');
  const preloadPath = path.join(tempRoot, 'mock-loader.mjs');
  const receiptPath = path.join(tempRoot, 'receipt.json');
  const reportPath = path.join(tempRoot, 'capture-failure.json');
  const buildRoot = path.join(tempRoot, 'build');
  const cesiumPath = path.join(buildRoot, 'cesium', 'Cesium.js');
  await mkdir(path.dirname(cesiumPath), { recursive: true });
  const cesiumBytes = Buffer.from('mock cesium bundle');
  await writeFile(cesiumPath, cesiumBytes);
  const receiptSha = 'c'.repeat(64);
  const disconnectEventExport = omitDisconnectedEventExport
    ? ''
    : `export const CDPSessionEvent = {
  Disconnected: Symbol('CDPSessionEvent.Disconnected'),
};`;
  await writeFile(
    receiptPath,
    JSON.stringify({
      schema: 'gev-build-provenance/v1',
      receiptSha256: receiptSha,
      assets: [{ path: 'cesium/Cesium.js' }],
    }),
  );
  await writeFile(
    mockChildProcessPath,
    `export function execFileSync(_file, args) {
  if (args.includes('rev-parse')) return process.env.GEV_CAPTURE_HARNESS_SHA;
  if (args.includes('status')) return '';
  throw new Error('unexpected git command');
}
`,
  );
  await writeFile(
    mockProvenancePath,
    `export async function beginCaptureBuildProvenance(options) {
  return {
    source: {
      appCommit: options.expectedAppCommit,
      harnessCommit: options.expectedHarnessCommit,
      status: 'pre-capture-served-assets-verified',
      receiptSha256: options.receipt.receiptSha256,
      expectedAssetPaths: ['/index.html', '/cesium/Cesium.js'],
      entryPaths: ['/'],
    },
    async verifyAfterCapture() { return null; },
  };
}
`,
  );
  await writeFile(
    mockWorkerContractPath,
    `export const MAX_WORKER_BLOB_RECORDS = 128;
export const MAX_WORKER_TARGETS = 64;
export function deriveCesiumEmbeddedWorkerContract() {
  return { schema: 'gev-cesium-embedded-worker-contract/v1', allowedModuleIds: ['task'] };
}
export function classifyLateWorkerAuditObservations() { return {}; }
export function installCesiumWorkerBlobAudit() {}
export function readAndRestoreCesiumWorkerBodies() { return {}; }
export function restoreCesiumWorkerBlobAudit() { return {}; }
export function summarizeWorkerAuditBoundary() { return {}; }
export function validatePrewarmedWorkerUse() { return {}; }
export function validateCesiumWorkerBlobs() { return {}; }
`,
  );
  await writeFile(
    mockPuppeteerPath,
    `import { appendFileSync } from 'node:fs';
const witness = process.env.GEV_CAPTURE_BROWSER_WITNESS;
const record = (value) => appendFileSync(witness, value + '\\n');
const listeners = new Set();
const pendingAcks = [];
let closed = false;
const client = {
  on(_name, listener) { listeners.add(listener); },
  off(_name, listener) { listeners.delete(listener); },
  listenersForEvent() { return [...listeners]; },
  listeners(_name) { return [...listeners]; },
  async send(method) {
    record('cdp:' + method);
    if (method === 'Fetch.enable') return {};
    if (method === 'Fetch.failRequest' || method === 'Fetch.fulfillRequest')
      return new Promise((resolve) => pendingAcks.push(() => {
        record('command-settled:' + method);
        resolve({});
      }));
    throw new Error('unexpected cdp command ' + method);
  },
};
const page = {
  isClosed: () => closed,
  url: () => 'http://127.0.0.1:4173/',
  setViewport: async () => {},
  setCacheEnabled: async () => {},
  setBypassServiceWorker: async () => {},
  createCDPSession: async () => client,
  evaluateOnNewDocument: async () => ({ identifier: 'probe-registration' }),
  removeScriptToEvaluateOnNewDocument: async () => record('registration-remove'),
  goto: async () => {
    record('goto');
    for (const listener of client.listenersForEvent()) {
      void listener({ requestId: 'external-request', request: { url: 'https://outside.invalid/asset.glb', method: 'GET' } });
      void listener({ requestId: 'api-request', request: { url: 'http://127.0.0.1:4173/api/tiles', method: 'GET' } });
    }
  },
  waitForFunction: async () => { record('startup-failure'); throw new Error('fixture-cli-sentinel'); },
  evaluate: async () => {
    record('renderer-probe-cleanup');
    for (const settle of pendingAcks.splice(0)) queueMicrotask(settle);
    return {
      status: 'confirmed', statePresent: true, hookRestoreAttempted: true,
      hookRestored: true, listenerCount: 2, listenerRemovalAttemptedCount: 2,
      listenerRemovalConfirmedCount: 2, listenerRemovalFailedCount: 0,
      stateDeleted: true, pageExecutionElapsedMs: 0,
      renderLoopRetirement: { requested: true, status: 'confirmed', before: true,
        after: false, confirmed: true, pageExecutionElapsedMs: 0 },
    };
  },
  async close() {
    record('target-close');
    closed = true;
    if (${closeAckRejected}) throw new Error('target-close-ack-rejected');
  },
  on: () => {},
  off: () => {},
};
const browser = {
  createBrowserContext: async () => ({ newPage: async () => page, close: async () => {} }),
  newPage: async () => page,
  close: async () => record('browser-close'),
};
export const executablePath = async () => 'mock-chrome';
export async function launch() { return browser; }
${disconnectEventExport}
export default { executablePath, launch };
`,
  );
  await writeFile(
    preloadPath,
    `import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
const map = new Map([
  ['puppeteer', ${JSON.stringify(pathToFileURL(mockPuppeteerPath).href)}],
  ['./performance/captureBuildProvenance.mjs', ${JSON.stringify(pathToFileURL(mockProvenancePath).href)}],
  ['./performance/cesiumWorkerBlobContract.mjs', ${JSON.stringify(pathToFileURL(mockWorkerContractPath).href)}],
  ['node:child_process', ${JSON.stringify(pathToFileURL(mockChildProcessPath).href)}],
]);
registerHooks({ resolve(specifier, context, nextResolve) {
  const url = map.get(specifier);
  if (url) return { url, shortCircuit: true };
  return nextResolve(specifier, context);
} });
`,
  );

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preloadPath).href,
      SCRIPT,
      '--url',
      'http://127.0.0.1:4173',
      '--runs',
      '1',
      '--startup-runs',
      '1',
      '--warmup-ms',
      '0',
      '--seconds',
      '1',
      '--headless',
      '--provider-fixture',
      'dense-investigation',
      '--mixed-layers',
      '--provider-fixture-time',
      '2026-10-08T12:00:00.000Z',
      '--build-receipt',
      receiptPath,
      '--app-checkout',
      ROOT,
      '--harness-checkout',
      ROOT,
      '--build-root',
      buildRoot,
      '--expected-app-sha',
      appSha,
      '--expected-harness-sha',
      harnessSha,
      '--served-base-url',
      'http://127.0.0.1:4173',
      '--out',
      reportPath,
    ],
    {
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
      env: {
        ...process.env,
        GEV_CAPTURE_BROWSER_WITNESS: witnessPath,
        GEV_CAPTURE_HARNESS_SHA: harnessSha,
      },
    },
  );
  const witness = await readLifecycleWitness(witnessPath, result);
  return { result, witness: witness.trim().split(/\r?\n/), reportPath };
}

test('capture CLI stops and drains the real fixture interceptor before closing its target', async (t) => {
  const { result, witness } = await runCaptureReleaseCase(t);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /fixture-cli-sentinel/);
  const cleanupIndex = witness.indexOf('renderer-probe-cleanup');
  const settledIndexes = witness
    .map((value, index) => (value.startsWith('command-settled:') ? index : -1))
    .filter((index) => index >= 0);
  const closeIndex = witness.indexOf('target-close');
  assert.ok(cleanupIndex >= 0);
  assert.ok(settledIndexes.length >= 2);
  assert.ok(
    settledIndexes.every((index) => index > cleanupIndex && index < closeIndex),
  );
  assert.ok(closeIndex > cleanupIndex);
  assert.equal(witness.at(-1), 'browser-close');
  assert.equal(
    witness.slice(closeIndex + 1).some((entry) => entry.startsWith('cdp:')),
    false,
  );
  assert.equal(
    witness.some((entry) => entry.includes('Fetch.disable')),
    false,
  );
  assert.equal(
    witness.some((entry) => entry.includes('continueRequest')),
    false,
  );
});

test('capture CLI keeps a rejected close acknowledgement failed after target closure', async (t) => {
  const { result, witness, reportPath } = await runCaptureReleaseCase(t, {
    closeAckRejected: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture-cli-sentinel/);
  assert.doesNotMatch(result.stderr, /release was confirmed/);
  assert.ok(
    witness.indexOf('renderer-probe-cleanup') < witness.indexOf('target-close'),
  );
  assert.equal(witness.at(-1), 'browser-close');
  const failure = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.match(failure.failure.message, /fixture-cli-sentinel/);
  const release = failure.workload.fixtureInterceptionReleases.at(-1);
  assert.equal(release.targetClosed, true);
  assert.equal(release.confirmed, false);
  assert.equal(release.errorKind, 'cleanup-error');
});

test('missing lifecycle witness reports the child import error instead of only ENOENT', async (t) => {
  await assert.rejects(
    () =>
      runCaptureReleaseCase(t, {
        omitDisconnectedEventExport: true,
      }),
    (error) => {
      assert.match(error.message, /CDPSessionEvent/);
      assert.match(error.message, /does not provide an export/i);
      assert.doesNotMatch(error.message, /ENOENT/);
      return true;
    },
  );
});
