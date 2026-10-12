import assert from 'node:assert/strict';
import test from 'node:test';
import { interceptFixtureSession } from './fixtureInterception.mjs';
import { retireProviderDocument } from './providerDocumentRetirement.mjs';

test('provider document retires rendering before audit and interception teardown', async () => {
  const calls = [];
  const result = await retireProviderDocument({
    retireRenderer: async () => {
      calls.push('retire-renderer');
      return true;
    },
    auditWorkers: async () => calls.push('audit-workers'),
    disposeProgressBinding: async () => calls.push('dispose-binding'),
    stopInterception: async () => calls.push('stop-interception'),
    closeDocument: async () => calls.push('close-document'),
    releaseInterception: async () => calls.push('release-interception'),
  });

  assert.deepEqual(calls, [
    'retire-renderer',
    'audit-workers',
    'dispose-binding',
    'stop-interception',
    'close-document',
    'release-interception',
  ]);
  assert.deepEqual(result, { retired: true, closed: true });
});

test('unconfirmed renderer retirement fails before audits or interception release', async () => {
  const calls = [];
  await assert.rejects(
    retireProviderDocument({
      retireRenderer: async () => {
        calls.push('retire-renderer');
        return false;
      },
      auditWorkers: async () => calls.push('audit-workers'),
      disposeProgressBinding: async () => calls.push('dispose-binding'),
      stopInterception: async () => calls.push('stop-interception'),
      closeDocument: async () => calls.push('close-document'),
      releaseInterception: async () => calls.push('release-interception'),
    }),
    /renderer retirement was not confirmed/,
  );
  assert.deepEqual(calls, ['retire-renderer']);
});

test('an audit failure preserves the interception and document for outer cleanup', async () => {
  const calls = [];
  await assert.rejects(
    retireProviderDocument({
      retireRenderer: async () => {
        calls.push('retire-renderer');
        return true;
      },
      auditWorkers: async () => {
        calls.push('audit-workers');
        throw new Error('worker audit failed');
      },
      disposeProgressBinding: async () => calls.push('dispose-binding'),
      stopInterception: async () => calls.push('stop-interception'),
      closeDocument: async () => calls.push('close-document'),
      releaseInterception: async () => calls.push('release-interception'),
    }),
    /worker audit failed/,
  );
  assert.deepEqual(calls, ['retire-renderer', 'audit-workers']);
});

test('provider retirement cancels external and API requests before target closure, then releases its interceptor', async () => {
  class Session {
    listeners = new Set();
    commands = [];
    on(_event, listener) {
      this.listeners.add(listener);
    }
    off(_event, listener) {
      this.listeners.delete(listener);
    }
    listenerSnapshot() {
      return [...this.listeners];
    }
    async send(method, params) {
      this.commands.push(method);
      if (method === 'Fetch.enable') return {};
      if (method === 'Fetch.disable')
        throw new Error('Fetch.disable must not run for a live target');
      if (
        method !== 'Fetch.continueRequest' &&
        method !== 'Fetch.fulfillRequest'
      )
        throw new Error(`Unexpected protocol command ${method}`);
      return {};
    }
  }

  const client = new Session();
  let resolveResponse;
  let targetClosed = false;
  const controller = await interceptFixtureSession(
    client,
    'http://127.0.0.1:4173/',
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    () => {},
  );
  const listener = client.listenerSnapshot()[0];
  const requests = [
    listener({
      requestId: 'private-external-id',
      request: { url: 'https://external.invalid/tiles.glb', method: 'GET' },
    }),
    listener({
      requestId: 'private-api-id',
      request: { url: 'http://127.0.0.1:4173/api/tiles', method: 'GET' },
    }),
  ];
  await Promise.resolve();
  assert.equal(typeof resolveResponse, 'function');

  const lifecycle = [];
  const result = await retireProviderDocument({
    retireRenderer: async () => {
      lifecycle.push('renderer');
      return true;
    },
    auditWorkers: async () => lifecycle.push('audit'),
    disposeProgressBinding: async () => lifecycle.push('binding'),
    stopInterception: async () => {
      lifecycle.push('stop');
      const stopped = await controller.stopAndDrain();
      assert.equal(stopped.pendingPreparationAtStop, 2);
      assert.equal(stopped.pendingPreparationsAfterDrain, 0);
      return stopped.confirmed;
    },
    closeDocument: async () => {
      lifecycle.push('target-close');
      targetClosed = true;
    },
    releaseInterception: async () => {
      lifecycle.push('release');
      assert.equal(targetClosed, true);
      return controller.releaseSession({ targetClosed });
    },
  });
  await Promise.all(requests);
  resolveResponse(null);

  assert.equal(result.closed, true);
  assert.deepEqual(lifecycle, [
    'renderer',
    'audit',
    'binding',
    'stop',
    'target-close',
    'release',
  ]);
  assert.deepEqual(client.commands, ['Fetch.enable']);
  assert.equal(client.listeners.size, 0);
});
