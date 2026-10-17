import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBrowserArgs } from '../qa-application-fixtures.mjs';
import {
  captureBoundedDomState,
  cleanupStartupHeartbeat,
  createStartupDiagnostics,
  installStartupHeartbeat,
  parseWebglDiagnosticMarker,
} from './startupDiagnostics.mjs';

test('startup evidence redacts locations and bounds every event list', () => {
  const diagnostics = createStartupDiagnostics('http://127.0.0.1:4173');
  diagnostics.recordInitialTargets([
    { type: () => 'page', url: () => 'about:blank' },
    {
      type: () => 'page',
      url: () => 'http://127.0.0.1:4173/assets/app.js?token=private',
    },
    {
      type: () => 'service_worker',
      url: () => 'https://provider.example/secret/key?token=private',
    },
  ]);
  diagnostics.recordTargets([]);
  diagnostics.recordHeartbeat({
    readyState: 'interactive',
    appPresent: true,
    canvasCount: 1,
    loaderText: 'Waiting for https://private.example/?token=secret',
  });
  diagnostics.recordRequest({
    url: 'http://127.0.0.1:4173/api/places?key=secret',
    status: 503,
    method: 'GET',
    resourceType: 'fetch',
  });
  diagnostics.recordRequest({
    url: 'https://provider.example/private/path?key=secret',
    status: 403,
    method: 'GET',
    resourceType: 'image',
  });
  diagnostics.recordStderr('ERROR: failed https://private.example/?token=secret');
  const redactionSnapshot = JSON.stringify(
    diagnostics.snapshot({
      targetInventory: diagnostics.recordTargets([
        {
          type: () => 'page',
          url: () => 'https://provider.example/private/path?key=secret',
        },
      ]),
    }),
  );
  for (const secret of ['private.example', 'token=secret', 'key=secret'])
    assert.equal(redactionSnapshot.includes(secret), false);
  for (let index = 0; index < 50; index += 1) {
    diagnostics.recordHeartbeat({ readyState: 'loading', canvasCount: index });
    diagnostics.recordRequest({
      url: `http://127.0.0.1:4173/asset/${index}`,
      status: 404,
      resourceType: 'script',
    });
    diagnostics.recordStderr(`Chrome warning ${index}`);
  }

  const snapshot = diagnostics.snapshot({
    domState: { readyState: 'complete', appPresent: true, canvasCount: 1 },
    targetInventory: diagnostics.recordTargets([
      { type: () => 'page', url: () => 'http://localhost:4173/' },
    ]),
    chromeProcessCount: 8,
  });
  assert.equal(snapshot.rendererResponsive, true);
  assert.equal(snapshot.heartbeatCount, 16);
  assert.equal(snapshot.heartbeatTail.length, 8);
  assert.equal(snapshot.requests.length, 32);
  assert.equal(snapshot.stderr.length, 16);
  assert.equal(snapshot.initialTargets[0].location, 'blank');
  assert.equal(snapshot.initialTargets[1].location, 'app');
  assert.equal(snapshot.initialTargets[2].location, 'external');
  assert.equal(snapshot.initialTargets[2].path, undefined);
  assert.equal(snapshot.requests[0].path, '/asset/18');
  assert.equal(snapshot.requests.at(-1).path, '/asset/49');
  assert.equal(snapshot.requests.at(-1).location, 'app');
  assert.equal(snapshot.chromeProcessCount, 8);
});

test('renderer DOM capture returns promptly when the injected evaluator stalls', async () => {
  const stalledPage = { evaluate: () => new Promise(() => {}) };
  const started = Date.now();
  const result = await captureBoundedDomState(stalledPage, 20);
  assert.equal(result, null);
  assert.ok(Date.now() - started < 500);
});

test('renderer DOM capture returns only sanitized minimal state', async () => {
  const page = {
    evaluate: async () => ({
      readyState: 'complete',
      appPresent: false,
      canvasCount: 0,
      loaderText: 'Waiting https://host.example/?key=private',
      localStorage: 'must not be recorded',
    }),
  };
  assert.deepEqual(await captureBoundedDomState(page), {
    readyState: 'complete',
    appPresent: false,
    canvasCount: 0,
    loaderText: 'Waiting [url]',
  });
});

test('heartbeat install and cleanup stay bounded if renderer evaluation stalls', async () => {
  let exposedName;
  let injectedScript;
  let removedScript;
  let removedBinding;
  const page = {
    exposeFunction: async (name, callback) => {
      exposedName = name;
      await callback({ readyState: 'interactive', canvasCount: 0 });
    },
    evaluateOnNewDocument: async (callback) => {
      injectedScript = callback;
      return { identifier: 'fixture-script' };
    },
    evaluate: () => new Promise(() => {}),
    removeScriptToEvaluateOnNewDocument: async (identifier) => {
      removedScript = identifier;
    },
    removeExposedFunction: async (name) => {
      removedBinding = name;
    },
  };
  const diagnostics = createStartupDiagnostics('http://127.0.0.1:4173');
  const scriptIdentifier = await installStartupHeartbeat(page, diagnostics);
  assert.equal(exposedName, '__gevRecoveryHeartbeat');
  assert.equal(typeof injectedScript, 'function');
  assert.equal(scriptIdentifier, 'fixture-script');

  const started = Date.now();
  const result = await cleanupStartupHeartbeat(page, scriptIdentifier, 20);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(result, {
    timerCleared: false,
    scriptRemoved: true,
    bindingRemoved: true,
  });
  assert.equal(removedScript, 'fixture-script');
  assert.equal(removedBinding, '__gevRecoveryHeartbeat');
  assert.equal(diagnostics.snapshot().heartbeatCount, 1);
});

test('WebGL-only SwiftShader is opt-in and leaves the default driver mode unchanged', () => {
  assert.deepEqual(fixtureBrowserArgs({ softwareRendering: false, webglOnly: false }), [
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ]);
  assert.deepEqual(
    fixtureBrowserArgs({ softwareRendering: true, webglOnly: false }),
    [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    ],
  );
  assert.deepEqual(
    fixtureBrowserArgs({ softwareRendering: true, webglOnly: true }),
    [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
    ],
  );
  assert.deepEqual(fixtureBrowserArgs({ softwareRendering: false, webglOnly: true }), [
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ]);
});

test('renderer query marker parser accepts only bounded known phases', () => {
  const diagnostics = createStartupDiagnostics('http://127.0.0.1:4173');
  const marker = parseWebglDiagnosticMarker(
    '__GEV_RECOVERY_WEBGL__{"phase":"extension-ready","elapsedMs":42.5}',
  );
  assert.deepEqual(marker, { phase: 'extension-ready', elapsedMs: 42.5 });
  diagnostics.recordRendererPhase(marker);
  for (const invalid of [
    '__GEV_RECOVERY_WEBGL__{"phase":"secret","elapsedMs":1}',
    '__GEV_RECOVERY_WEBGL__{"phase":"renderer-ready","elapsedMs":null}',
    '__GEV_RECOVERY_WEBGL__{"phase":"renderer-ready","elapsedMs":-1}',
    '__GEV_RECOVERY_WEBGL__not-json',
    'ordinary console message',
  ])
    assert.equal(parseWebglDiagnosticMarker(invalid), null);
  const snapshot = diagnostics.snapshot();
  assert.deepEqual(snapshot.lastRendererPhase.phase, 'extension-ready');
  assert.equal(snapshot.lastRendererPhase.elapsedMs, 42.5);
  assert.equal(snapshot.rendererPhases.length, 1);
});
