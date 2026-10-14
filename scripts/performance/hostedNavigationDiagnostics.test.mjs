import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createHostedNavigationDiagnostics,
  summarizeInfrastructureResultElement,
} from './hostedNavigationDiagnostics.mjs';

class FakePage extends EventEmitter {
  state = {
    readyState: 'interactive',
    status: 'Preparing infrastructure fixture',
    resultState: 'parsed',
    result: { phase: 'initialization', completed: 0 },
  };

  async evaluate(_operation, maxLength) {
    const resultText = JSON.stringify(this.state.result ?? null);
    const tooLarge = resultText.length > maxLength;
    return {
      ...this.state,
      status: this.state.status.slice(0, 512),
      resultState: tooLarge ? 'too-large' : this.state.resultState,
      result: tooLarge ? null : this.state.result,
    };
  }

  async $eval(_selector, projector) {
    return projector({
      textContent: JSON.stringify(this.state.result ?? null),
    });
  }
}

function request(url, { type = 'other', failure = null } = {}) {
  return {
    url: () => url,
    resourceType: () => type,
    failure: () => failure,
  };
}

test('navigation diagnostics retain bounded same-origin state and detach listeners', async () => {
  const page = new FakePage();
  let time = 20;
  const diagnostic = createHostedNavigationDiagnostics(page, {
    origin: 'http://127.0.0.1:4184',
    now: () => time,
  });
  time = 60;
  page.emit('domcontentloaded');
  const pendingRequest = request(
    'http://127.0.0.1:4184/assets/app.js?token=private',
    { type: 'script', failure: { errorText: 'net::ERR_ABORTED' } },
  );
  page.emit('request', pendingRequest);
  page.emit(
    'requestfailed',
    request('https://third-party.invalid/secret.js?key=private', {
      type: 'script',
    }),
  );
  page.emit('requestfailed', pendingRequest);
  page.emit(
    'pageerror',
    Object.assign(new Error('do not retain message'), {
      stack:
        'Error: private\n    at http://127.0.0.1:4184/assets/app.js?token=private:10:2',
    }),
  );
  page.state.status =
    'Preparing https://127.0.0.1:4184/fixture?token=private credential=hidden';
  page.state.result = {
    schema: 'gev-infrastructure-runtime-renderers/v4',
    status: 'failed',
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'b'.repeat(40),
    error: { name: 'Error', message: 'module failed at token=private' },
    lifetimes: [
      {
        mode: 'entities',
        status: 'failed',
        failedSample: {
          caseId: 'default-style',
          pair: 0,
          completedCaptures: 2,
          stableFrames: 1,
          geometryReady: false,
          observedGeometry: 'c'.repeat(64),
          readinessHistory: {
            schema: 'gev-infrastructure-readiness-history/v1',
            limit: 32,
            counts: {
              observations: 1,
              pixelChanges: 1,
              geometryChanges: 0,
              notReadyObservations: 1,
              readinessResets: 1,
              invalidSignatures: 0,
            },
            observations: [
              {
                sequence: 1,
                pixelSha256: 'd'.repeat(64),
                geometrySha256: 'c'.repeat(64),
                inputsReady: false,
                stableFrames: 1,
              },
            ],
          },
          image: { pngBase64: 'must not be transported' },
        },
      },
    ],
    image: 'must not be transported',
  };
  const state = await diagnostic.snapshot();
  assert.deepEqual(state.lifecycle, {
    domContentLoadedMs: 40,
    loadMs: null,
  });
  assert.deepEqual(state.requests.failed, [
    { path: '/assets/app.js', kind: 'script', code: 'net::ERR_ABORTED' },
  ]);
  assert.deepEqual(state.requests.pending, []);
  assert.deepEqual(state.moduleErrors, [
    { kind: 'page-error', name: 'Error', path: '/assets/app.js' },
  ]);
  assert.match(state.pageState.status, /\[redacted-url\]/);
  assert.doesNotMatch(state.pageState.status, /private|token|hidden/);
  assert.deepEqual(state.pageState.result, {
    schema: 'gev-infrastructure-runtime-renderers/v4',
    status: 'failed',
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'b'.repeat(40),
    error: { name: 'Error', message: 'module failed at [redacted]' },
    lifetimes: [
      {
        mode: 'entities',
        status: 'failed',
        error: null,
        failedSample: {
          caseId: 'default-style',
          pair: 0,
          stableFrames: 1,
          completedCaptures: 2,
          pickSearches: null,
          geometryReady: false,
          observedGeometry: 'c'.repeat(64),
          changedGeometryFrom: null,
          sourceReady: null,
          sceneReadiness: null,
          readinessHistory: {
            schema: 'gev-infrastructure-readiness-history/v1',
            limit: 32,
            counts: {
              observations: 1,
              pixelChanges: 1,
              geometryChanges: 0,
              notReadyObservations: 1,
              readinessResets: 1,
              invalidSignatures: 0,
            },
            observations: [
              {
                sequence: 1,
                pixelSha256: 'd'.repeat(64),
                geometrySha256: 'c'.repeat(64),
                inputsReady: false,
                stableFrames: 1,
              },
            ],
          },
        },
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(state),
    /private|token|third-party|secret/,
  );

  diagnostic.dispose();
  assert.deepEqual((await diagnostic.snapshot()).requests.pending, []);
  assert.deepEqual(page.eventNames(), []);
  page.emit('request', request('http://127.0.0.1:4184/after.js'));
  assert.deepEqual((await diagnostic.snapshot()).requests.pending, []);
});

test('navigation diagnostics bound noisy failures and clear pending state on dispose', async () => {
  const page = new FakePage();
  const diagnostic = createHostedNavigationDiagnostics(page, {
    origin: 'http://127.0.0.1:4184',
  });
  for (let index = 0; index < 40; index += 1) {
    const failed = request(
      `http://127.0.0.1:4184/assets/${index}.js?secret=hidden`,
      {
        type: 'script',
        failure: { errorText: `private-${index}` },
      },
    );
    page.emit('request', failed);
    page.emit('requestfailed', failed);
    page.emit('console', {
      type: () => 'error',
      location: () => ({
        url: `http://127.0.0.1:4184/assets/${index}.js?secret=hidden`,
        lineNumber: index,
        columnNumber: 1,
      }),
    });
  }
  const pendingRequests = [];
  for (let index = 0; index < 40; index += 1) {
    const pending = request(
      `http://127.0.0.1:4184/assets/waiting-${index}.js?secret=hidden`,
      { type: 'script' },
    );
    pendingRequests.push(pending);
    page.emit('request', pending);
  }
  for (const pending of pendingRequests.slice(24, 30)) {
    page.emit('requestfinished', pending);
    page.emit('requestfinished', pending);
  }
  page.state.status = 'x'.repeat(900);
  page.state.result = {
    schema: 'gev-infrastructure-runtime-renderers/v4',
    status: 'failed',
    error: { name: 'Error', message: 'renderer readiness failed' },
    lifetimes: [
      {
        mode: 'entities',
        status: 'failed',
        failedSample: {
          caseId: 'default-style',
          observedGeometry: 'f'.repeat(64),
          readinessHistory: {
            schema: 'gev-infrastructure-readiness-history/v1',
            limit: 32,
            counts: { observations: 1 },
            observations: [
              {
                sequence: 1,
                pixelSha256: 'e'.repeat(64),
                geometrySha256: 'f'.repeat(64),
                inputsReady: false,
                stableFrames: 0,
              },
            ],
          },
          pngBase64: 'x'.repeat(30_000),
        },
      },
    ],
    pngBase64: 'x'.repeat(30_000),
  };
  const state = await diagnostic.snapshot();
  assert.equal(state.requests.failed.length, 24);
  assert.equal(state.requests.failedOmitted, 16);
  assert.equal(state.requests.pending.length, 24);
  assert.equal(state.requests.pendingOmitted, 10);
  assert.equal(state.moduleErrors.length, 24);
  assert.equal(state.moduleErrorsOmitted, 16);
  assert.equal(state.pageState.status.length, 512);
  assert.equal(state.pageState.resultState, 'parsed');
  assert.equal(
    state.pageState.result.error.message,
    'renderer readiness failed',
  );
  assert.equal(
    state.pageState.result.lifetimes[0].failedSample.observedGeometry,
    'f'.repeat(64),
  );
  assert.equal(
    state.pageState.result.lifetimes[0].failedSample.readinessHistory
      .observations.length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(state.pageState.result), /pngBase64|xxxx/);
  assert.doesNotMatch(JSON.stringify(state), /secret=hidden|private-[0-9]+/);
  diagnostic.dispose();
  const afterDispose = await diagnostic.snapshot();
  assert.deepEqual(afterDispose.requests.pending, []);
  assert.equal(afterDispose.requests.pendingOmitted, 0);
});

test('in-page projection preserves bounded readiness and omits image payloads', async () => {
  const projection = summarizeInfrastructureResultElement({
    textContent: JSON.stringify({
      schema: 'gev-infrastructure-runtime-renderers/v4',
      status: 'failed',
      lifetimes: [
        {
          mode: 'primitive-collections',
          status: 'failed',
          failedSample: {
            caseId: 'camera-lod-update',
            readinessHistory: {
              schema: 'gev-infrastructure-readiness-history/v1',
              limit: 32,
              counts: { observations: 40 },
              observations: Array.from({ length: 40 }, (_, index) => ({
                sequence: index + 1,
                pixelSha256: 'a'.repeat(64),
                geometrySha256: 'b'.repeat(64),
                inputsReady: true,
                stableFrames: 3,
              })),
            },
            pngBase64: 'secret image content',
          },
        },
      ],
      pngBase64: 'secret image content',
    }),
  });
  assert.equal(projection.resultState, 'parsed');
  const history = projection.result.lifetimes[0].failedSample.readinessHistory;
  assert.equal(history.observations.length, 32);
  assert.equal(history.observations[0].sequence, 9);
  assert.doesNotMatch(JSON.stringify(projection), /pngBase64|secret image/);
  const page = new FakePage();
  page.state.result = projection.result;
  const diagnostic = createHostedNavigationDiagnostics(page, {
    origin: 'http://127.0.0.1:4184',
  });
  const state = await diagnostic.snapshot();
  assert.equal(
    state.pageState.result.lifetimes[0].failedSample.readinessHistory
      .observations.length,
    32,
  );
  diagnostic.dispose();
  assert.deepEqual(
    summarizeInfrastructureResultElement({ textContent: 'x'.repeat(256_001) }),
    { resultState: 'too-large', result: null },
  );
});

test('unavailable page execution still returns lifecycle and request evidence', async () => {
  const page = new FakePage();
  page.evaluate = async () => {
    throw new Error('execution context was cleared');
  };
  const diagnostic = createHostedNavigationDiagnostics(page, {
    origin: 'http://127.0.0.1:4184',
  });
  page.emit('load');
  const requestEntry = request('http://127.0.0.1:4184/assets/module.js');
  page.emit('request', requestEntry);
  const state = await diagnostic.snapshot();
  assert.equal(state.lifecycle.loadMs >= 0, true);
  assert.equal(state.pageState.available, false);
  assert.deepEqual(state.requests.pending, [
    { path: '/assets/module.js', script: false },
  ]);
  diagnostic.dispose();
});

test('page-state collection has a bounded timeout when navigation leaves evaluation pending', async () => {
  const page = new FakePage();
  page.evaluate = () => new Promise(() => {});
  const diagnostic = createHostedNavigationDiagnostics(page, {
    origin: 'http://127.0.0.1:4184',
  });
  const startedAt = performance.now();
  const state = await diagnostic.snapshot();
  assert.ok(performance.now() - startedAt < 3000);
  assert.deepEqual(state.pageState, { available: false });
  diagnostic.dispose();
});
