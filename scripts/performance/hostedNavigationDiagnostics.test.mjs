import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createHostedNavigationDiagnostics } from './hostedNavigationDiagnostics.mjs';

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
  page.state.result = {
    phase: 'viewer-create',
    errorCode: 'MODULE_IMPORT_FAILED',
    requestUrl: 'http://127.0.0.1:4184/private?token=secret',
    detail: 'https://third-party.invalid/path?secret=private',
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
  assert.equal(state.pageState.status, 'Preparing infrastructure fixture');
  assert.deepEqual(state.pageState.result, {
    phase: 'viewer-create',
    errorCode: 'MODULE_IMPORT_FAILED',
    detail: '[redacted-url]',
  });
  assert.doesNotMatch(
    JSON.stringify(state),
    /private|token|third-party|secret/,
  );

  diagnostic.dispose();
  assert.deepEqual(page.eventNames(), []);
  page.emit('request', request('http://127.0.0.1:4184/after.js'));
  assert.deepEqual((await diagnostic.snapshot()).requests.pending, []);
});

test('navigation diagnostics bound noisy failures and preserve pending same-origin paths', async () => {
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
  const waiting = request(
    'http://127.0.0.1:4184/assets/waiting.js?secret=hidden',
    {
      type: 'script',
    },
  );
  page.emit('request', waiting);
  page.state.status = 'x'.repeat(900);
  page.state.result = { phase: 'x'.repeat(20_000) };
  const state = await diagnostic.snapshot();
  assert.equal(state.requests.failed.length, 24);
  assert.equal(state.requests.failedOmitted, 16);
  assert.deepEqual(state.requests.pending, [
    { path: '/assets/waiting.js', script: true },
  ]);
  assert.equal(state.moduleErrors.length, 24);
  assert.equal(state.moduleErrorsOmitted, 16);
  assert.equal(state.pageState.status.length, 512);
  assert.equal(state.pageState.resultState, 'too-large');
  assert.equal(state.pageState.result, null);
  assert.doesNotMatch(JSON.stringify(state), /secret=hidden|private-[0-9]+/);
  diagnostic.dispose();
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
