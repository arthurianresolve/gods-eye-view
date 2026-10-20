import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  presentationStayedSettled,
  visualReadinessInputsMatch,
} from './visualPresentationBoundary.mjs';
import {
  VISIBLE_CONTROL_VARIANCE_POLICY,
  validateVisibleControlVariance,
} from './visibleControlVariance.mjs';
import {
  CANONICAL_POINTER_HISTORY,
  assertCanonicalPointerHistory,
  readCanonicalPointerMutationSequence,
} from './canonicalPointerHistory.mjs';
import {
  FULL_EXTENT_POINTER_SWEEP_POLICY,
  assertFullExtentCanonicalContinuity,
  readFullExtentPointerSweepMutationSequence,
} from './fullExtentPointerSweep.mjs';

export const FINAL_VISUAL_QUALIFICATION_SCHEMA =
  'gev-final-visual-qualification/v1';
export const FINAL_VISUAL_STATES = Object.freeze([
  'still-settled',
  'hud-visible',
  'hud-hidden',
  'hud-restored',
]);
export const FINAL_VISUAL_TIME_MS = Date.parse('2026-10-08T12:00:00.000Z');

export function assertCanonicalVisualStateHistory(state) {
  let canonicalMutations;
  for (const side of ['baseline', 'candidate']) {
    const history = state.pointerHistory?.[side];
    for (const phase of ['acquisition', 'before', 'after'])
      assertCanonicalPointerHistory(history?.[phase]);
    assert.deepEqual(
      history.acquisition,
      history.before,
      `${state.id} ${side} canonical history changed before PNG`,
    );
    assert.deepEqual(
      history.before,
      history.after,
      `${state.id} ${side} canonical history changed during PNG`,
    );
    const mutations = readCanonicalPointerMutationSequence(history.acquisition);
    canonicalMutations ??= mutations;
    assert.deepEqual(
      mutations,
      canonicalMutations,
      `${state.id} canonical transform history differs between builds`,
    );
  }
}

export function assertFullExtentVisualStateHistory(state) {
  let common;
  for (const side of ['baseline', 'candidate']) {
    const sweep = state.fullExtentPointerSweep?.[side];
    for (const phase of ['acquisition', 'before', 'after'])
      assertFullExtentCanonicalContinuity(
        sweep?.[phase],
        state.pointerHistory?.[side]?.[phase],
      );
    assert.deepEqual(
      sweep.acquisition,
      sweep.before,
      `${state.id} ${side} sweep changed before PNG`,
    );
    assert.deepEqual(
      sweep.before,
      sweep.after,
      `${state.id} ${side} sweep changed during PNG`,
    );
    const normalized = readFullExtentPointerSweepMutationSequence(
      sweep.acquisition,
    );
    common ??= normalized;
    assert.deepEqual(
      normalized,
      common,
      `${state.id} normalized extent sweep differs between builds`,
    );
  }
}

/** Structural intent precedes readiness; CSS proof belongs to the paused PNG. */
export function readScreenshotBoundaryHudState(state, side) {
  const label = `${state.id} ${side} HUD`;
  assert.equal(
    state.observedStatePhase,
    'pre-readiness-structural-observation',
    `${label} structural observation phase`,
  );
  const structural = state.hud?.[side];
  const expectedVisible = state.id !== 'hud-hidden';
  assert.ok(structural, `${label} structural state missing`);
  assert.equal(structural.visible, expectedVisible, `${label} visibility`);
  assert.equal(
    structural.mode,
    expectedVisible ? 'on' : 'off',
    `${label} mode`,
  );
  assert.ok(
    typeof structural.variant === 'string' && structural.variant.length > 0,
    `${label} variant missing`,
  );
  assert.ok(
    [null, 'true', 'false'].includes(structural.ariaHidden),
    `${label} accessibility intent missing`,
  );
  if (expectedVisible)
    assert.notEqual(
      structural.ariaHidden,
      'true',
      `${label} visible content is hidden from accessibility`,
    );
  const boundary = (phase) => {
    const value = state.presentation?.[side]?.[phase];
    assert.equal(value?.documentVisible, true, `${label} ${phase} document`);
    assert.equal(value.documentFocused, true, `${label} ${phase} focus`);
    assert.equal(
      value.hudVisible,
      expectedVisible,
      `${label} ${phase} visibility intent`,
    );
    assert.equal(
      value.hudVisibility,
      expectedVisible ? 'visible' : 'hidden',
      `${label} ${phase} CSS visibility`,
    );
    assert.ok(
      typeof value.hudDisplay === 'string' &&
        value.hudDisplay.length > 0 &&
        value.hudDisplay !== 'none',
      `${label} ${phase} CSS display`,
    );
    assert.ok(
      Number.isFinite(value.hudOpacity) &&
        value.hudOpacity >= 0 &&
        value.hudOpacity <= 1 &&
        (expectedVisible
          ? value.hudOpacity >= 0.999
          : value.hudOpacity <= 0.001),
      `${label} ${phase} CSS opacity is not settled`,
    );
    return {
      mode: structural.mode,
      visible: structural.visible,
      variant: structural.variant,
      ariaHidden: structural.ariaHidden,
      display: value.hudDisplay,
      visibility: value.hudVisibility,
      opacity: value.hudOpacity,
    };
  };
  const before = boundary('before');
  assert.deepEqual(before, boundary('after'), `${label} boundary changed`);
  return before;
}

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

function deriveScanlinePhase(rows, dpr, label) {
  assert.ok(Array.isArray(rows) && rows.length === 8, `${label} alpha rows`);
  rows.forEach((row, index) => {
    assert.equal(row?.cssRow, index, `${label} CSS row`);
    assert.equal(row?.pixelRow, Math.floor(index * dpr), `${label} pixel row`);
    assert.ok(
      Number.isInteger(row?.leftAlpha) &&
        row.leftAlpha >= 0 &&
        row.leftAlpha <= 255,
      `${label} left alpha`,
    );
    assert.ok(
      Number.isInteger(row?.rightAlpha) &&
        row.rightAlpha >= 0 &&
        row.rightAlpha <= 255,
      `${label} right alpha`,
    );
  });
  const left = rows.filter((row) => row.leftAlpha > 0).map((row) => row.cssRow);
  const right = rows
    .filter((row) => row.rightAlpha > 0)
    .map((row) => row.cssRow);
  assert.deepEqual(left, right, `${label} edge alpha rows differ`);
  assert.ok(
    left.join(',') === '0,4' || left.join(',') === '2,6',
    `${label} phase rows`,
  );
  return left[0] === 0 ? 0 : 2;
}

function assertPhaseEvidence(phase, profile, label) {
  assert.ok(phase && phase.dimensions, `${label} phase evidence`);
  const expected = profile?.drawingBuffer;
  for (const edge of ['before', 'after']) {
    const dimensions = phase.dimensions[edge];
    assert.deepEqual(
      { width: dimensions?.width, height: dimensions?.height },
      expected,
      `${label} ${edge} dimensions`,
    );
    assert.equal(
      dimensions.cssWidth,
      profile.viewport.width,
      `${label} ${edge} CSS width`,
    );
    assert.equal(
      dimensions.cssHeight,
      profile.viewport.height,
      `${label} ${edge} CSS height`,
    );
    assert.equal(dimensions.dpr, profile.viewport.dpr, `${label} ${edge} DPR`);
    const derived = deriveScanlinePhase(
      phase.alphaRows?.[edge],
      dimensions.dpr,
      `${label} ${edge}`,
    );
    assert.equal(phase[edge], derived, `${label} ${edge} phase claim`);
  }
  assert.equal(phase.before, 0, `${label} before phase`);
  assert.equal(phase.after, 0, `${label} after phase`);
  assert.deepEqual(
    phase.dimensions.before,
    phase.dimensions.after,
    `${label} dimensions changed while paused`,
  );
  assert.deepEqual(
    phase.alphaRows.before,
    phase.alphaRows.after,
    `${label} alpha rows changed while paused`,
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

async function assertPng(record, root, label, decodePng) {
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
  assert.ok(
    info.size > 24 && info.size <= 16 * 1024 * 1024,
    `${label} PNG size is outside the bounded limit`,
  );
  const bytes = await fs.readFile(file);
  const dimensions = pngDimensions(bytes);
  const decoded = decodePng
    ? await decodePng(bytes)
    : await (
        await import('sharp')
      )
        .default(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
  assert.ok(
    Buffer.isBuffer(decoded.data),
    `${label} decoded RGBA buffer missing`,
  );
  assert.equal(decoded.info.channels, 4, `${label} decoded RGBA channel count`);
  assert.equal(
    decoded.data.length,
    dimensions.width * dimensions.height * 4,
    `${label} decoded RGBA byte count`,
  );
  assert.equal(
    decoded.info.format,
    'raw',
    `${label} PNG did not decode to pixels`,
  );
  assert.equal(decoded.info.width, dimensions.width, `${label} decoded width`);
  assert.equal(
    decoded.info.height,
    dimensions.height,
    `${label} decoded height`,
  );
  assert.equal(record.sha256, sha256(bytes), `${label} PNG digest`);
  assert.deepEqual(record.dimensions, dimensions, `${label} PNG dimensions`);
  return { bytes, pixels: decoded.data, pixelInfo: decoded.info };
}

/** Capture one bounded lossless PNG after the caller has observed a completed render. */
export async function captureQualificationPng(page, outputPath) {
  if (!page || typeof page.screenshot !== 'function')
    throw new TypeError('A Puppeteer page is required for PNG qualification.');
  const screenshotStartedAt = performance.now();
  const bytes = Buffer.from(
    await page.screenshot({ type: 'png', optimizeForSpeed: true }),
  );
  const screenshotElapsedMs = Math.max(
    0,
    performance.now() - screenshotStartedAt,
  );
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error('Qualification PNG exceeds its bounded size.');
  const dimensions = pngDimensions(bytes);
  const fileWriteStartedAt = performance.now();
  await fs.writeFile(outputPath, bytes, { flag: 'wx' });
  return {
    path: path.basename(outputPath),
    sha256: sha256(bytes),
    dimensions,
    screenshotElapsedMs,
    fileWriteElapsedMs: Math.max(0, performance.now() - fileWriteStartedAt),
  };
}

async function inspectFinalVisualQualification(
  report,
  { evidenceRoot, decodePng } = {},
  comparePixels = true,
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
  assert.equal(
    report.harness?.buildHarnessCommit,
    report.harness?.baselineSha,
    'build harness identity differs',
  );
  assert.equal(
    report.harness?.buildHarnessCommit,
    report.harness?.candidateSha,
    'baseline/candidate build harness differs',
  );
  assert.notEqual(
    report.application?.baselineSha,
    report.application?.candidateSha,
    'application revisions must differ',
  );
  assert.match(report.receipts?.baselineSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(report.receipts?.candidateSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(report.environment?.platform, 'win32');
  assert.equal(report.environment?.foregroundConfirmed, true);
  assert.ok(
    typeof report.environment?.renderer?.vendor === 'string' &&
      report.environment.renderer.vendor,
  );
  assert.match(
    report.environment?.renderer?.device || '',
    /UHD\s+(?:Graphics\s+)?620\b/i,
  );
  assert.match(
    `${report.environment.renderer.vendor} ${report.environment.renderer.device}`,
    /ANGLE/i,
  );
  assert.match(
    `${report.environment.renderer.vendor} ${report.environment.renderer.device}`,
    /Direct3D\s*11|D3D11/i,
  );
  assert.ok(
    typeof report.environment.renderer.browserVersion === 'string' &&
      report.environment.renderer.browserVersion,
  );
  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(
      report.environment.rendererByRevision?.[side],
      report.environment.renderer,
      `${side} renderer/browser identity differs`,
    );
    assert.ok(
      Number.isSafeInteger(report.environment.browserPid?.[side]) &&
        report.environment.browserPid[side] > 0,
      `${side} owned browser PID missing`,
    );
    const teardown = report.teardown?.[side];
    assert.equal(teardown?.browserClosed, true, `${side} browser cleanup`);
    assert.equal(
      teardown.pageClose?.closeCompleted,
      true,
      `${side} page cleanup`,
    );
    assert.equal(
      teardown.pageClose?.openPageCount,
      0,
      `${side} remaining pages`,
    );
    assert.equal(
      teardown.browserClose?.closeCompleted,
      true,
      `${side} graceful shutdown`,
    );
    assert.equal(
      teardown.browserClose?.forcedProcessTermination,
      false,
      `${side} forced shutdown`,
    );
    assert.ok(
      teardown.browserClose?.observation?.processExit &&
        (teardown.browserClose.observation.processExit.code != null ||
          teardown.browserClose.observation.processExit.signal != null),
      `${side} browser exit proof missing`,
    );
    assert.deepEqual(teardown.errors, [], `${side} cleanup errors`);
  }
  assertProfile(report.environment?.nativeSharpnessProfile, 'environment');
  assert.equal(
    report.environment.nativeSharpnessProfile.viewport.width,
    1440,
    'qualification viewport width',
  );
  assert.equal(
    report.environment.nativeSharpnessProfile.viewport.height,
    900,
    'qualification viewport height',
  );
  assert.ok(Array.isArray(report.environment?.populations));
  assert.ok(report.environment?.camera?.id);
  assert.match(
    report.fixture?.frameSha256 || '',
    /^[a-f0-9]{64}$/,
    'fixture frame identity',
  );
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
  const root = path.resolve(evidenceRoot || report.outputRoot || '.');
  assert.ok(
    report.rasterPolicy == null ||
      report.rasterPolicy === VISIBLE_CONTROL_VARIANCE_POLICY ||
      (!comparePixels &&
        report.rasterPolicy === 'repeated-full-image-controls-v1'),
    'Unsupported visual raster policy',
  );
  const decoded = new Map();
  if (report.pointerHistoryPolicy != null)
    assert.equal(report.pointerHistoryPolicy, CANONICAL_POINTER_HISTORY);
  if (report.fullExtentPointerSweepPolicy != null) {
    assert.equal(
      report.fullExtentPointerSweepPolicy,
      FULL_EXTENT_POINTER_SWEEP_POLICY,
    );
    assert.equal(report.pointerHistoryPolicy, CANONICAL_POINTER_HISTORY);
  }
  for (const state of report.states) {
    assert.equal(
      state.observedStatePhase,
      'pre-readiness-structural-observation',
      `${state.id} structural state is not screenshot-time evidence`,
    );
    if (report.pointerHistoryPolicy === CANONICAL_POINTER_HISTORY)
      assertCanonicalVisualStateHistory(state);
    if (
      report.fullExtentPointerSweepPolicy === FULL_EXTENT_POINTER_SWEEP_POLICY
    )
      assertFullExtentVisualStateHistory(state);
    for (const side of ['baseline', 'candidate']) {
      const proof = state.foreground?.[side];
      assert.equal(
        proof?.status,
        'foreground-confirmed',
        `${state.id} ${side} foreground status`,
      );
      assert.equal(
        proof?.foregroundPid,
        report.environment.browserPid[side],
        `${state.id} ${side} foreground PID`,
      );
      const frame = state.completedRender?.[side];
      assert.ok(
        Number.isSafeInteger(frame?.frameNumber) &&
          frame.frameNumber >= 0 &&
          Number.isFinite(frame.elapsedMs) &&
          frame.elapsedMs >= 0,
        `${state.id} ${side} render proof`,
      );
      const settings = state.settings?.[side];
      assert.equal(
        settings?.qualityMode,
        'manual',
        `${state.id} ${side} quality mode`,
      );
      assert.equal(settings?.densityPct, 75, `${state.id} ${side} density`);
      assert.equal(
        settings?.detectionMode,
        'DENSE',
        `${state.id} ${side} detection mode`,
      );
      assert.equal(
        settings?.resolutionScale,
        1,
        `${state.id} ${side} resolution scale`,
      );
      assert.equal(settings?.msaaSamples, 4, `${state.id} ${side} MSAA`);
      assert.equal(
        typeof settings?.antialias,
        'boolean',
        `${state.id} ${side} antialias unavailable`,
      );
      assert.equal(
        typeof settings?.fxaa,
        'boolean',
        `${state.id} ${side} FXAA unavailable`,
      );
      assert.deepEqual(
        state.nativeSharpnessProfileByRevision?.[side],
        report.environment.nativeSharpnessProfile,
        `${state.id} ${side} native profile differs`,
      );
      assert.deepEqual(
        { id: report.environment.camera.id, ...state.cameraByRevision?.[side] },
        report.environment.camera,
        `${state.id} ${side} observed camera differs`,
      );
      const presentation = state.presentation?.[side];
      const readiness = state.readiness?.[side];
      assert.equal(
        readiness?.status,
        'ready',
        `${state.id} ${side} gaze/layout readiness status`,
      );
      assert.ok(
        Number.isSafeInteger(readiness?.consecutiveStableRenders) &&
          readiness.consecutiveStableRenders >= 2 &&
          Number.isSafeInteger(readiness?.completedRenders) &&
          readiness.completedRenders >= readiness.consecutiveStableRenders,
        `${state.id} ${side} stable render count`,
      );
      assert.ok(
        visualReadinessInputsMatch(readiness?.proof, presentation?.before),
        `${state.id} ${side} readiness proof differs from capture proof`,
      );
      assert.equal(
        state.captureMethod?.[side],
        'debugger-paused-snapshot',
        `${state.id} ${side} capture method`,
      );
      assert.deepEqual(
        state.pauseCleanup?.[side],
        { resumed: true, disabled: true, detached: true },
        `${state.id} ${side} paused cleanup`,
      );
      assertPhaseEvidence(
        state.phase?.[side],
        state.nativeSharpnessProfileByRevision?.[side],
        `${state.id} ${side}`,
      );
      assert.ok(
        presentationStayedSettled(
          presentation?.before,
          presentation?.after,
          state.id !== 'hud-hidden',
        ),
        `${state.id} ${side} presentation changed during capture`,
      );
      assert.ok(
        Number.isSafeInteger(state.frameDelivery?.[side]?.count) &&
          state.frameDelivery[side].count > 0,
        `${state.id} ${side} frame delivery missing`,
      );
      assert.equal(
        state.frameDelivery[side].matchesFixture,
        true,
        `${state.id} ${side} frame delivery mismatch`,
      );
      assert.equal(
        state.frameDelivery[side].sha256,
        report.fixture.frameSha256,
        `${state.id} ${side} frame digest differs`,
      );
    }
    assert.equal(
      state.presentation.baseline.after.summary,
      state.presentation.candidate.after.summary,
      `${state.id} HUD summary differs`,
    );
    assert.ok(
      Number.isSafeInteger(state.completedRender?.baseline?.frameNumber),
      `${state.id} baseline render`,
    );
    assert.ok(
      Number.isSafeInteger(state.completedRender?.candidate?.frameNumber),
      `${state.id} candidate render`,
    );
    assert.equal(
      state.foreground?.baseline?.foregroundConfirmed,
      true,
      `${state.id} baseline foreground`,
    );
    assert.equal(
      state.foreground?.candidate?.foregroundConfirmed,
      true,
      `${state.id} candidate foreground`,
    );
    assert.deepEqual(
      state.settings?.baseline,
      state.settings?.candidate,
      `${state.id} per-revision settings differ`,
    );
    assert.ok(
      state.settings?.baseline && state.settings?.candidate,
      `${state.id} settings missing`,
    );
    assert.ok(
      state.populations?.baseline && state.populations?.candidate,
      `${state.id} populations missing`,
    );
    assertProfile(
      state.nativeSharpnessProfileByRevision?.baseline,
      `${state.id} baseline profile`,
    );
    assertProfile(
      state.nativeSharpnessProfileByRevision?.candidate,
      `${state.id} candidate profile`,
    );
    assert.ok(
      Number(state.populations.baseline.cctv) > 0 &&
        Number(state.populations.candidate.cctv) > 0,
      `${state.id} CCTV population is empty`,
    );
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
      readScreenshotBoundaryHudState(state, 'baseline'),
      readScreenshotBoundaryHudState(state, 'candidate'),
      `${state.id} per-revision HUD accessibility state differs`,
    );
    assert.ok(
      state.hud?.baseline && state.hud?.candidate,
      `${state.id} HUD state missing`,
    );
    const expectedHudVisible = state.id !== 'hud-hidden';
    assert.equal(
      state.hud.baseline.visible,
      expectedHudVisible,
      `${state.id} baseline HUD visibility`,
    );
    assert.equal(
      state.hud.candidate.visible,
      expectedHudVisible,
      `${state.id} candidate HUD visibility`,
    );
    assert.ok(
      Number.isSafeInteger(state.timestampMs?.baseline) &&
        Number.isSafeInteger(state.timestampMs?.candidate),
      `${state.id} timestamps are missing`,
    );
    assert.equal(
      state.timestampMs.baseline,
      FINAL_VISUAL_TIME_MS,
      `${state.id} baseline timestamp`,
    );
    assert.equal(
      state.timestampMs.candidate,
      FINAL_VISUAL_TIME_MS,
      `${state.id} candidate timestamp`,
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
      decodePng,
    );
    const candidate = await assertPng(
      state.candidate,
      root,
      `${state.id} candidate`,
      decodePng,
    );
    assert.deepEqual(
      baseline.pixelInfo.width && {
        width: baseline.pixelInfo.width,
        height: baseline.pixelInfo.height,
      },
      {
        width: report.environment.nativeSharpnessProfile.drawingBuffer.width,
        height: report.environment.nativeSharpnessProfile.drawingBuffer.height,
      },
      `${state.id} baseline image dimensions`,
    );
    assert.deepEqual(
      candidate.pixelInfo.width && {
        width: candidate.pixelInfo.width,
        height: candidate.pixelInfo.height,
      },
      {
        width: report.environment.nativeSharpnessProfile.drawingBuffer.width,
        height: report.environment.nativeSharpnessProfile.drawingBuffer.height,
      },
      `${state.id} candidate image dimensions`,
    );
    decoded.set(state.id, {
      baseline: baseline.pixels,
      candidate: candidate.pixels,
    });
    if (
      comparePixels &&
      (state.id !== 'still-settled' || report.rasterPolicy == null)
    )
      assert.equal(
        sha256(candidate.pixels),
        sha256(baseline.pixels),
        `${state.id} decoded rendered pixels changed`,
      );
    assert.deepEqual(
      candidate.pixelInfo,
      baseline.pixelInfo,
      `${state.id} decoded pixel dimensions changed`,
    );
  }
  let rasterVariance = null;
  if (
    comparePixels &&
    report.rasterPolicy === VISIBLE_CONTROL_VARIANCE_POLICY
  ) {
    const still = report.states[0];
    for (const id of ['hud-visible', 'hud-restored']) {
      const control = report.states.find((state) => state.id === id);
      assert.deepEqual(
        control.settings,
        still.settings,
        `${id} control settings differ`,
      );
      assert.deepEqual(
        control.populations,
        still.populations,
        `${id} control populations differ`,
      );
      for (const side of ['baseline', 'candidate'])
        assert.equal(
          control.presentation[side].before.summary,
          still.presentation[side].before.summary,
          `${id} control summary differs`,
        );
    }
    rasterVariance = validateVisibleControlVariance({
      still: decoded.get('still-settled'),
      visible: decoded.get('hud-visible'),
      restored: decoded.get('hud-restored'),
    });
  }
  return {
    schema: report.schema,
    status: comparePixels ? 'passed' : 'structural-evidence-validated-only',
    states: report.states.length,
    ...(!comparePixels ? { decoded } : {}),
    ...(rasterVariance ? { rasterVariance } : {}),
  };
}

export async function validateFinalVisualQualification(report, options) {
  return inspectFinalVisualQualification(report, options, true);
}

/** All original provenance/state/PNG/cleanup checks; deliberately no pixel pass. */
export async function inspectRepeatedVisualPairEvidence(report, options) {
  return inspectFinalVisualQualification(report, options, false);
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
