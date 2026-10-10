import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  applyRecoveryCleanupFailure,
  assertInitialRecoveryPage,
  assertOwnedRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  createRecoveryBrowserCloseTrace,
  createRecoveryPageTargetGuard,
  countRecoveryApplicationPages,
  recoveryPageCleanupError,
  stopOwnedRecoveryProcessTree,
} from './profileRecoveryPageOwnership.mjs';

const BASE = 'http://127.0.0.1:4173';
const page = (url) => ({ url: () => url });

test('each recovery launch requires exactly one initial blank page', () => {
  const blank = page('about:blank');
  assert.equal(assertInitialRecoveryPage([blank], BASE), blank);
  assert.throws(() => assertInitialRecoveryPage([], BASE), /exactly one/);
  assert.throws(
    () => assertInitialRecoveryPage([blank, page('about:blank')], BASE),
    /exactly one/,
  );
  assert.throws(
    () =>
      assertInitialRecoveryPage(
        [blank, page('https://unrelated.example/')],
        BASE,
      ),
    /exactly one/,
  );
  const restoredApp = page(BASE + '/');
  assert.equal(countRecoveryApplicationPages([restoredApp], BASE), 1);
  assert.throws(
    () => assertInitialRecoveryPage([blank, restoredApp], BASE),
    /1 app pages/,
  );
});

test('post-navigation invariant requires the sole app page to be owned', () => {
  const owned = page(BASE + '/?welcome=0');
  assert.equal(assertOwnedRecoveryPage([owned], owned, BASE), 1);
  assert.throws(
    () => assertOwnedRecoveryPage([owned, page(BASE + '/')], owned, BASE),
    /found 2 pages \(2 app pages\)/,
  );
  assert.throws(
    () => assertOwnedRecoveryPage([page(BASE + '/')], owned, BASE),
    /owned by this recovery stage/,
  );
});

test('target guard rejects even a transient extra page target', () => {
  const listeners = new Map();
  const browser = {
    on: (event, listener) => listeners.set(event, listener),
    off: (event) => listeners.delete(event),
  };
  const target = () => ({ type: () => 'page' });
  const ownedTarget = target();
  const ownedPage = { target: () => ownedTarget };
  const guard = createRecoveryPageTargetGuard(browser);
  listeners.get('targetcreated')(ownedTarget);
  assert.equal(guard.assertOnlyOwnedPageTarget(ownedPage), 1);
  const transient = target();
  listeners.get('targetcreated')(transient);
  assert.equal(guard.unexpectedPageTargetCount(ownedPage), 1);
  assert.throws(
    () => guard.assertOnlyOwnedPageTarget(ownedPage),
    /Unexpected page targets/,
  );
  guard.dispose();
  assert.equal(listeners.has('targetcreated'), false);
});

test('owned page closes before browser close and leaves zero open pages', async () => {
  const order = [];
  let remaining = [page(BASE + '/')];
  const owned = {
    url: () => BASE + '/',
    isClosed: () => false,
    close: async () => {
      order.push('page-close');
      remaining = [];
    },
  };
  const browser = {
    pages: async () => remaining,
    close: async () => order.push('browser-close'),
  };
  const outcome = await closeOwnedRecoveryPage(owned, browser);
  assert.deepEqual(outcome, { closeCompleted: true, openPageCount: 0 });
  await browser.close();
  assert.deepEqual(order, ['page-close', 'browser-close']);
});

test('wedged owned-page close is bounded and reported as incomplete', async () => {
  const owned = {
    isClosed: () => false,
    close: () => new Promise(() => {}),
  };
  const browser = { pages: async () => [owned] };
  const started = Date.now();
  const outcome = await closeOwnedRecoveryPage(owned, browser, 20);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(outcome, { closeCompleted: false, openPageCount: null });
});

test('a passed workspace check still fails when cleanup leaves a page open', () => {
  assert.equal(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 0,
    }),
    null,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: false,
      openPageCount: null,
      unexpectedCreatedPageTargets: 0,
    }).message,
    /cleanup failed/,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 1,
    }).message,
    /Unexpected page targets/,
  );
  assert.match(
    recoveryPageCleanupError({
      closeCompleted: true,
      openPageCount: 0,
      unexpectedCreatedPageTargets: 0,
      browserCloseCompleted: false,
    }).message,
    /Graceful browser close/,
  );
});

function fakeBrowserProcess({ exitCode = null, signalCode = null } = {}) {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = exitCode;
  child.signalCode = signalCode;
  return child;
}

test('owned process stop distinguishes pre-existing exit from confirmed taskkill', async () => {
  const exited = fakeBrowserProcess({ exitCode: 0 });
  let spawnCalls = 0;
  assert.deepEqual(
    await stopOwnedRecoveryProcessTree(exited, {
      platform: 'win32',
      spawnImpl: () => {
        spawnCalls += 1;
      },
    }),
    { attempted: false, confirmed: true, reason: 'already-exited' },
  );
  assert.equal(spawnCalls, 0);

  const child = fakeBrowserProcess();
  const killer = new EventEmitter();
  killer.kill = () => false;
  const stopped = await stopOwnedRecoveryProcessTree(child, {
    platform: 'win32',
    spawnImpl: () => {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        killer.emit('exit', 0);
      });
      return killer;
    },
  });
  assert.deepEqual(stopped, {
    attempted: true,
    confirmed: true,
    reason: 'process-exit-observed',
  });
  assert.equal(killer.listenerCount('exit'), 0);
  assert.equal(killer.listenerCount('error'), 0);
});

test('owned process stop does not claim an exit after failed taskkill and bounds a stuck helper', async () => {
  const child = fakeBrowserProcess();
  const failedKiller = new EventEmitter();
  failedKiller.kill = () => false;
  const failed = await stopOwnedRecoveryProcessTree(child, {
    platform: 'win32',
    spawnImpl: () => {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        failedKiller.emit('exit', 1);
      });
      return failedKiller;
    },
  });
  assert.deepEqual(failed, {
    attempted: true,
    confirmed: false,
    reason: 'exit-during-failed-request',
  });

  const stuckChild = fakeBrowserProcess();
  const stuckKiller = new EventEmitter();
  let killed = false;
  stuckKiller.kill = () => {
    killed = true;
    return true;
  };
  const timeout = await stopOwnedRecoveryProcessTree(stuckChild, {
    platform: 'win32',
    helperTimeoutMs: 10,
    spawnImpl: () => stuckKiller,
  });
  assert.equal(timeout.reason, 'request-failed');
  assert.equal(timeout.confirmed, false);
  assert.equal(killed, true);
  assert.equal(stuckKiller.listenerCount('exit'), 0);
  assert.equal(stuckKiller.listenerCount('error'), 0);
  assert.equal(stuckChild.listenerCount('exit'), 0);
});

test('browser close records an already-exited process and releases listeners', async () => {
  const child = fakeBrowserProcess({ exitCode: 0 });
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => {} },
    { timeoutMs: 25, forceProcess: async () => (forced = true) },
  );
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(forced, false);
  assert.equal(outcome.observation.processExitedBeforeClose, true);
  assert.deepEqual(outcome.observation.processExit, {
    code: 0,
    signal: null,
    elapsedMs: null,
  });
  assert.equal(outcome.observation.forceProcessStatus, 'not-needed');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.closeDeadlineMs, 25);
});

test('close trace ignores unrelated and pre-close protocol text without retaining it', () => {
  let now = 10;
  const trace = createRecoveryBrowserCloseTrace({ now: () => now });
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
  const unrelated = trace.logger('puppeteer:error');
  assert.equal(unrelated, undefined);
  send(JSON.stringify({ method: 'Browser.close', id: 4, secret: 'before' }));
  trace.begin();
  send(JSON.stringify({ method: 'Page.navigate', id: 5, url: 'secret-url' }));
  receive(JSON.stringify({ id: 5, result: { secret: 'response' } }));
  now = 15;
  send(JSON.stringify({ method: 'Browser.close', id: 6 }));
  receive(JSON.stringify({ id: 6, sessionId: 'worker-session', result: {} }));
  receive(JSON.stringify({ id: 6, method: 'Target.attachedToTarget' }));
  const summary = trace.finish(5);
  assert.equal(summary.browserCloseRequestSeen, true);
  assert.equal(summary.browserCloseAcknowledgementSeen, false);
  assert.equal(summary.protocolMessageCount, 5);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  send(JSON.stringify({ method: 'Browser.close', id: 6 }));
  assert.equal(trace.finish(5), null);
});

test('close trace correlates Browser.close acknowledgement but keeps process wait separate', async () => {
  const child = fakeBrowserProcess();
  const trace = createRecoveryBrowserCloseTrace();
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
  const browser = new EventEmitter();
  browser.process = () => child;
  browser.close = () => {
    send(
      JSON.stringify({
        method: 'Browser.close',
        id: 42,
        params: { secretUrl: 'https://private.invalid/?token=secret' },
      }),
    );
    receive(JSON.stringify({ id: 42, result: {} }));
    browser.emit('disconnected');
    return new Promise(() => {});
  };
  const outcome = await closeRecoveryBrowser(browser, {
    timeoutMs: 20,
    closeTrace: trace,
    forceProcess: async () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      return { attempted: true, confirmed: true };
    },
  });
  const protocol = outcome.observation.protocolCloseTrace;
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(protocol.browserCloseRequestSeen, true);
  assert.equal(protocol.browserCloseAcknowledgementSeen, true);
  assert.equal(protocol.browserCloseAcknowledgementError, false);
  assert.equal(protocol.browserCloseAcknowledgementLate, false);
  assert.equal(protocol.protocolObservationComplete, true);
  assert.equal(protocol.browserDisconnected, true);
  assert.equal(outcome.observation.processExit.code, 0);
  assert.equal(browser.listenerCount('disconnected'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(JSON.stringify(protocol).includes('secret'), false);
});

test('close trace distinguishes missing and late acknowledgements and bounds messages', () => {
  let now = 0;
  const trace = createRecoveryBrowserCloseTrace({ now: () => now });
  const send = trace.logger('puppeteer:protocol:SEND ▶');
  const receive = trace.logger('puppeteer:protocol:RECV ◀');
  trace.begin();
  send(JSON.stringify({ method: 'Browser.close', id: 12 }));
  now = 25;
  receive(JSON.stringify({ id: 12, result: {} }));
  const late = trace.finish(20);
  assert.equal(late.browserCloseAcknowledgementSeen, true);
  assert.equal(late.browserCloseAcknowledgementLate, true);

  const errorTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const errorSend = errorTrace.logger('puppeteer:protocol:SEND ▶');
  const errorReceive = errorTrace.logger('puppeteer:protocol:RECV ◀');
  errorTrace.begin();
  errorSend(JSON.stringify({ method: 'Browser.close', id: 13 }));
  errorReceive(
    JSON.stringify({ id: 13, error: { message: 'sensitive protocol error' } }),
  );
  const rejectedAck = errorTrace.finish(100);
  assert.equal(rejectedAck.browserCloseAcknowledgementSeen, true);
  assert.equal(rejectedAck.browserCloseAcknowledgementError, true);
  assert.equal(JSON.stringify(rejectedAck).includes('sensitive'), false);

  const missingTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const missingSend = missingTrace.logger('puppeteer:protocol:SEND ▶');
  missingTrace.begin();
  missingSend('{ malformed Browser.close');
  const missing = missingTrace.finish(20);
  assert.equal(missing.browserCloseRequestSeen, false);
  assert.equal(missing.browserCloseAcknowledgementSeen, false);
  assert.equal(missing.malformedCloseMessage, true);
  assert.equal(missing.protocolObservationComplete, true);

  const boundedTrace = createRecoveryBrowserCloseTrace({ now: () => now });
  const boundedSend = boundedTrace.logger('puppeteer:protocol:SEND ▶');
  boundedTrace.begin();
  for (let index = 0; index < 65; index++)
    boundedSend(JSON.stringify({ method: 'Page.reload', id: index }));
  const bounded = boundedTrace.finish(20);
  assert.equal(bounded.protocolMessageCount, 64);
  assert.equal(bounded.protocolMessageOverflow, true);
  assert.equal(bounded.protocolObservationComplete, false);
});

test('an exited process with an unresolved close acknowledgement remains a failure', async () => {
  const child = fakeBrowserProcess();
  const started = Date.now();
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    {
      process: () => child,
      close: () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        return new Promise(() => {});
      },
    },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
        return { attempted: true, confirmed: true };
      },
    },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(forced, false);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(outcome.observation.processExitedBeforeClose, false);
  assert.equal(outcome.observation.processExit.code, 0);
  assert.equal(outcome.observation.forceProcessStatus, 'already-exited');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('a live process timeout invokes bounded owned-process cleanup and stays failed', async () => {
  const child = fakeBrowserProcess();
  let forced = false;
  const started = Date.now();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
        return { attempted: true, confirmed: true };
      },
    },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(forced, true);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(outcome.observation.processExit, null);
  assert.equal(outcome.observation.forceProcessStatus, 'confirmed');
  assert.equal(outcome.observation.forceProcessAttempted, true);
  assert.equal(child.listenerCount('exit'), 0);
});

test('a resolved but unconfirmed process stop is not reported as termination', async () => {
  const child = fakeBrowserProcess();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    { timeoutMs: 20, forceProcess: async () => ({ attempted: true }) },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.forceProcessStatus, 'unconfirmed');
  assert.equal(outcome.observation.forceProcessAttempted, true);
});

test('an exit racing with the force callback is not reported as forced termination', async () => {
  const child = fakeBrowserProcess();
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        return { attempted: false, confirmed: true, reason: 'already-exited' };
      },
    },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.forceProcessStatus, 'already-exited');
  assert.equal(outcome.observation.forceProcessAttempted, false);
  assert.equal(outcome.observation.forceProcessCallbackInvoked, true);
  assert.equal(outcome.observation.processExit.code, 0);
});

test('close rejection is distinguished and failed forced cleanup is reported', async () => {
  const child = fakeBrowserProcess();
  const failure = Object.assign(new Error('message intentionally omitted'), {
    name: 'ProtocolError',
  });
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => Promise.reject(failure) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        throw new Error('force failure');
      },
    },
  );
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.closeStatus, 'rejected');
  assert.equal(outcome.observation.closeRejectionName, 'ProtocolError');
  assert.equal(outcome.observation.forceProcessStatus, 'rejected');
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(
    JSON.stringify(outcome).includes('message intentionally'),
    false,
  );
  assert.equal(JSON.stringify(outcome).includes('force failure'), false);
});

test('successful close clears the deadline and does not invoke fallback', async () => {
  const child = fakeBrowserProcess();
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    { process: () => child, close: async () => {} },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(outcome.closeCompleted, true);
  assert.equal(outcome.forcedProcessTermination, false);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.forceProcessStatus, 'not-needed');
  assert.equal(forced, false);
  assert.equal(child.listenerCount('exit'), 0);
});

test('cleanup failure becomes primary only after an otherwise-passed check', () => {
  const cleanupError = new Error('Graceful browser close did not complete.');
  const passed = { status: 'passed', pageOwnership: {} };
  assert.deepEqual(applyRecoveryCleanupFailure(passed, cleanupError), {
    becamePrimaryFailure: true,
    shouldThrow: true,
  });
  assert.equal(passed.step, 'owned-page-cleanup');
  assert.equal(passed.error, cleanupError.message);

  const earlierFailure = {
    status: 'failed',
    step: 'application-ready',
    error: 'startup failed',
    pageOwnership: {},
  };
  assert.deepEqual(applyRecoveryCleanupFailure(earlierFailure, cleanupError), {
    becamePrimaryFailure: false,
    shouldThrow: false,
  });
  assert.equal(earlierFailure.step, 'application-ready');
  assert.equal(earlierFailure.error, 'startup failed');
  assert.equal(earlierFailure.pageOwnership.cleanupError, cleanupError.message);
});
