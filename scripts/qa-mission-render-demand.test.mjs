import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureTrial,
  parseMissionRenderDemandArgs,
  validateMissionRenderDemandCleanup,
} from './qa-mission-render-demand.mjs';

test('mission render-demand runner accepts only an output path option', () => {
  assert.deepEqual(parseMissionRenderDemandArgs([]), {
    out: 'qa-artifacts/mission-render-demand.json',
  });
  assert.deepEqual(parseMissionRenderDemandArgs(['--out', 'qa/test.json']), {
    out: 'qa/test.json',
  });
  assert.throws(() =>
    parseMissionRenderDemandArgs(['--url', 'http://localhost']),
  );
  assert.throws(() => parseMissionRenderDemandArgs(['--out']));
});

test('cleanup acceptance requires normal owned browser, page, and server close', () => {
  assert.equal(
    validateMissionRenderDemandCleanup({
      pageClosed: true,
      browserClose: {
        closeCompleted: true,
        forcedProcessTermination: false,
      },
      viteClosed: true,
    }),
    true,
  );
  for (const cleanup of [
    {
      pageClosed: false,
      browserClose: { closeCompleted: true },
      viteClosed: true,
    },
    {
      pageClosed: true,
      browserClose: { closeCompleted: false },
      viteClosed: true,
    },
    {
      pageClosed: true,
      browserClose: { closeCompleted: true, forcedProcessTermination: true },
      viteClosed: true,
    },
    {
      pageClosed: true,
      browserClose: { closeCompleted: true },
      viteClosed: false,
    },
  ])
    assert.throws(() => validateMissionRenderDemandCleanup(cleanup));
});

test('capture orchestration returns validator identity and endpoint camera fields', async () => {
  const camera = {
    position: [1, 2, 3],
    direction: [0, 0, -1],
    up: [0, 1, 0],
  };
  const cleanup = {
    layerDestroyed: true,
    viewerDestroyed: true,
    remainingLayerEntityCount: 0,
    remainingViewerDestroyed: true,
    governorAfterLayerDestroy: { holds: [], scheduledUpdates: [] },
    governorAfterUninstall: {
      installed: false,
      holds: [],
      scheduledUpdates: [],
    },
  };
  const trial = {
    status: 'passed',
    scenario: 'static-empty',
    variant: 'continuous-control',
    before: { camera },
    after: { camera },
    endpointPngSha256: null,
    endpointPngBytes: 0,
  };
  const pngDataUrl = `data:image/png;base64,${Buffer.alloc(128, 7).toString('base64')}`;
  let evaluateCall = 0;
  const page = {
    async select() {},
    async click() {},
    async waitForFunction() {},
    async evaluate() {
      evaluateCall += 1;
      if (evaluateCall === 2) return { trial, pngDataUrl };
      if (evaluateCall === 3) return cleanup;
      return undefined;
    },
  };

  const captured = await captureTrial(page, {
    scenario: 'static-empty',
    variant: 'continuous-control',
    repeat: 3,
    durationMs: 10_000,
    timeoutMs: 12_000,
  });
  assert.equal(captured.status, 'passed');
  assert.equal(captured.repeat, 3);
  assert.deepEqual(captured.cameraPose, camera);
  assert.equal(captured.endpointPngBytes, 128);
  assert.equal(captured.cleanup, cleanup);
});
