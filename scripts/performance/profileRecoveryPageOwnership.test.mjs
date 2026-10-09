import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('browser close is bounded and invokes only the owned-process fallback', async () => {
  let forced = false;
  const started = Date.now();
  const outcome = await closeRecoveryBrowser(
    { close: () => new Promise(() => {}) },
    {
      timeoutMs: 20,
      forceProcess: async () => {
        forced = true;
      },
    },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(forced, true);
  assert.deepEqual(outcome, {
    closeCompleted: false,
    forcedProcessTermination: true,
  });
});

test('successful browser close is reported without invoking the process fallback', async () => {
  let forced = false;
  const outcome = await closeRecoveryBrowser(
    { close: async () => {} },
    {
      forceProcess: async () => {
        forced = true;
      },
    },
  );
  assert.deepEqual(outcome, {
    closeCompleted: true,
    forcedProcessTermination: false,
  });
  assert.equal(forced, false);
});
