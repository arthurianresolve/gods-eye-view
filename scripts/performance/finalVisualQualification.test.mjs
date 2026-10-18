import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FINAL_VISUAL_QUALIFICATION_SCHEMA,
  FINAL_VISUAL_STATES,
  validateFinalVisualQualification,
} from './finalVisualQualification.mjs';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000004010100c9fe92ef0000000049454e44ae426082',
  'hex',
);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-final-visual-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all(
    FINAL_VISUAL_STATES.flatMap((state) =>
      ['baseline', 'candidate'].map((side) =>
        fs.writeFile(path.join(root, `${state}-${side}.png`), PNG_1X1),
      ),
    ),
  );
  const image = (side) => ({
    path: `${side === 'baseline' ? 'still-settled' : 'still-settled'}-${side}.png`,
    sha256: digest(PNG_1X1),
    dimensions: { width: 1, height: 1 },
  });
  const profile = {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: false,
    resolutionScale: 1,
    maximumScreenSpaceError: 1,
    viewport: { width: 1, height: 1, dpr: 1 },
    drawingBuffer: { width: 1, height: 1 },
  };
  return {
    root,
    report: {
      schema: FINAL_VISUAL_QUALIFICATION_SCHEMA,
      application: {
        baselineSha: 'a'.repeat(40),
        candidateSha: 'b'.repeat(40),
      },
      harness: { baselineSha: 'c'.repeat(40), candidateSha: 'd'.repeat(40) },
      receipts: {
        baselineSha256: 'e'.repeat(64),
        candidateSha256: 'f'.repeat(64),
      },
      environment: {
        platform: 'win32',
        foregroundConfirmed: true,
        renderer: { vendor: 'Intel', device: 'Intel UHD 620' },
        nativeSharpnessProfile: profile,
        populations: ['cctv'],
        camera: { id: 'qa-cctv-final-camera', position: [1, 2, 3] },
      },
      masks: [],
      states: FINAL_VISUAL_STATES.map((id) => ({
        id,
        completedRender: { baseline: true, candidate: true },
        foreground: { baseline: true, candidate: true },
        camera: { id: 'qa-cctv-final-camera', position: [1, 2, 3] },
        nativeSharpnessProfile: profile,
        baseline: { ...image('baseline'), path: `${id}-baseline.png` },
        candidate: { ...image('candidate'), path: `${id}-candidate.png` },
      })),
      teardown: {
        baseline: { browserClosed: true },
        candidate: { browserClosed: true },
      },
    },
  };
}

test('final visual qualification accepts complete native UHD 620 pixel evidence', async (t) => {
  const { root, report } = await fixture(t);
  assert.deepEqual(
    await validateFinalVisualQualification(report, { evidenceRoot: root }),
    {
      schema: FINAL_VISUAL_QUALIFICATION_SCHEMA,
      status: 'passed',
      states: 4,
    },
  );
});

test('final visual qualification rejects masks, missing states, and changed pixels', async (t) => {
  const { root, report } = await fixture(t);
  report.masks = [{ reason: 'hud' }];
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /masks/,
  );
  report.masks = [];
  report.states.pop();
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /states/,
  );
  report.states = [
    ...report.states,
    {
      id: 'hud-restored',
      completedRender: { baseline: true, candidate: true },
      foreground: { baseline: true, candidate: true },
      camera: report.environment.camera,
      nativeSharpnessProfile: report.environment.nativeSharpnessProfile,
      baseline: {
        path: 'hud-restored-baseline.png',
        sha256: digest(PNG_1X1),
        dimensions: { width: 1, height: 1 },
      },
      candidate: {
        path: 'hud-restored-candidate.png',
        sha256: digest(PNG_1X1),
        dimensions: { width: 1, height: 1 },
      },
    },
  ];
  await fs.writeFile(
    path.join(root, 'hud-restored-candidate.png'),
    Buffer.concat([PNG_1X1, Buffer.from([0])]),
  );
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /PNG digest|rendered pixels/,
  );
});

test('final visual qualification rejects evidence paths outside its root', async (t) => {
  const { root, report } = await fixture(t);
  report.states[0].baseline.path = '../outside.png';
  await assert.rejects(
    validateFinalVisualQualification(report, { evidenceRoot: root }),
    /escapes evidence root/,
  );
});
