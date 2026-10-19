import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  cleanupExclusiveConsoleMessageHandleOwner,
  createExclusiveConsoleMessageHandleOwner,
  readConsoleMessageHandleOwnership,
} from './consoleMessageOwnership.mjs';

class MockPage extends EventEmitter {
  workers() {
    return this.workerTargets || [];
  }
}

function message(handles) {
  return { args: () => handles };
}

test('disposes page console args when the page and workers have no other consumers', async () => {
  const page = new MockPage();
  const owner = createExclusiveConsoleMessageHandleOwner(page);
  let disposed = 0;
  page.on('console', (event) => owner.disposeMessageArgsIfExclusive(event));

  page.emit(
    'console',
    message([{ dispose: () => disposed++ }, { dispose: () => disposed++ }]),
  );

  assert.equal(disposed, 2);
  assert.deepEqual(await owner.drain(), {
    disposed: 2,
    skipped: 0,
    pending: 0,
    errors: 0,
  });
});

test('skips handles shared with another page or worker console consumer', async () => {
  const page = new MockPage();
  const owner = createExclusiveConsoleMessageHandleOwner(page);
  let disposed = 0;
  page.on('console', (event) => owner.disposeMessageArgsIfExclusive(event));
  page.on('console', () => {});
  page.emit('console', message([{ dispose: () => disposed++ }]));
  page.off('console', page.listeners('console')[1]);

  const worker = new EventEmitter();
  worker.on('console', () => {});
  page.workerTargets = [worker];
  page.emit('console', message([{ dispose: () => disposed++ }]));

  assert.equal(disposed, 0);
  assert.deepEqual(owner.snapshot(), {
    disposed: 0,
    skipped: 2,
    pending: 0,
    errors: 0,
  });
});

test('counts rejected and synchronously thrown disposals without leaking pending work', async () => {
  const page = new MockPage();
  const owner = createExclusiveConsoleMessageHandleOwner(page);
  page.on('console', (event) => owner.disposeMessageArgsIfExclusive(event));
  page.emit(
    'console',
    message([
      { dispose: () => Promise.reject(new Error('rejected')) },
      {
        dispose: () => {
          throw new Error('thrown');
        },
      },
    ]),
  );

  assert.deepEqual(await owner.drain(), {
    disposed: 0,
    skipped: 0,
    pending: 0,
    errors: 2,
  });
});

test('cleanup unsubscribes first and drains outstanding disposal promises', async () => {
  const page = new MockPage();
  const owner = createExclusiveConsoleMessageHandleOwner(page);
  let complete;
  const listener = (event) => owner.disposeMessageArgsIfExclusive(event);
  page.on('console', listener);
  page.emit(
    'console',
    message([
      { dispose: () => new Promise((resolve) => (complete = resolve)) },
    ]),
  );
  assert.equal(owner.snapshot().pending, 1);

  const cleanup = cleanupExclusiveConsoleMessageHandleOwner(
    page,
    listener,
    owner,
  );
  assert.equal(page.listenerCount('console'), 0);
  complete();
  assert.deepEqual(await cleanup, {
    disposed: 1,
    skipped: 0,
    pending: 0,
    errors: 0,
  });
});

test('bounded drain times out without hiding still-pending disposals', async () => {
  const page = new MockPage();
  const owner = createExclusiveConsoleMessageHandleOwner(page);
  page.on('console', (event) => owner.disposeMessageArgsIfExclusive(event));
  let complete;
  page.emit(
    'console',
    message([
      { dispose: () => new Promise((resolve) => (complete = resolve)) },
    ]),
  );

  await assert.rejects(owner.drain({ timeoutMs: 5 }), {
    name: 'ConsoleHandleDrainTimeoutError',
  });
  assert.equal(owner.snapshot().pending, 1);
  complete();
  assert.equal((await owner.drain({ timeoutMs: 100 })).pending, 0);
});

test('disabled ownership diagnostics are unavailable rather than zero-filled', () => {
  assert.equal(readConsoleMessageHandleOwnership(null), null);
});
