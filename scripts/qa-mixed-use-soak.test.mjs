import assert from 'node:assert/strict';
import test from 'node:test';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';

test('mixed-use soak fixture exercises recovery paths without live providers', async () => {
  const report = await runMixedUseSoak({ durationMs: 100, yieldEvery: 4 });
  assert.ok(report.iterations > 0);
  assert.ok(report.sourceToggles > 0);
  assert.ok(report.replaySeeks > 0);
  assert.ok(report.workspaceReloads > 0);
  assert.ok(report.archiveFailures > 0);
  assert.ok(report.cameraRecoveries > 0);
});
