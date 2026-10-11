import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const MGRS_STUB_URL = 'gev-test-stub:mgrs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mgrs') return { url: MGRS_STUB_URL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === MGRS_STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export function forward() { return "10SEG55776339"; }\nexport default { forward };\n',
      };
    }
    return next(url, context);
  },
});

const { IntelHUD } = await import('./hud.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function installHud({ summarize } = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { setTimeout, clearTimeout };

  let moveEndListener = null;
  const viewer = {
    camera: {
      heading: 0,
      pitch: -Math.PI / 2,
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      moveEnd: {
        addEventListener(listener) {
          moveEndListener = listener;
        },
        removeEventListener(listener) {
          if (moveEndListener === listener) moveEndListener = null;
        },
      },
    },
  };
  const hud = new IntelHUD(viewer, {
    summaryService: {
      summarize:
        summarize ||
        (async () => ({
          ok: true,
          status: 200,
          data: { summary: 'Five words remain contextually clear' },
        })),
    },
  });
  hud._latestMetrics = { latitude: 0, longitude: 0, height: 1000 };
  hud._summaryRevision = 1;
  hud._summaryDirty = true;
  hud.renderedText = [];
  hud.contextBuilds = 0;
  hud._composeSummary = () => 'Fallback summary';
  hud._setSummaryText = (text) => hud.renderedText.push(text);
  hud._summaryContext = () => {
    hud.contextBuilds += 1;
    return Promise.resolve({
      revision: hud._summaryRevision,
      feedProvenance: { overall: 'nominal' },
    });
  };

  return {
    hud,
    viewer,
    restore() {
      hud.destroy();
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test('overlapping same-revision _updateSummary calls share context and service work', async () => {
  const context = deferred();
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'Five words remain contextually clear' },
      });
    },
  });
  env.hud._summaryContext = () => {
    env.hud.contextBuilds += 1;
    return context.promise;
  };
  try {
    const first = env.hud._updateSummary(false, true);
    const second = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.equal(env.hud.contextBuilds, 1);

    context.resolve({
      revision: 1,
      feedProvenance: { overall: 'nominal' },
    });
    await Promise.all([first, second]);
    assert.equal(serviceCalls.length, 1);
    assert.equal(env.hud._summaryDirty, false);
    assert.equal(env.hud._summaryContextBuild, null);
    assert.deepEqual(env.hud.renderedText, [
      'Fallback summary',
      'Five words remain contextually clear',
    ]);
  } finally {
    env.restore();
  }
});

test('a changed revision starts fresh context and stale context cannot start the service', async () => {
  const builds = [deferred(), deferred()];
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'Five words remain contextually clear' },
      });
    },
  });
  env.hud._summaryContext = () => builds[env.hud.contextBuilds++].promise;
  try {
    const stale = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    env.hud._summaryRevision = 2;
    env.hud._summaryDirty = true;
    const current = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.equal(env.hud.contextBuilds, 2);

    builds[0].resolve({ revision: 1, feedProvenance: { overall: 'nominal' } });
    await stale;
    assert.equal(serviceCalls.length, 0);
    builds[1].resolve({ revision: 2, feedProvenance: { overall: 'nominal' } });
    await current;
    assert.deepEqual(
      serviceCalls.map((value) => value.revision),
      [2],
    );
  } finally {
    env.restore();
  }
});

test('a revision change before the scheduled microtask skips stale scene work', async () => {
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'Latest camera summary is ready' },
      });
    },
  });
  env.hud._summaryContext = () => {
    env.hud.contextBuilds += 1;
    return Promise.resolve({
      revision: env.hud._summaryRevision,
      feedProvenance: { overall: 'nominal' },
    });
  };
  try {
    const stale = env.hud._updateSummary(false, true);
    env.hud._markSummaryDirty();
    const current = env.hud._updateSummary(false, true);
    await Promise.all([stale, current]);
    assert.equal(env.hud.contextBuilds, 1);
    assert.deepEqual(
      serviceCalls.map((value) => value.revision),
      [2],
    );
    assert.deepEqual(env.hud.renderedText, [
      'Fallback summary',
      'Latest camera summary is ready',
    ]);
  } finally {
    env.restore();
  }
});

test('a context rejection remains retryable through the real HUD method', async () => {
  const failed = deferred();
  const env = installHud();
  env.hud._summaryContext = () => {
    env.hud.contextBuilds += 1;
    return env.hud.contextBuilds === 1
      ? failed.promise
      : Promise.resolve({
          revision: 1,
          feedProvenance: { overall: 'nominal' },
        });
  };
  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    const first = env.hud._updateSummary(false, true);
    const second = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.equal(env.hud.contextBuilds, 1);
    failed.reject(new Error('temporary context failure'));
    await Promise.all([first, second]);
    assert.equal(env.hud._summaryDirty, true);
    assert.equal(env.hud._summaryContextBuild, null);

    await env.hud._updateSummary(false, true);
    assert.equal(env.hud.contextBuilds, 2);
    assert.equal(env.hud._summaryDirty, false);
  } finally {
    console.warn = savedWarn;
    env.restore();
  }
});

test('an active request skips a changed-camera context until the old request settles', async () => {
  const service = deferred();
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      if (serviceCalls.length === 1) return service.promise;
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'Updated camera summary is ready' },
      });
    },
  });
  try {
    const first = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.ok(env.hud._summaryRequest);
    assert.equal(env.hud.contextBuilds, 1);

    env.viewer.camera.positionCartographic.longitude = 0.25;
    env.hud._markSummaryDirty();
    await env.hud._updateSummary(false, true);
    assert.equal(env.hud.contextBuilds, 1);
    assert.equal(serviceCalls.length, 1);
    assert.equal(env.hud._summaryDirty, true);

    service.resolve({
      ok: true,
      status: 200,
      data: { summary: 'Five words remain contextually clear' },
    });
    await first;
    assert.equal(env.hud._summaryRequest, null);

    await env.hud._updateSummary(false, true);
    assert.equal(env.hud.contextBuilds, 2);
    assert.equal(serviceCalls.length, 2);
    assert.equal(env.hud._summaryDirty, false);
  } finally {
    env.restore();
  }
});

test('forced refresh bypasses unchanged signatures while ordinary refresh does not', async () => {
  let serviceCalls = 0;
  const env = installHud({
    summarize: async () => {
      serviceCalls += 1;
      return {
        ok: true,
        status: 200,
        data: { summary: 'Five words remain contextually clear' },
      };
    },
  });
  try {
    await env.hud._updateSummary(false, true);
    assert.equal(env.hud.contextBuilds, 1);
    assert.equal(serviceCalls, 1);
    assert.equal(env.hud._lastSummarySignature.length > 0, true);

    env.hud._summaryDirty = true;
    await env.hud._updateSummary(false, false);
    assert.equal(env.hud.contextBuilds, 2);
    assert.equal(serviceCalls, 1);
    assert.equal(env.hud._summaryDirty, false);

    env.hud._summaryDirty = true;
    await env.hud._updateSummary(false, true);
    assert.equal(env.hud.contextBuilds, 3);
    assert.equal(serviceCalls, 2);
    assert.equal(env.hud._summaryDirty, false);
  } finally {
    env.restore();
  }
});

test('a request finishing after a revision change cannot overwrite newer summary state', async () => {
  const service = deferred();
  const env = installHud({ summarize: () => service.promise });
  try {
    const pending = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.ok(env.hud._summaryRequest);

    env.hud._summaryRevision = 2;
    env.hud._summaryDirty = true;
    env.hud._lastSummarySignature = 'newer-revision-signature';
    service.resolve({
      ok: true,
      status: 200,
      data: { summary: 'Stale response must not paint' },
    });
    await pending;
    assert.equal(env.hud._summaryDirty, true);
    assert.equal(env.hud._lastSummarySignature, 'newer-revision-signature');
    assert.deepEqual(env.hud.renderedText, ['Fallback summary']);
  } finally {
    env.restore();
  }
});

test('a request rejection after a revision change cannot reset newer state', async () => {
  const service = deferred();
  const env = installHud({ summarize: () => service.promise });
  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    const pending = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.ok(env.hud._summaryRequest);

    env.hud._summaryRevision = 2;
    env.hud._summaryDirty = false;
    env.hud._lastSummarySignature = 'newer-revision-signature';
    service.reject(new Error('stale service failure'));
    await pending;
    assert.equal(env.hud._summaryDirty, false);
    assert.equal(env.hud._lastSummarySignature, 'newer-revision-signature');
    assert.deepEqual(env.hud.renderedText, ['Fallback summary']);
  } finally {
    console.warn = savedWarn;
    env.restore();
  }
});

test('destroy before the scheduled build starts prevents scene work', async () => {
  const env = installHud();
  try {
    const pending = env.hud._updateSummary(false, true);
    env.hud.destroy();
    await pending;
    assert.equal(env.hud.contextBuilds, 0);
    assert.deepEqual(env.hud.renderedText, []);
    assert.equal(env.hud._summaryContextBuild, null);
  } finally {
    env.restore();
  }
});

test('destroy after context starts prevents late service work and painting', async () => {
  const context = deferred();
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'late' },
      });
    },
  });
  env.hud._summaryContext = () => {
    env.hud.contextBuilds += 1;
    return context.promise;
  };
  try {
    const pending = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    assert.equal(env.hud.contextBuilds, 1);
    env.hud.destroy();
    context.resolve({ revision: 1, feedProvenance: { overall: 'nominal' } });
    await pending;
    assert.equal(serviceCalls.length, 0);
    assert.deepEqual(env.hud.renderedText, []);
    assert.equal(env.hud._summaryContextBuild, null);
  } finally {
    env.restore();
  }
});

test('hide does not cancel an already-running summary context', async () => {
  const context = deferred();
  const serviceCalls = [];
  const env = installHud({
    summarize(value) {
      serviceCalls.push(value);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: { summary: 'Five words remain contextually clear' },
      });
    },
  });
  env.hud._summaryContext = () => {
    env.hud.contextBuilds += 1;
    return context.promise;
  };
  try {
    const pending = env.hud._updateSummary(false, true);
    await flushMicrotasks();
    env.hud.hide();
    assert.equal(env.hud.visible, false);
    context.resolve({ revision: 1, feedProvenance: { overall: 'nominal' } });
    await pending;
    assert.equal(serviceCalls.length, 1);
    assert.equal(env.hud._destroyed, false);
  } finally {
    env.restore();
  }
});
