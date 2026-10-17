import test from 'node:test';
import assert from 'node:assert/strict';
import { runInstallRecoveryFixture } from './qa-install-recovery.mjs';

test('install recovery fixture preserves workspaces, settings, assets and references', async () => {
  const result = await runInstallRecoveryFixture({ platform: 'fixture' });
  assert.deepEqual(result.checks, [
    'verified-prior-artifact',
    'interrupted-copy-rejected',
    'checksum-failure-recovery',
    'bundle-asset-reopen',
  ]);
});
