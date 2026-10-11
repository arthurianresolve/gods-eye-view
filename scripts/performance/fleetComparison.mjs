import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const FLEET_SHOTS = [
  'initial',
  'motion-80',
  'motion-160',
  'motion-240',
  'motion-320',
  'source-refresh',
  'camera-change',
  'cockpit-enter',
  'cockpit-exit',
  'civil-tracked',
  'civil-released',
  'military-tracked',
  'military-released',
  'disabled',
  'reinitialized',
];
export const FLEET_CHECKS = [
  'population',
  'aircraft-moves',
  'source-arrival-frame',
  'civil-track-start',
  'civil-continuous-tracking',
  'civil-tracked-id',
  'civil-untracked',
  'military-track-start',
  'military-continuous-tracking',
  'military-tracked-id',
  'military-untracked',
  'disabled-final-frame',
  'disabled-releases-demand',
  'reinit-resumes-frames',
  'foreground',
  'no-render-errors',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const expectedIds = (kind) =>
  Array.from({ length: kind === 'civil' ? 12 : 8 }, (_, i) =>
    ((kind === 'civil' ? 0xa10000 : 0xa20000) + i).toString(16),
  );

function settings(value) {
  assert.ok(value?.context);
  assert.equal(value.resolutionScale, 1);
  assert.equal(value.msaaSamples, 4);
  assert.equal(value.context.antialias, true);
  assert.equal(value.context.preserveDrawingBuffer, true);
  assert.deepEqual(value.environment.viewport, {
    width: 960,
    height: 640,
    dpr: 1,
  });
  assert.deepEqual(value.environment.drawingBuffer, {
    width: 960,
    height: 640,
  });
  const { appCommit, harnessCommit, ...environment } = value.environment;
  return { ...value, environment };
}

function population(output) {
  for (const kind of ['civil', 'military']) {
    const fleet = output?.[kind];
    assert.equal(fleet?.count, expectedIds(kind).length);
    assert.deepEqual(
      fleet.billboards.map((b) => b.id),
      expectedIds(kind),
    );
    for (const b of fleet.billboards) {
      assert.equal(b.ready, true);
      assert.equal(typeof b.show, 'boolean');
      assert.ok(b.position.length === 3 && b.position.every(Number.isFinite));
      assert.ok(b.color.length === 4 && b.color.every(Number.isFinite));
      assert.ok(Number.isFinite(b.rotation) && Number.isFinite(b.scale));
    }
  }
}

async function pixels(value) {
  assert.match(value?.png || '', /^data:image\/png;base64,/);
  const { data, info } = await sharp(
    Buffer.from(value.png.split(',')[1], 'base64'),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 960);
  assert.equal(info.height, 640);
  assert.equal(value.width, info.width);
  assert.equal(value.height, info.height);
  assert.equal(
    hash(data),
    value.sha256,
    'PNG pixels disagree with reported hash',
  );
  return data;
}

function validateSample(sample, report, implementation, mode) {
  assert.equal(sample.schema, 'gev-fleet-render-demand/v2');
  assert.equal(sample.status, 'passed');
  assert.equal(sample.applicationCommit, report[implementation]);
  assert.equal(sample.harnessCommit, report.harness);
  assert.equal(sample.implementation, implementation);
  assert.equal(sample.mode, mode);
  assert.equal(sample.fixture, '20-aircraft-fixed-source/v2');
  assert.equal(sample.epochMs, Date.UTC(2026, 9, 8, 12));
  assert.deepEqual(sample.pageErrors, []);
  assert.deepEqual(
    sample.checks.map((c) => c.id),
    mode === 'correctness'
      ? FLEET_CHECKS
      : [
          'population',
          'cadence-delivers-frames',
          'untracked-demand',
          'foreground',
          'no-render-errors',
        ],
  );
  assert.ok(sample.checks.every((c) => c.status === 'passed'));
  assert.equal(sample.cleanup.viewerDestroyed, true);
  assert.equal(sample.cleanup.governor.installed, false);
  assert.deepEqual(sample.cleanup.failures, []);
  for (const demand of [
    sample.cleanup.governor,
    sample.cleanup.beforeUninstall,
  ]) {
    assert.deepEqual(demand.holds, []);
    assert.deepEqual(demand.scheduledUpdates, []);
  }
  settings(sample.settings);
  assert.equal(sample.settings.environment.appCommit, report[implementation]);
  assert.equal(sample.settings.environment.harnessCommit, report.harness);
}

function intervals(times, duration, label) {
  assert.ok(
    Array.isArray(times) && times.length >= 10,
    `${label}: insufficient observations`,
  );
  assert.ok(
    times.every(
      (v, i) =>
        Number.isFinite(v) &&
        v >= 0 &&
        v <= duration &&
        (!i || v > times[i - 1]),
    ),
    `${label}: invalid event times`,
  );
  const gaps = times.slice(1).map((v, i) => v - times[i]);
  return {
    count: times.length,
    medianMs: median(gaps),
    p95Ms: [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)],
  };
}

/** Validate raw evidence, including independently decoded pixels, before making a claim. */
export async function validateFleetComparison(report) {
  assert.match(report.baseline, /^[a-f0-9]{40}$/);
  assert.match(report.candidate, /^[a-f0-9]{40}$/);
  assert.notEqual(report.baseline, report.candidate);
  assert.equal(report.harness, report.candidate);
  assert.equal(report.pairs.length, 5);
  const comparisons = [];
  let decodedImages = 0;
  for (const [i, pair] of report.pairs.entries()) {
    assert.equal(pair.pair, i + 1);
    assert.deepEqual(
      pair.order,
      i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
    );
    for (const mode of ['correctness', 'cadence']) {
      for (const implementation of ['baseline', 'candidate'])
        validateSample(
          pair[mode][implementation],
          report,
          implementation,
          mode,
        );
      assert.deepEqual(
        settings(pair[mode].baseline.settings),
        settings(pair[mode].candidate.settings),
        'Effective settings differ',
      );
    }
    const { baseline, candidate } = pair.correctness;
    assert.deepEqual(
      baseline.samples.map((s) => s.name),
      FLEET_SHOTS,
    );
    assert.deepEqual(
      candidate.samples.map((s) => s.name),
      FLEET_SHOTS,
    );
    for (let n = 0; n < FLEET_SHOTS.length; n++) {
      const a = baseline.samples[n],
        b = candidate.samples[n];
      for (const sample of [a, b]) population(sample.output);
      assert.deepEqual(
        a.output,
        b.output,
        `${a.name}: aircraft position/style differs`,
      );
      assert.deepEqual(a.camera, b.camera, `${a.name}: camera differs`);
      assert.equal(
        a.logicalTimeMs,
        b.logicalTimeMs,
        `${a.name}: display clock differs`,
      );
      assert.deepEqual(settings(a.settings), settings(b.settings));
      const [left, right] = await Promise.all([
        pixels(a.pixels),
        pixels(b.pixels),
      ]);
      decodedImages += 2;
      assert.ok(left.equals(right), `${a.name}: decoded pixels differ`);
    }
    const cadence = {};
    for (const implementation of ['baseline', 'candidate']) {
      const sample = pair.cadence[implementation].cadence;
      population(sample.output);
      assert.ok(sample.durationMs >= 2900 && sample.durationMs < 5000);
      const frames = intervals(
        sample.frameTimesMs,
        sample.durationMs,
        `${implementation} frames`,
      );
      cadence[implementation] = { frames, fleet: {} };
      for (const kind of ['civil', 'military'])
        cadence[implementation].fleet[kind] = intervals(
          sample.fleetUpdateTimesMs[kind],
          sample.durationMs,
          `${implementation}/${kind} updates`,
        );
      assert.equal(
        sample.demand.holds.length,
        implementation === 'baseline' ? 2 : 0,
      );
      assert.equal(
        sample.demand.scheduledUpdates.length,
        implementation === 'baseline' ? 0 : 2,
      );
    }
    const renderedFrameReduction =
      1 - cadence.candidate.frames.count / cadence.baseline.frames.count;
    assert.ok(
      renderedFrameReduction >= 0.2,
      'Render scheduling provides no meaningful frame reduction',
    );
    for (const kind of ['civil', 'military']) {
      const a = cadence.baseline.fleet[kind],
        b = cadence.candidate.fleet[kind];
      assert.ok(
        b.medianMs <= a.medianMs * 1.1,
        `${kind}: median visual cadence regressed`,
      );
      assert.ok(
        b.p95Ms <= a.p95Ms * 1.1,
        `${kind}: p95 visual cadence regressed`,
      );
      assert.ok(b.count >= a.count * 0.9, `${kind}: fewer visual updates`);
    }
    comparisons.push({ pair: i + 1, renderedFrameReduction, cadence });
  }
  return {
    status: 'passed',
    decodedImages,
    comparisons,
    medianRenderedFrameReduction: median(
      comparisons.map((p) => p.renderedFrameReduction),
    ),
  };
}
