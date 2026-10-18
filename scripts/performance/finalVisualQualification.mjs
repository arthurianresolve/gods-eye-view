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
  ])
    assert.match(value || '', /^[a-f0-9]{40}$/, `${label} SHA`);
  assert.match(report.receipts?.baselineSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(report.receipts?.candidateSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(report.environment?.platform, 'win32');
  assert.equal(report.environment?.foregroundConfirmed, true);
  assert.equal(report.environment?.renderer?.vendor, 'Intel');
  assert.ok(report.environment?.renderer?.device?.includes('UHD 620'));
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
