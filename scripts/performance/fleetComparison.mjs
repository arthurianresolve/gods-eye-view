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
export const FLEET_OFFSETS = Object.fromEntries(
  FLEET_SHOTS.map((name, i) => [
    name,
    i === 0
      ? 0
      : i <= 4
        ? i * 80
        : name === 'reinitialized'
          ? 60000
          : 30000 + (i - 5) * 80,
  ]),
);
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
      assert.equal(typeof b.collectionShow, 'boolean');
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

export function validateFleetEmptyLifecycle(sample, report) {
  assert.equal(sample?.schema, 'gev-fleet-render-demand/v3');
  assert.equal(sample.status, 'passed');
  assert.equal(sample.applicationCommit, report.candidate);
  assert.equal(sample.harnessCommit, report.harness);
  assert.equal(sample.mode, 'empty-lifecycle');
  assert.equal(sample.implementation, 'candidate');
  assert.deepEqual(sample.pageErrors, []);
  assert.deepEqual(
    sample.checks,
    ['population', 'foreground', 'no-render-errors'].map((id) => ({
      id,
      status: 'passed',
    })),
  );
  settings(sample.settings);
  assert.equal(sample.cleanup.viewerDestroyed, true);
  assert.equal(sample.cleanup.governor.installed, false);
  assert.deepEqual(sample.cleanup.failures, []);
  for (const state of [
    sample.cleanup.governor,
    sample.cleanup.beforeUninstall,
  ]) {
    assert.deepEqual(state.holds, []);
    assert.deepEqual(state.scheduledUpdates, []);
  }
  const result = sample.emptyLifecycle;
  assert.equal(result?.schema, 'gev-fleet-empty-lifecycle/v1');
  assert.equal(result.status, 'passed');
  assert.equal(result.requestedIdleMs, 10000);
  assert.equal(result.maxIdleFrames, 2);
  assert.deepEqual(
    result.checks,
    [
      'initial-population-present',
      'empty-final-frame',
      'empty-no-periodic-demand',
      'source-rearrival-resumes-cadence',
      'ten-second-idle-frame-bound',
      'full-source-recovery',
    ].map((id) => ({ id, status: 'passed' })),
  );
  assert.deepEqual(
    result.phases.map((p) => p.name),
    ['empty-first', 'repopulate', 'empty-again', 'recovery'],
  );
  for (const phase of [result.phases[0], result.phases[2]]) {
    assert.deepEqual(
      phase.absentSnapshots.map((s) => s.absencePoll),
      [1, 2, 3],
    );
    for (const frame of [phase.finalFrame, phase.drained]) {
      assert.deepEqual(frame.population, { civil: 0, military: 0 });
      assert.deepEqual(frame.sceneBillboards, { civil: 0, military: 0 });
      assert.equal(frame.demand.holds, 0);
      assert.equal(frame.demand.scheduledUpdates, 0);
    }
  }
  for (const [index, counts] of [
    [1, { civil: 1, military: 1 }],
    [3, { civil: 12, military: 8 }],
  ]) {
    const frame = result.phases[index].frame;
    assert.deepEqual(frame.population, counts);
    assert.deepEqual(frame.sceneBillboards, counts);
    assert.deepEqual(frame.billboardsReady, { civil: true, military: true });
    assert.deepEqual(frame.billboardsShown, { civil: true, military: true });
    assert.equal(frame.demand.holds, 0);
    assert.equal(frame.demand.scheduledUpdates, 2);
  }
  const idle = result.phases[2].idle;
  assert.equal(idle.requestedMs, 10000);
  assert.ok(Number.isFinite(idle.observedMs) && idle.observedMs >= 10000);
  assert.ok(
    Number.isInteger(idle.frames) && idle.frames >= 0 && idle.frames <= 2,
  );
  assert.equal(idle.maxFrames, 2);
  for (const state of [idle.demandStart, idle.demandEnd]) {
    assert.equal(state.holds, 0);
    assert.equal(state.scheduledUpdates, 0);
  }
  return {
    status: 'passed',
    emptyIdleFrames: idle.frames,
    emptyIdleMs: idle.observedMs,
  };
}

function validateSample(sample, report, implementation, mode) {
  assert.equal(sample.schema, 'gev-fleet-render-demand/v3');
  assert.equal(sample.status, 'passed');
  assert.equal(sample.applicationCommit, report[implementation]);
  assert.equal(sample.harnessCommit, report.harness);
  assert.equal(sample.implementation, implementation);
  assert.equal(sample.mode, mode);
  assert.equal(sample.fixture, '20-aircraft-fixed-source/v3');
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
  if (mode === 'correctness') {
    const settled = sample.phases.filter((p) => p.kind === 'settled');
    assert.deepEqual(
      settled.map((p) => p.name),
      FLEET_SHOTS.filter((n) => n !== 'disabled'),
    );
    for (const phase of settled) {
      assert.equal(
        phase.logicalTimeMs,
        sample.epochMs + FLEET_OFFSETS[phase.name],
      );
      assert.ok(
        phase.stableMs >= 700 && phase.elapsedMs < 5000 && phase.frames >= 3,
        `${phase.name}: missing completed-frame stability witness`,
      );
    }
    const movement = sample.phases.filter((p) => p.kind === 'movement');
    assert.deepEqual(
      movement.map((p) => p.name),
      FLEET_SHOTS.slice(1, 6),
    );
    for (const phase of movement) {
      assert.equal(
        phase.logicalTimeMs,
        sample.epochMs + FLEET_OFFSETS[phase.name],
      );
      assert.ok(phase.frames > 0 && phase.elapsedMs < 2000);
      assert.ok(
        Number.isInteger(phase.publicationFrame) &&
          phase.observedFrame > phase.publicationFrame,
        'Movement must be witnessed after publication',
      );
      assert.equal(phase.revision, phase.name === 'source-refresh' ? 3 : 2);
    }
  }
}

// A baseline that cannot reproduce itself cannot establish candidate parity.
// Keep full images and exact camera/output values; never normalize away drift.
export async function validateFleetRepeat(first, second, report) {
  for (const sample of [first, second]) {
    validateSample(sample, report, 'baseline', 'correctness');
    assert.deepEqual(
      sample.samples.map((s) => s.name),
      FLEET_SHOTS,
    );
  }
  for (let i = 0; i < FLEET_SHOTS.length; i++) {
    const a = first.samples[i],
      b = second.samples[i];
    const label = `baseline repeat/${a.name}`;
    assert.deepEqual(a.camera, b.camera, `${label}: camera differs`);
    assert.deepEqual(a.output, b.output, `${label}: aircraft output differs`);
    assert.equal(a.logicalTimeMs, b.logicalTimeMs, `${label}: clock differs`);
    assert.equal(
      a.sourceEpochMs,
      b.sourceEpochMs,
      `${label}: source epoch differs`,
    );
    assert.deepEqual(settings(a.settings), settings(b.settings));
    const [left, right] = await Promise.all([
      pixels(a.pixels),
      pixels(b.pixels),
    ]);
    assert.ok(left.equals(right), `${label}: decoded pixels differ`);
  }
  return { status: 'passed', decodedImages: FLEET_SHOTS.length * 2 };
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
  assert.equal(
    report.baselineRepeat?.length,
    2,
    'Independent baseline repeat control required',
  );
  await validateFleetRepeat(...report.baselineRepeat, report);
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
    await validateFleetRepeat(report.baselineRepeat[0], baseline, report);
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
      for (const sample of [a, b]) {
        population(sample.output);
        const offset = FLEET_OFFSETS[sample.name];
        assert.equal(
          sample.logicalTimeMs,
          baseline.epochMs + offset,
          'Unexpected display epoch',
        );
        assert.equal(
          sample.sourceEpochMs,
          baseline.epochMs + (sample.name === 'reinitialized' ? 60000 : 0),
          'Unexpected source epoch',
        );
        for (const [kind, fleet] of Object.entries(sample.output)) {
          assert.equal(
            fleet.tracked,
            sample.name === `${kind}-tracked` ? expectedIds(kind)[0] : null,
          );
          assert.ok(
            fleet.billboards.every(
              (point) => point.collectionShow === (sample.name !== 'disabled'),
            ),
            'Collection visibility differs from lifecycle phase',
          );
        }
      }
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
      let colored = 0;
      for (let p = 0; p < left.length; p += 4)
        if (left[p] > 40 || left[p + 1] > 40 || left[p + 2] > 40) colored++;
      assert.equal(a.pixels.coloredPixels, colored);
      assert.equal(b.pixels.coloredPixels, colored);
      assert.ok(
        a.name === 'disabled' ? colored === 0 : colored > 20,
        `${a.name}: unexpected painted population`,
      );
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
