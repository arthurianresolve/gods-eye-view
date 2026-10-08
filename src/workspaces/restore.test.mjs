import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceDocument } from './document.js';
import { createWorkspaceRestoreCoordinator } from './restore.js';

function stored(id = 'workspace-one', overrides = {}) {
  return {
    document: createWorkspaceDocument({
      id,
      title: id,
      view: { camera: { lat: 0, lon: 0 } },
      ...overrides,
    }),
    chunks: {},
    assets: {},
  };
}

test('restore validates, inspects availability, stages, then applies the requested workspace', async (t) => {
  const calls = [];
  const restore = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    inspectAvailability: async (document) => {
      calls.push(['inspect', document.id]);
      return [{ kind: 'asset', id: 'asset-missing', status: 'unavailable' }];
    },
    prepare: async (document, { availability }) => {
      calls.push(['prepare', availability.length]);
      return { stagedId: document.id };
    },
    captureCurrent: async () => ({ before: true }),
    apply: async (staged, context) => {
      calls.push(['apply', staged.stagedId, context.availability[0].status]);
      return 'restored';
    },
  });
  t.after(() => restore.destroy());
  const result = await restore.restore('workspace-one');
  assert.equal(result.status, 'applied');
  assert.equal(result.result, 'restored');
  assert.deepEqual(calls, [
    ['inspect', 'workspace-one'],
    ['prepare', 1],
    ['apply', 'workspace-one', 'unavailable'],
  ]);
  assert.equal(restore.getState().status, 'applied');
});

test('new restore requests supersede delayed staging and late work never applies', async (t) => {
  let releaseFirst;
  const applied = [];
  const restore = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    prepare: async (document) => {
      if (document.id === 'slow')
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      return document;
    },
    apply: async (document) => applied.push(document.id),
  });
  t.after(() => restore.destroy());
  const slow = restore.restore('slow');
  await new Promise((resolve) => setImmediate(resolve));
  const fast = await restore.restore('fast');
  releaseFirst();
  assert.deepEqual(await slow, { status: 'superseded' });
  assert.equal(fast.status, 'applied');
  assert.deepEqual(applied, ['fast']);
});

test('failed application rolls the captured state back and user navigation wins over late restore', async (t) => {
  const calls = [];
  const restore = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    captureCurrent: async () => ({ before: 'old' }),
    apply: async () => {
      throw new Error('restore failed');
    },
    rollback: async (snapshot) => calls.push(snapshot.before),
  });
  t.after(() => restore.destroy());
  const failed = await restore.restore('workspace-one');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rolledBack, true);
  assert.deepEqual(calls, ['old']);

  let navigationCurrent = true;
  let applied = false;
  const superseded = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    isCurrent: () => navigationCurrent,
    apply: async () => {
      applied = true;
    },
  });
  t.after(() => superseded.destroy());
  navigationCurrent = false;
  assert.deepEqual(await superseded.restore('workspace-one'), {
    status: 'superseded',
  });
  assert.equal(applied, false);
});

test('missing workspaces and unknown future documents fail before mutation', async (t) => {
  let applyCount = 0;
  const restore = createWorkspaceRestoreCoordinator({
    storage: {
      getWorkspace: async (id) =>
        id === 'missing'
          ? null
          : {
              document: { kind: 'investigation-workspace', schemaVersion: 50 },
            },
    },
    apply: async () => applyCount++,
  });
  t.after(() => restore.destroy());
  assert.deepEqual(await restore.restore('missing'), { status: 'missing' });
  assert.equal((await restore.restore('future')).status, 'failed');
  assert.equal(applyCount, 0);
});

test('caller cancellation and superseding navigation leave a terminal status', async (t) => {
  let releasePrepare;
  const controller = new AbortController();
  const cancelled = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    prepare: async (document) => {
      await new Promise((resolve) => {
        releasePrepare = resolve;
      });
      return document;
    },
    apply: async () => assert.fail('cancelled restore must not apply'),
  });
  t.after(() => cancelled.destroy());
  const pending = cancelled.restore('workspace-one', {
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort('user navigated away');
  releasePrepare();
  assert.deepEqual(await pending, { status: 'superseded' });
  assert.equal(cancelled.getState().status, 'cancelled');

  let navigationCurrent = true;
  let releaseAvailability;
  const superseded = createWorkspaceRestoreCoordinator({
    storage: { getWorkspace: async (id) => stored(id) },
    isCurrent: () => navigationCurrent,
    inspectAvailability: async () => {
      await new Promise((resolve) => {
        releaseAvailability = resolve;
      });
      return [];
    },
    apply: async () => assert.fail('superseded restore must not apply'),
  });
  t.after(() => superseded.destroy());
  const navigation = superseded.restore('workspace-one', {
    navigationToken: 'route-1',
  });
  await new Promise((resolve) => setImmediate(resolve));
  navigationCurrent = false;
  releaseAvailability();
  assert.deepEqual(await navigation, { status: 'superseded' });
  assert.equal(superseded.getState().status, 'superseded');
});
