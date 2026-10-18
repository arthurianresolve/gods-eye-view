import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { captureWithDebuggerPause } from './debuggerPausedCapture.mjs';

function fakePage({
  frame = true,
  evaluateError = false,
  screenshotError = false,
  resumeError = false,
  disableError = false,
  enableError = false,
  pauseError = false,
  pauseOnEnable = true,
} = {}) {
  const events = new EventEmitter();
  const calls = [];
  const session = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    removeListener: events.removeListener.bind(events),
    listenerCount: events.listenerCount.bind(events),
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Debugger.enable' && enableError)
        throw new Error('enable failed');
      if (method === 'Debugger.pause' && pauseError)
        throw new Error('pause failed');
      if (method === 'Debugger.pause' && pauseOnEnable) {
        queueMicrotask(() =>
          events.emit('Debugger.paused', {
            callFrames: frame ? [{ callFrameId: 'top-frame' }] : [],
          }),
        );
      }
      if (method === 'Debugger.evaluateOnCallFrame') {
        if (evaluateError) return { exceptionDetails: { text: 'read failed' } };
        return { result: { type: 'object', value: { readOnly: true } } };
      }
      if (method === 'Debugger.resume' && resumeError)
        throw new Error('resume failed');
      if (method === 'Debugger.disable' && disableError)
        throw new Error('disable failed');
      return {};
    },
    async detach() {
      calls.push({ method: 'detach' });
    },
  };
  return {
    page: { createCDPSession: async () => session },
    session,
    calls,
    screenshot: async () => {
      if (screenshotError) throw new Error('screenshot failed');
      return Buffer.from('png');
    },
  };
}

test('pauses, evaluates a serializable read and cleans up the owned session', async () => {
  const fake = fakePage();
  const result = await captureWithDebuggerPause({
    page: fake.page,
    readCallback: () => ({ readOnly: true }),
    screenshot: fake.screenshot,
  });
  assert.deepEqual(result.readBefore, { readOnly: true });
  assert.deepEqual(result.readAfter, { readOnly: true });
  assert.deepEqual(result.screenshot, Buffer.from('png'));
  assert.deepEqual(
    fake.calls.map(({ method }) => method),
    [
      'Debugger.enable',
      'Debugger.pause',
      'Debugger.evaluateOnCallFrame',
      'Debugger.evaluateOnCallFrame',
      'Debugger.resume',
      'Debugger.disable',
      'detach',
    ],
  );
});

test('rejects a pause without a top call frame and still disables/detaches', async () => {
  const fake = fakePage({ frame: false });
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      screenshot: fake.screenshot,
      pauseTimeoutMs: 100,
    }),
    /top call frame/,
  );
  assert.deepEqual(
    fake.calls.map(({ method }) => method),
    [
      'Debugger.enable',
      'Debugger.pause',
      'Debugger.resume',
      'Debugger.disable',
      'detach',
    ],
  );
});

test('keeps enable and pause protocol failures bounded and cleans up', async () => {
  for (const option of [{ enableError: true }, { pauseError: true }]) {
    const fake = fakePage(option);
    await assert.rejects(
      captureWithDebuggerPause({
        page: fake.page,
        screenshot: fake.screenshot,
        pauseTimeoutMs: 100,
      }),
      /(?:enable|pause) failed/,
    );
    assert.ok(fake.calls.some(({ method }) => method === 'Debugger.disable'));
    assert.ok(fake.calls.some(({ method }) => method === 'detach'));
  }
});

test('keeps read errors primary and resumes the paused debugger', async () => {
  const fake = fakePage({ evaluateError: true });
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => 1,
      screenshot: fake.screenshot,
    }),
    /Paused read callback failed/,
  );
  assert.ok(fake.calls.some(({ method }) => method === 'Debugger.resume'));
  assert.equal(
    fake.calls.filter(({ method }) => method === 'Debugger.evaluateOnCallFrame')
      .length,
    1,
  );
});

test('keeps screenshot errors primary and cleans up after resume failure', async () => {
  const fake = fakePage({ screenshotError: true, resumeError: true });
  await assert.rejects(
    captureWithDebuggerPause({ page: fake.page, screenshot: fake.screenshot }),
    (error) =>
      error?.message === 'screenshot failed' &&
      error.cleanupErrors?.some(({ stage }) => stage === 'resume'),
  );
  assert.ok(fake.calls.some(({ method }) => method === 'Debugger.disable'));
  assert.ok(fake.calls.some(({ method }) => method === 'detach'));
});

test('pause timeout removes the listener and never resumes an unpaused session', async () => {
  const fake = fakePage({ pauseOnEnable: false });
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      screenshot: fake.screenshot,
      pauseTimeoutMs: 20,
    }),
    /pause deadline exceeded/,
  );
  assert.deepEqual(
    fake.calls.map(({ method }) => method),
    ['Debugger.enable', 'Debugger.pause', 'Debugger.disable', 'detach'],
  );
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
});

test('operation timeout remains bounded and resumes before cleanup', async () => {
  const fake = fakePage();
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      screenshot: () => new Promise(() => {}),
      operationTimeoutMs: 20,
    }),
    /paused screenshot deadline exceeded/,
  );
  assert.ok(fake.calls.some(({ method }) => method === 'Debugger.resume'));
});

test('successful capture reports cleanup failure instead of returning early', async () => {
  const fake = fakePage({ disableError: true });
  await assert.rejects(
    captureWithDebuggerPause({ page: fake.page, screenshot: fake.screenshot }),
    (error) =>
      error?.message === 'Paused capture cleanup failed.' &&
      error.cleanupErrors?.some(({ stage }) => stage === 'disable'),
  );
});
