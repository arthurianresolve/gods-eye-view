import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const FINAL_VISUAL_QUALIFICATION_SCHEMA =
  'gev-final-visual-qualification/v1';
export const FINAL_VISUAL_STATES = Object.freeze([
  'still-settled',
  'hud-visible',
  'hud-hidden',
  'hud-restored',
]);
export const FINAL_VISUAL_TIME_MS = Date.parse('2026-10-08T12:00:00.000Z');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature))
    throw new Error('PNG signature is invalid.');
  if (bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.length < 24)
    throw new Error('PNG IHDR is missing.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 16_000_000)
    throw new Error(
      'PNG dimensions are outside the bounded qualification limit.',
    );
  return { width, height };
}

function assertProfile(profile, label) {
  assert.equal(profile?.id, 'native-sharpness-v1', `${label} profile id`);
  assert.equal(
    profile.useBrowserRecommendedResolution,
    false,
    `${label} browser resolution`,
  );
  assert.equal(profile.resolutionScale, 1, `${label} resolution scale`);
  assert.equal(profile.maximumScreenSpaceError, 1, `${label} globe SSE`);
  assert.ok(
    Number.isInteger(profile.viewport?.width) && profile.viewport.width > 0,
  );
  assert.ok(
    Number.isInteger(profile.viewport?.height) && profile.viewport.height > 0,
  );
  assert.ok(Number.isFinite(profile.viewport?.dpr) && profile.viewport.dpr > 0);
  assert.deepEqual(
    profile.drawingBuffer,
    {
      width: Math.floor(profile.viewport.width * profile.viewport.dpr),
      height: Math.floor(profile.viewport.height * profile.viewport.dpr),
    },
    `${label} drawing buffer`,
  );
}

function assertContained(file, root, label) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(path.resolve(root), absolute);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${label} path escapes evidence root`,
  );
  return absolute;
}

async function assertPng(record, root, label) {
  assert.equal(typeof record?.path, 'string', `${label} PNG path`);
  const file = assertContained(record.path, root, label);
  const realRoot = await fs.realpath(root);
  const realFile = await fs.realpath(file);
  assert.ok(
    realFile.startsWith(`${realRoot}${path.sep}`),
    `${label} PNG resolves outside evidence root`,
  );
  const info = await fs.lstat(file);
  assert.ok(
    info.isFile() && !info.isSymbolicLink(),
    `${label} PNG must be a regular file`,
  );
  assert.ok(info.size > 24 && info.size <= 16 * 1024 * 1024, `${label} PNG size is outside the bounded limit`);
  const bytes = await fs.readFile(file);
  const dimensions = pngDimensions(bytes);
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.format, 'raw', `${label} PNG did not decode to pixels`);
  assert.equal(decoded.info.width, dimensions.width, `${label} decoded width`);
  assert.equal(decoded.info.height, dimensions.height, `${label} decoded height`);
  assert.equal(record.sha256, sha256(bytes), `${label} PNG digest`);
  assert.deepEqual(record.dimensions, dimensions, `${label} PNG dimensions`);
  return { bytes, pixels: decoded.data, pixelInfo: decoded.info };
}

/** Capture one bounded lossless PNG after the caller has observed a completed render. */
export async function captureQualificationPng(page, outputPath) {
  if (!page || typeof page.screenshot !== 'function')
    throw new TypeError('A Puppeteer page is required for PNG qualification.');
  const bytes = Buffer.from(await page.screenshot({ type: 'png' }));
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error('Qualification PNG exceeds its bounded size.');
  const dimensions = pngDimensions(bytes);
  await fs.writeFile(outputPath, bytes, { flag: 'wx' });
  return { path: path.basename(outputPath), sha256: sha256(bytes), dimensions };
}

export async function validateFinalVisualQualification(
  report,
  { evidenceRoot } = {},
) {
  assert.equal(report?.schema, FINAL_VISUAL_QUALIFICATION_SCHEMA);
  for (const [label, value] of [
    ['application baseline', report.application?.baselineSha],
    ['application candidate', report.application?.candidateSha],
    ['harness baseline', report.harness?.baselineSha],
    ['harness candidate', report.harness?.candidateSha],
    ['build harness', report.harness?.buildHarnessCommit],
    ['visual producer', report.harness?.visualHarnessCommit],
  ])
    assert.match(value || '', /^[a-f0-9]{40}$/, `${label} SHA`);
  assert.match(report.receipts?.baselineSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(report.receipts?.candidateSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(report.environment?.platform, 'win32');
  assert.equal(report.environment?.foregroundConfirmed, true);
  assert.ok(typeof report.environment?.renderer?.vendor === 'string' && report.environment.renderer.vendor);
  assert.match(report.environment?.renderer?.device || '', /UHD\s*620/i);
  assertProfile(report.environment?.nativeSharpnessProfile, 'environment');
  assert.ok(Array.isArray(report.environment?.populations));
  assert.ok(report.environment?.camera?.id);
  assert.deepEqual(
    report.masks,
    [],
    'visual qualification forbids pixel masks',
  );
  assert.deepEqual(
    report.states?.map((state) => state.id),
    FINAL_VISUAL_STATES,
    'visual states must be complete and ordered',
  );
  assert.equal(report.teardown?.baseline?.browserClosed, true);
  assert.equal(report.teardown?.candidate?.browserClosed, true);
  const root = path.resolve(
    evidenceRoot || path.dirname(report.outputRoot || '.'),
  );
  for (const state of report.states) {
    assert.equal(
      state.completedRender?.baseline,
      true,
      `${state.id} baseline render`,
    );
    assert.equal(
      state.completedRender?.candidate,
      true,
      `${state.id} candidate render`,
    );
    assert.equal(
      state.foreground?.baseline,
      true,
      `${state.id} baseline foreground`,
    );
    assert.equal(
      state.foreground?.candidate,
      true,
      `${state.id} candidate foreground`,
    );
    assert.deepEqual(
      state.settings?.baseline,
      state.settings?.candidate,
      `${state.id} per-revision settings differ`,
    );
    assert.ok(state.settings?.baseline && state.settings?.candidate, `${state.id} settings missing`);
    assert.ok(state.populations?.baseline && state.populations?.candidate, `${state.id} populations missing`);
    assertProfile(state.nativeSharpnessProfileByRevision?.baseline, `${state.id} baseline profile`);
    assertProfile(state.nativeSharpnessProfileByRevision?.candidate, `${state.id} candidate profile`);
    assert.ok(Number(state.populations.baseline.cctv) > 0 && Number(state.populations.candidate.cctv) > 0, `${state.id} CCTV population is empty`);
    assert.deepEqual(
      state.populations?.baseline,
      state.populations?.candidate,
      `${state.id} per-revision populations differ`,
    );
    assert.deepEqual(
      state.cameraByRevision?.baseline,
      state.cameraByRevision?.candidate,
      `${state.id} per-revision camera differs`,
    );
    assert.deepEqual(
      state.hud?.baseline,
      state.hud?.candidate,
      `${state.id} per-revision HUD accessibility state differs`,
    );
    assert.ok(state.hud?.baseline && state.hud?.candidate, `${state.id} HUD state missing`);
    const expectedHudVisible = state.id !== 'hud-hidden';
    assert.equal(state.hud.baseline.visible, expectedHudVisible, `${state.id} baseline HUD visibility`);
    assert.equal(state.hud.candidate.visible, expectedHudVisible, `${state.id} candidate HUD visibility`);
    assert.ok(
      Number.isSafeInteger(state.timestampMs?.baseline) &&
        Number.isSafeInteger(state.timestampMs?.candidate),
      `${state.id} timestamps are missing`,
    );
    assert.equal(state.timestampMs.baseline, FINAL_VISUAL_TIME_MS, `${state.id} baseline timestamp`);
    assert.equal(state.timestampMs.candidate, FINAL_VISUAL_TIME_MS, `${state.id} candidate timestamp`);
    assert.deepEqual(
      state.camera,
      report.environment.camera,
      `${state.id} camera`,
    );
    assert.deepEqual(
      state.nativeSharpnessProfile,
      report.environment.nativeSharpnessProfile,
      `${state.id} profile`,
    );
    const baseline = await assertPng(
      state.baseline,
      root,
      `${state.id} baseline`,
    );
    const candidate = await assertPng(
      state.candidate,
      root,
      `${state.id} candidate`,
    );
    assert.deepEqual(baseline.pixelInfo.width && { width: baseline.pixelInfo.width, height: baseline.pixelInfo.height }, {
      width: report.environment.nativeSharpnessProfile.drawingBuffer.width,
      height: report.environment.nativeSharpnessProfile.drawingBuffer.height,
    }, `${state.id} baseline image dimensions`);
    assert.deepEqual(candidate.pixelInfo.width && { width: candidate.pixelInfo.width, height: candidate.pixelInfo.height }, {
      width: report.environment.nativeSharpnessProfile.drawingBuffer.width,
      height: report.environment.nativeSharpnessProfile.drawingBuffer.height,
    }, `${state.id} candidate image dimensions`);
    assert.deepEqual(candidate.pixels, baseline.pixels, `${state.id} decoded rendered pixels changed`);
    assert.deepEqual(candidate.pixelInfo, baseline.pixelInfo, `${state.id} decoded pixel dimensions changed`);
  }
  return {
    schema: report.schema,
    status: 'passed',
    states: report.states.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const reportPath = process.argv[2];
  if (!reportPath)
    throw new Error('Usage: node finalVisualQualification.mjs report.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const result = await validateFinalVisualQualification(report, {
    evidenceRoot: path.dirname(path.resolve(reportPath)),
  });
  console.log(JSON.stringify(result));
}
