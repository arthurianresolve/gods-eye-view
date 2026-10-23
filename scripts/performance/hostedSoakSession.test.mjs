import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOwnedSoakCloser,
  runHostedSoakSession,
} from './hostedSoakSession.mjs';

const closed = () => ({
  closeCompleted: true,
  forcedProcessTermination: false,
  observation: { closeElapsedMs: 12, processExit: { code: 0, signal: null } },
});
function fixture(overrides = {}) {
  const events = [],
    report = {},
    probeBrowser = {};
  const options = {
    report,
    probeBrowser,
    commit: 'a'.repeat(40),
    closeProbeBrowser: async (browser) => {
      assert.equal(browser, probeBrowser);
      events.push('probe-close');
      return closed();
    },
    createDriver: async () => {
      events.push('driver-create');
      return {
        hardwareRenderingValidated: true,
        close: async () => {
          events.push('driver-close');
          return closed();
        },
      };
    },
    runSoak: async () => {
      events.push('soak');
      return { fullSoak: true, stability: { status: 'passed' } };
    },
    ...overrides,
  };
  return { options, report, events };
}

test('hosted handoff retains distinct probe and measured-browser close evidence', async () => {
  const { options, report, events } = fixture();
  await runHostedSoakSession(options);
  assert.deepEqual(events, [
    'probe-close',
    'driver-create',
    'soak',
    'driver-close',
  ]);
  assert.deepEqual(report.probeBrowserClose, closed());
  assert.deepEqual(report.browserClose, closed());
  assert.notEqual(report.probeBrowserClose, report.browserClose);
  assert.equal(report.soak.candidateCommit, options.commit);
});

for (const outcome of [
  undefined,
  { closeCompleted: false },
  {
    closeCompleted: true,
    forcedProcessTermination: true,
  },
]) {
  test(`incomplete probe cleanup prevents measurement: ${JSON.stringify(outcome)}`, async () => {
    const { options, report, events } = fixture({
      closeProbeBrowser: async () => outcome,
    });
    await assert.rejects(
      runHostedSoakSession(options),
      /did not close normally/,
    );
    assert.deepEqual(events, []);
    assert.match(report.cleanupError, /Probe browser/);
    assert.ok(report.probeBrowserClose);
  });
  test(`incomplete driver cleanup cannot pass: ${JSON.stringify(outcome)}`, async () => {
    const { options, report } = fixture({
      createDriver: async () => ({
        hardwareRenderingValidated: true,
        close: async () => outcome,
      }),
    });
    await assert.rejects(
      runHostedSoakSession(options),
      /did not close normally/,
    );
    assert.equal(report.soak.stability.status, 'passed');
    assert.match(report.cleanupError, /Application soak browser/);
    assert.ok(report.browserClose);
  });
}

test('measurement failure retains partial evidence and wins over secondary cleanup failure', async () => {
  const partial = { operationStatus: 'failed', iterations: 7 };
  const primary = Object.assign(new Error('cycle failed'), {
    soakReport: partial,
  });
  const outcome = { closeCompleted: false, forcedProcessTermination: true };
  const { options, report } = fixture({
    runSoak: async () => {
      throw primary;
    },
    createDriver: async () => ({
      hardwareRenderingValidated: true,
      close: async () => {
        throw Object.assign(new Error('close failed'), {
          browserClose: outcome,
        });
      },
    }),
  });
  await assert.rejects(
    runHostedSoakSession(options),
    (error) => error === primary,
  );
  assert.equal(report.soak, partial);
  assert.equal(report.browserClose, outcome);
  assert.match(report.cleanupError, /did not close normally/);
});

test('failed driver construction retains its cleanup observation without running soak', async () => {
  const primary = Object.assign(new Error('boot failed'), {
    browserClose: closed(),
  });
  const { options, report, events } = fixture({
    createDriver: async () => {
      throw primary;
    },
  });
  await assert.rejects(
    runHostedSoakSession(options),
    (error) => error === primary,
  );
  assert.deepEqual(events, ['probe-close']);
  assert.deepEqual(report.browserClose, closed());
});

test('unverified renderer and failed stability still close the measured browser', async () => {
  for (const accelerated of [true, false]) {
    let closes = 0;
    const { options } = fixture({
      createDriver: async () => ({
        hardwareRenderingValidated: accelerated,
        close: async () => {
          closes++;
          return closed();
        },
      }),
      runSoak: async () => ({
        fullSoak: true,
        stability: { status: 'failed' },
      }),
    });
    await assert.rejects(runHostedSoakSession(options), /did not/);
    assert.equal(closes, 1);
  }
});

test('owned closer shares one bounded cleanup attempt and retains failure observations', async () => {
  for (const success of [true, false]) {
    let calls = 0;
    const browser = {};
    const outcome = success
      ? closed()
      : { closeCompleted: false, forcedProcessTermination: true };
    const close = createOwnedSoakCloser(browser, {
      closeBrowser: async (owned, options) => {
        assert.equal(owned, browser);
        assert.equal(options.timeoutMs, 5000);
        calls++;
        return outcome;
      },
    });
    const a = close(),
      b = close();
    assert.equal(a, b);
    if (success) assert.equal(await a, outcome);
    else await assert.rejects(a, (error) => error.browserClose === outcome);
    assert.equal(calls, 1);
  }
});
