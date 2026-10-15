import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SCRIPT = path.join(ROOT, 'scripts', 'capture-scene-performance.mjs');

test('capture CLI removes the future-document registration only after document retirement', async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), 'gev-probe-retirement-test-'),
  );
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));
  const witnessPath = path.join(tempRoot, 'lifecycle.txt');
  const mockPuppeteerPath = path.join(tempRoot, 'mock-puppeteer.mjs');
  const preloadPath = path.join(tempRoot, 'mock-loader.mjs');
  const reportPath = path.join(tempRoot, 'capture-failure.json');
  await writeFile(
    mockPuppeteerPath,
    `import { appendFileSync } from 'node:fs';
const witness = process.env.GEV_CAPTURE_BROWSER_WITNESS;
const record = (value) => appendFileSync(witness, value + '\\n');
let foregroundObservationPending = false;
const page = {
  isClosed: () => false,
  bringToFront: async () => { foregroundObservationPending = true; },
  setViewport: async () => {},
  setCacheEnabled: async () => {},
  setBypassServiceWorker: async () => {},
  evaluateOnNewDocument: async () => ({ identifier: 'owned-registration' }),
  goto: async () => record('goto-domcontentloaded'),
  waitForFunction: async () => {
    if (foregroundObservationPending) return;
    record('wait-for-viewer');
    throw new Error('sentinel-after-domcontentloaded');
  },
  evaluate: async () => {
    if (foregroundObservationPending) {
      foregroundObservationPending = false;
      return { visible: true, focused: true, visibilityState: 'visible' };
    }
    record('document-cleanup');
    return {
      status: 'confirmed', statePresent: true, hookRestoreAttempted: true,
      hookRestored: true, listenerCount: 2, listenerRemovalAttemptedCount: 2,
      listenerRemovalConfirmedCount: 2, listenerRemovalFailedCount: 0,
      stateDeleted: true, pageExecutionElapsedMs: 0,
      renderLoopRetirement: { requested: true, status: 'confirmed', before: true,
        after: false, confirmed: true, pageExecutionElapsedMs: 0 },
    };
  },
  removeScriptToEvaluateOnNewDocument: async (identifier) => {
    record('registration-remove:' + identifier);
  },
  on: () => {},
};
const puppeteer = {
  executablePath: async () => 'mock-chrome',
  launch: async (options) => {
    record('launch-args:' + JSON.stringify(options.args ?? []));
    return {
    createBrowserContext: async () => ({ newPage: async () => page }),
    newPage: async () => page,
    close: async () => record('browser-close'),
    };
  },
};
export const CDPSessionEvent = {
  Disconnected: Symbol('CDPSessionEvent.Disconnected'),
};
export default puppeteer;
`,
  );
  await writeFile(
    preloadPath,
    `import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'puppeteer') return { url: pathToFileURL(${JSON.stringify(mockPuppeteerPath)}).href, shortCircuit: true };
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
      '--out',
      reportPath,
    ],
    {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      env: { ...process.env, GEV_CAPTURE_BROWSER_WITNESS: witnessPath },
    },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /sentinel-after-domcontentloaded/);
  const events = (await readFile(witnessPath, 'utf8')).trim().split(/\r?\n/);
  assert.match(events[0], /^launch-args:/);
  const ordinaryHardwareLaunchArgs = JSON.parse(
    events[0].slice('launch-args:'.length),
  );
  assert.ok(Array.isArray(ordinaryHardwareLaunchArgs));
  assert.equal(ordinaryHardwareLaunchArgs.includes('--use-gl=angle'), false);
  assert.equal(
    ordinaryHardwareLaunchArgs.includes('--use-angle=swiftshader'),
    false,
  );
  assert.deepEqual(events.slice(1), [
    'goto-domcontentloaded',
    'wait-for-viewer',
    'document-cleanup',
    'registration-remove:owned-registration',
    'browser-close',
  ]);
  const failure = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(failure.schema, 'gev-performance-capture-failure/v1');
  assert.match(failure.failure.message, /sentinel-after-domcontentloaded/);
});
