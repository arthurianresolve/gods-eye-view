import assert from 'node:assert/strict';
import test from 'node:test';
import { runMixedUseSoak } from './qa-mixed-use-soak.mjs';

test('soak reports completed driver operations and labels short runs as smoke', async () => {
  let now = 0;
  const report = await runMixedUseSoak({
    durationMs: 100,
    intervalMs: 0,
    now: () => now,
    driver: {
      runCycle: async () => {
        now += 50;
        return {
          sourceToggles: 2,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      },
    },
  });
  assert.equal(report.iterations, 2);
  assert.equal(report.sourceToggles, 4);
  assert.equal(report.fullSoak, false);
  assert.equal(report.hardwareRenderingValidated, false);
});
test('soak fails when an operation is missing or fails', async () => {
  await assert.rejects(
    runMixedUseSoak({ durationMs: 1, driver: { runCycle: async () => ({}) } }),
    /did not complete/,
  );
  await assert.rejects(
    runMixedUseSoak({
      durationMs: 1,
      driver: {
        runCycle: async () => {
          throw new Error('source failed');
        },
      },
    }),
    /source failed/,
  );
});
