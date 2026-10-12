import assert from 'node:assert/strict';
import test from 'node:test';
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
    releaseInterception: async () => calls.push('release-interception'),
    closeDocument: async () => calls.push('close-document'),
  });

  assert.deepEqual(calls, [
    'retire-renderer',
    'audit-workers',
    'dispose-binding',
    'release-interception',
    'close-document',
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
      releaseInterception: async () => calls.push('release-interception'),
      closeDocument: async () => calls.push('close-document'),
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
      releaseInterception: async () => calls.push('release-interception'),
      closeDocument: async () => calls.push('close-document'),
    }),
    /worker audit failed/,
  );
  assert.deepEqual(calls, ['retire-renderer', 'audit-workers']);
});
