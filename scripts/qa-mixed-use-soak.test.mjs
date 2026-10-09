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

test('software renderer detection rejects known fallback strings', async () => {
  const { isSoftwareRenderer } = await import('./qa-rendered-soak-driver.mjs');
  assert.equal(
    isSoftwareRenderer('ANGLE (Intel, Intel UHD Graphics 620, D3D11)'),
    false,
  );
  assert.equal(isSoftwareRenderer('ANGLE (Google, SwiftShader)'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
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
