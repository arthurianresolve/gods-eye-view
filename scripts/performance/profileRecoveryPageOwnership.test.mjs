import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  applyRecoveryCleanupFailure,
  assertInitialRecoveryPage,
  assertOwnedRecoveryPage,
  closeOwnedRecoveryPage,
  closeRecoveryBrowser,
  createRecoveryPageTargetGuard,
  countRecoveryApplicationPages,
  recoveryPageCleanupError,
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
  child.exitCode = exitCode;
  child.signalCode = signalCode;
  return child;
}

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
    elapsedMs: 0,
  });
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(outcome.observation.closeStatus, 'completed');
  assert.equal(outcome.observation.closeDeadlineMs, 25);
});

test('an exited process with an unresolved close acknowledgement remains a failure', async () => {
  const child = fakeBrowserProcess();
  const started = Date.now();
  const outcome = await closeRecoveryBrowser(
    {
      process: () => child,
      close: () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        return new Promise(() => {});
      },
    },
    { timeoutMs: 20, forceProcess: async () => {} },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(outcome.observation.closeStatus, 'timed-out');
  assert.equal(outcome.observation.processExitedBeforeClose, false);
  assert.equal(outcome.observation.processExit.code, 0);
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
      },
    },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(forced, true);
  assert.equal(outcome.closeCompleted, false);
  assert.equal(outcome.forcedProcessTermination, true);
  assert.equal(outcome.observation.processExit, null);
  assert.equal(outcome.observation.forceProcessStatus, 'completed');
  assert.equal(child.listenerCount('exit'), 0);
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
