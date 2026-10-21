import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
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
  taskCompletesWithoutPause = false,
  enableGate = null,
  detachError = false,
  guardContext = {},
  evaluatePausedExpressions = false,
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
      if (method === 'Debugger.enable' && enableGate) await enableGate;
      if (method === 'Debugger.enable' && enableError)
        throw new Error('enable failed');
      if (method === 'Runtime.evaluate' && pauseError)
        throw new Error('pause failed');
      if (method === 'Runtime.evaluate' && taskCompletesWithoutPause) return {};
      if (
        method === 'Runtime.evaluate' &&
        params.expression.includes('gev-qualification-guarded-pause.js')
      ) {
        let ready;
        try {
          ready = runInNewContext(params.expression, guardContext);
        } catch (error) {
          return { exceptionDetails: { text: error.message } };
        }
        if (!ready || ready?.ready === false)
          return { result: { value: ready } };
      }
      if (method === 'Runtime.evaluate' && pauseOnEnable) {
        queueMicrotask(() =>
          events.emit('Debugger.paused', {
            callFrames: frame ? [{ callFrameId: 'top-frame' }] : [],
          }),
        );
        return new Promise(() => {});
      }
      if (method === 'Runtime.evaluate') return new Promise(() => {});
      if (method === 'Debugger.evaluateOnCallFrame') {
        if (evaluateError) return { exceptionDetails: { text: 'read failed' } };
        if (evaluatePausedExpressions)
          return {
            result: {
              type: 'object',
              value: runInNewContext(params.expression, guardContext),
            },
          };
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
      if (detachError) throw new Error('detach failed');
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
  assert.deepEqual(result.cleanup, {
    resumed: true,
    disabled: true,
    detached: true,
  });
  assert.deepEqual(
    fake.calls.map(({ method }) => method),
    [
      'Debugger.enable',
      'Runtime.evaluate',
      'Debugger.evaluateOnCallFrame',
      'Debugger.evaluateOnCallFrame',
      'Debugger.resume',
      'Debugger.disable',
      'detach',
    ],
  );
  assert.equal(result.pause.boundary, 'runtime-task');
  assert.match(fake.calls[1].params.expression, /^debugger;/);
  assert.equal(
    fake.calls.some(({ method }) => method === 'Debugger.pause'),
    false,
  );
});

test('serializes bounded callback arguments into the paused evaluation', async () => {
  const fake = fakePage();
  await captureWithDebuggerPause({
    page: fake.page,
    readCallback: ({ phase }) => phase,
    readCallbackArgs: { phase: 2 },
    screenshot: fake.screenshot,
  });
  const evaluations = fake.calls.filter(
    ({ method }) => method === 'Debugger.evaluateOnCallFrame',
  );
  assert.equal(evaluations.length, 2);
  assert.match(evaluations[0].params.expression, /phase/);
  assert.match(evaluations[0].params.expression, /2/);
});

test('atomic guard waits for the declared phase without taking rejected screenshots', async () => {
  const context = { samples: [{ phase: 2 }, { phase: 2 }, { phase: 0 }] };
  const fake = fakePage({ guardContext: context });
  let screenshots = 0;
  const result = await captureWithDebuggerPause({
    page: fake.page,
    readCallback: () => globalThis.samples.shift(),
    pauseWhen: (snapshot) => snapshot.phase === 0,
    screenshot: async () => {
      screenshots++;
      return Buffer.from('png');
    },
    pauseTimeoutMs: 1000,
  });
  assert.equal(screenshots, 1);
  assert.equal(result.pause.guard.method, 'atomic-read-then-debugger/v1');
  assert.equal(result.pause.guard.checks, 3);
  assert.equal(result.pause.guard.pollIntervalMs, 50);
  assert.ok(result.pause.guard.debuggerEnableDurationMs >= 0);
  assert.equal(
    result.pause.guard.finalEvaluation.interruptedByDebuggerPause,
    true,
  );
  assert.equal(context.samples.length, 0);
  assert.equal(
    fake.calls.filter((c) => c.method === 'Runtime.evaluate').length,
    3,
  );
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
  assert.deepEqual(result.cleanup, {
    resumed: true,
    disabled: true,
    detached: true,
  });
});

test('separate atomic guard reads phase without repeatedly reading paused evidence', async () => {
  const context = { phase: 2, guardReads: 0, proofReads: 0 };
  const fake = fakePage({
    guardContext: context,
    evaluatePausedExpressions: true,
  });
  const result = await captureWithDebuggerPause({
    page: fake.page,
    readCallback: () => {
      globalThis.proofReads++;
      return { phase: globalThis.phase, proof: 'complete' };
    },
    guardReadCallback: () => {
      globalThis.guardReads++;
      return { phase: globalThis.phase };
    },
    pauseWhen: (snapshot) => snapshot.phase === 0,
    requestNextGuardFrame: (snapshot) => {
      if (snapshot.phase !== 2) return false;
      globalThis.phase = 0;
      return true;
    },
    screenshot: fake.screenshot,
    pauseTimeoutMs: 1000,
  });
  assert.equal(context.guardReads, 2);
  assert.equal(context.proofReads, 2);
  assert.equal(result.pause.guard.checks, 2);
  assert.equal(result.readBefore.proof, 'complete');
  assert.equal(result.readAfter.proof, 'complete');
  const pausedReads = fake.calls.filter(
    ({ method }) => method === 'Debugger.evaluateOnCallFrame',
  );
  assert.equal(pausedReads.length, 2);
  assert.ok(
    pausedReads.every(({ params }) => params.expression.includes('proofReads')),
  );
  assert.deepEqual(result.cleanup, {
    resumed: true,
    disabled: true,
    detached: true,
  });
});

test('atomic guard rejects thrown, asynchronous, and nonboolean predicates before capture', async () => {
  for (const pauseWhen of [
    () => {
      throw new Error('bad guard');
    },
    async () => true,
    () => 'true',
  ]) {
    const fake = fakePage();
    let screenshots = 0;
    await assert.rejects(
      captureWithDebuggerPause({
        page: fake.page,
        readCallback: () => ({}),
        pauseWhen,
        screenshot: () => screenshots++,
        pauseTimeoutMs: 100,
      }),
      /Atomic pause guard failed/,
    );
    assert.equal(screenshots, 0);
    assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
    assert.equal(
      fake.calls.some((c) => c.method === 'Debugger.resume'),
      false,
    );
    assert.equal(fake.calls.at(-1).method, 'detach');
  }
});

test('an unmet atomic guard times out without leaving a polling timer or late evaluation', async () => {
  const fake = fakePage();
  let screenshots = 0;
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => ({ phase: 2 }),
      pauseWhen: (snapshot) => snapshot.phase === 0,
      screenshot: () => screenshots++,
      pauseTimeoutMs: 20,
    }),
    /deadline exceeded/,
  );
  const count = fake.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(fake.calls.length, count);
  assert.equal(screenshots, 0);
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
  assert.equal(
    fake.calls.some((c) => c.method === 'Debugger.resume'),
    false,
  );
  assert.equal(fake.calls.at(-1).method, 'detach');
});

test('atomic guards require a bounded synchronous read/predicate contract', async () => {
  for (const options of [
    { pauseWhen: () => true },
    { pauseWhen: 1, readCallback: () => ({}) },
    { guardReadCallback: () => ({ phase: 0 }), readCallback: () => ({}) },
    { guardReadCallback: () => ({ phase: 0 }), pauseWhen: () => true },
  ]) {
    const fake = fakePage();
    await assert.rejects(
      captureWithDebuggerPause({
        page: fake.page,
        screenshot: fake.screenshot,
        ...options,
      }),
      /(?:atomic pause guard requires|separate guard read requires)/i,
    );
    assert.equal(fake.calls.length, 0);
  }
});

test('unmet guard retains bounded same-read diagnostics and cleanup without capturing', async () => {
  const fake = fakePage();
  let screenshots = 0;
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => ({ phase: 2, focused: true }),
      pauseWhen: (snapshot) => snapshot.phase === 0,
      describeGuardFailure: (snapshot) => ({
        phase: snapshot.phase,
        focused: snapshot.focused,
      }),
      screenshot: () => screenshots++,
      pauseTimeoutMs: 20,
    }),
    (error) => {
      assert.match(error.message, /deadline exceeded/);
      assert.equal(error.pauseDiagnostics.guardChecks, 1);
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(error.pauseDiagnostics.guardSamples[0].detail),
        ),
        { phase: 2, focused: true },
      );
      assert.equal(error.pauseDiagnostics.guardSamplesOmitted, 0);
      assert.equal(error.pauseDiagnostics.pauseObserved, false);
      assert.deepEqual(error.pauseCleanup, {
        resumed: false,
        disabled: true,
        detached: true,
      });
      return true;
    },
  );
  assert.equal(screenshots, 0);
});

test('guard diagnostics reject asynchronous or oversized results and clean up', async () => {
  for (const describeGuardFailure of [
    async () => ({}),
    () => 'x'.repeat(4097),
  ]) {
    const fake = fakePage();
    await assert.rejects(
      captureWithDebuggerPause({
        page: fake.page,
        readCallback: () => ({ phase: 2 }),
        pauseWhen: () => false,
        describeGuardFailure,
        screenshot: () => {
          throw new Error('must not capture');
        },
        pauseTimeoutMs: 100,
      }),
      /Atomic pause guard failed/,
    );
    assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
    assert.equal(fake.calls.at(-1).method, 'detach');
  }
});

test('guard failure separates host CDP evaluation cost from page read timing', async () => {
  const fake = fakePage({ pauseOnEnable: false });
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => ({
        phase: 2,
        observation: {
          frameNumber: 19,
          pageReadStartedAtMs: 100,
          pageReadCompletedAtMs: 104,
          pageReadDurationMs: 4,
          pixelReadDurationMs: 3,
        },
      }),
      pauseWhen: () => false,
      describeGuardFailure: (snapshot) => snapshot,
      screenshot: fake.screenshot,
      pauseTimeoutMs: 90,
    }),
    (error) => {
      const diagnostics = error.pauseDiagnostics;
      assert.equal(diagnostics.pauseObserved, false);
      assert.ok(diagnostics.debuggerEnableDurationMs >= 0);
      const sample = diagnostics.guardSamples[0];
      assert.ok(sample.hostEvaluationStartedAtMs >= 0);
      assert.ok(
        sample.hostEvaluationCompletedAtMs >= sample.hostEvaluationStartedAtMs,
      );
      assert.ok(sample.hostEvaluationDurationMs >= 0);
      assert.equal(sample.detail.observation.frameNumber, 19);
      assert.equal(sample.detail.observation.pixelReadDurationMs, 3);
      return true;
    },
  );
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
  assert.equal(fake.calls.at(-1).method, 'detach');
});

test('a parked phase advances only after an explicit guard frame request', async () => {
  const context = { phase: 2, requests: 0 };
  const fake = fakePage({ guardContext: context });
  let captures = 0;
  const result = await captureWithDebuggerPause({
    page: fake.page,
    readCallback: () => ({ phase: globalThis.phase }),
    pauseWhen: (snapshot) => snapshot.phase === 0,
    describeGuardFailure: (snapshot) => ({ phase: snapshot.phase }),
    requestNextGuardFrame: (snapshot) => {
      if (snapshot.phase !== 2) return false;
      globalThis.requests++;
      globalThis.phase = 0;
      return true;
    },
    screenshot: () => {
      captures++;
      return Buffer.from('png');
    },
    pauseTimeoutMs: 1000,
  });
  assert.equal(context.requests, 1);
  assert.equal(result.pause.guard.checks, 2);
  assert.ok(result.pause.guard.debuggerEnableDurationMs >= 0);
  assert.equal(result.pause.guard.samples.length, 1);
  assert.equal(
    result.pause.guard.finalEvaluation.interruptedByDebuggerPause,
    true,
  );
  assert.equal(captures, 1);
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
});

test('guard frame callbacks cannot extend ownership with asynchronous work', async () => {
  const fake = fakePage();
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => ({ phase: 2 }),
      pauseWhen: () => false,
      requestNextGuardFrame: async () => true,
      screenshot: () => {
        throw new Error('must not capture');
      },
      pauseTimeoutMs: 100,
    }),
    /Atomic pause guard failed/,
  );
  assert.equal(fake.calls.at(-1).method, 'detach');
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
      'Runtime.evaluate',
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
    ['Debugger.enable', 'Runtime.evaluate', 'Debugger.disable', 'detach'],
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

test('a task that completes without pausing cannot qualify a screenshot', async () => {
  const fake = fakePage({ taskCompletesWithoutPause: true });
  let captures = 0;
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      screenshot: () => captures++,
      pauseTimeoutMs: 100,
    }),
    /completed without pausing/,
  );
  assert.equal(captures, 0);
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
  assert.equal(fake.calls.at(-1).method, 'detach');
});

test('successful capture reports cleanup failure instead of returning early', async () => {
  for (const [flag, failedStage] of [
    ['resumeError', 'resume'],
    ['disableError', 'disable'],
    ['detachError', 'detach'],
  ]) {
    const fake = fakePage({ [flag]: true });
    await assert.rejects(
      captureWithDebuggerPause({
        page: fake.page,
        screenshot: fake.screenshot,
      }),
      (error) =>
        error?.message === 'Paused capture cleanup failed.' &&
        error.cleanupErrors?.some(({ stage }) => stage === failedStage),
    );
  }
});

test('a late enable completion cannot pause the page after timeout cleanup', async () => {
  let resolveEnable;
  const enableGate = new Promise((resolve) => {
    resolveEnable = resolve;
  });
  const fake = fakePage({ enableGate });
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      screenshot: fake.screenshot,
      pauseTimeoutMs: 20,
    }),
    /deadline exceeded/,
  );
  resolveEnable();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    fake.calls.some(({ method }) => method === 'Runtime.evaluate'),
    false,
  );
  assert.equal(fake.session.listenerCount('Debugger.paused'), 0);
  assert.equal(fake.calls.at(-1).method, 'detach');
});

test('a late screenshot result cannot perform another paused read after cleanup', async () => {
  let resolveScreenshot;
  const pending = new Promise((resolve) => {
    resolveScreenshot = resolve;
  });
  const fake = fakePage();
  await assert.rejects(
    captureWithDebuggerPause({
      page: fake.page,
      readCallback: () => 1,
      screenshot: () => pending,
      operationTimeoutMs: 20,
    }),
    /deadline exceeded/,
  );
  resolveScreenshot(Buffer.from('late-png'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    fake.calls.filter(({ method }) => method === 'Debugger.evaluateOnCallFrame')
      .length,
    1,
  );
  assert.equal(fake.calls.at(-1).method, 'detach');
});

test('ineligible snapshots preserve observations and require successful cleanup', async () => {
  const fake = fakePage();
  const result = await captureWithDebuggerPause({
    page: fake.page,
    readCallback: () => ({ phase: 2 }),
    screenshot: () => null,
  });
  assert.equal(result.screenshot, null);
  assert.deepEqual(result.cleanup, {
    resumed: true,
    disabled: true,
    detached: true,
  });
  const broken = fakePage({ resumeError: true });
  await assert.rejects(
    captureWithDebuggerPause({ page: broken.page, screenshot: () => null }),
    /cleanup failed/,
  );
});
