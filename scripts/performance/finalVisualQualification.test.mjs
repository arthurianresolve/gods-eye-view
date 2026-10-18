import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  FINAL_VISUAL_QUALIFICATION_SCHEMA,
  FINAL_VISUAL_STATES,
  validateFinalVisualQualification,
} from './finalVisualQualification.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(t) {
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } } }).png().toBuffer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-final-visual-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all(
    FINAL_VISUAL_STATES.flatMap((state) =>
      ['baseline', 'candidate'].map((side) =>
        fs.writeFile(path.join(root, `${state}-${side}.png`), png),
      ),
    ),
  );
  const image = (side) => ({
    path: `${side === 'baseline' ? 'still-settled' : 'still-settled'}-${side}.png`,
    sha256: digest(png),
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
      harness: { baselineSha: 'c'.repeat(40), candidateSha: 'c'.repeat(40), buildHarnessCommit: 'c'.repeat(40), visualHarnessCommit: 'd'.repeat(40) },
      receipts: {
        baselineSha256: 'e'.repeat(64),
        candidateSha256: 'f'.repeat(64),
      },
      environment: {
        platform: 'win32',
        foregroundConfirmed: true,
        renderer: { vendor: 'Google Inc.', device: 'ANGLE (Intel, Intel UHD 620) Direct3D11', browserVersion: 'Chrome/131.0.0.0' },
        nativeSharpnessProfile: profile,
        populations: ['cctv'],
        camera: { id: 'qa-cctv-final-camera', position: [1, 2, 3] },
      },
      masks: [],
      states: FINAL_VISUAL_STATES.map((id) => ({
        id,
        completedRender: { baseline: { frameNumber: 1, elapsedMs: 1 }, candidate: { frameNumber: 2, elapsedMs: 1 } },
        foreground: { baseline: { status: 'foreground-confirmed', foregroundConfirmed: true, foregroundPid: 1 }, candidate: { status: 'foreground-confirmed', foregroundConfirmed: true, foregroundPid: 1 } },
        camera: { id: 'qa-cctv-final-camera', position: [1, 2, 3] },
        cameraByRevision: { baseline: { id: 'qa-cctv-final-camera', position: [1, 2, 3] }, candidate: { id: 'qa-cctv-final-camera', position: [1, 2, 3] } },
        nativeSharpnessProfile: profile,
        nativeSharpnessProfileByRevision: { baseline: profile, candidate: profile },
        settings: { baseline: { qualityMode: 'manual', densityPct: 75, detectionMode: 'DENSE' }, candidate: { qualityMode: 'manual', densityPct: 75, detectionMode: 'DENSE' } },
        populations: { baseline: { cctv: 1 }, candidate: { cctv: 1 } },
        hud: { baseline: { visible: id !== 'hud-hidden' }, candidate: { visible: id !== 'hud-hidden' } },
        timestampMs: { baseline: Date.parse('2026-10-08T12:00:00.000Z'), candidate: Date.parse('2026-10-08T12:00:00.000Z') },
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
  const png = await fs.readFile(path.join(root, 'still-settled-baseline.png'));
  report.states = [
    ...report.states,
    {
      id: 'hud-restored',
      completedRender: { baseline: { frameNumber: 1, elapsedMs: 1 }, candidate: { frameNumber: 2, elapsedMs: 1 } },
      foreground: { baseline: { status: 'foreground-confirmed', foregroundConfirmed: true, foregroundPid: 1 }, candidate: { status: 'foreground-confirmed', foregroundConfirmed: true, foregroundPid: 1 } },
      camera: report.environment.camera,
      cameraByRevision: { baseline: report.environment.camera, candidate: report.environment.camera },
      nativeSharpnessProfile: report.environment.nativeSharpnessProfile,
      nativeSharpnessProfileByRevision: { baseline: report.environment.nativeSharpnessProfile, candidate: report.environment.nativeSharpnessProfile },
      settings: { baseline: { qualityMode: 'manual', densityPct: 75, detectionMode: 'DENSE' }, candidate: { qualityMode: 'manual', densityPct: 75, detectionMode: 'DENSE' } },
      populations: { baseline: { cctv: 1 }, candidate: { cctv: 1 } },
      hud: { baseline: { visible: id !== 'hud-hidden' }, candidate: { visible: id !== 'hud-hidden' } },
      timestampMs: { baseline: Date.parse('2026-10-08T12:00:00.000Z'), candidate: Date.parse('2026-10-08T12:00:00.000Z') },
      baseline: {
        path: 'hud-restored-baseline.png',
        sha256: digest(png),
        dimensions: { width: 1, height: 1 },
      },
      candidate: {
        path: 'hud-restored-candidate.png',
        sha256: digest(png),
        dimensions: { width: 1, height: 1 },
      },
    },
  ];
  await fs.writeFile(
    path.join(root, 'hud-restored-candidate.png'),
    Buffer.concat([png, Buffer.from([0])]),
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
