import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  FLEET_CHECKS,
  FLEET_SHOTS,
  FLEET_OFFSETS,
  validateFleetComparison,
} from './fleetComparison.mjs';

const bytes = Buffer.alloc(960 * 640 * 4, 100);
const png = await sharp(bytes, {
  raw: { width: 960, height: 640, channels: 4 },
})
  .png()
  .toBuffer();
const image = {
  width: 960,
  height: 640,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  png: `data:image/png;base64,${png.toString('base64')}`,
  coloredPixels: 960 * 640,
};
const dark = Buffer.alloc(960 * 640 * 4, 0);
const darkPng = await sharp(dark, {
  raw: { width: 960, height: 640, channels: 4 },
})
  .png()
  .toBuffer();
const darkImage = {
  width: 960,
  height: 640,
  coloredPixels: 0,
  sha256: createHash('sha256').update(dark).digest('hex'),
  png: `data:image/png;base64,${darkPng.toString('base64')}`,
};
function validReport() {
  const report = {
    schema: 'gev-hosted-fleet-comparison/v1',
    baseline: 'a'.repeat(40),
    candidate: 'b'.repeat(40),
    harness: 'b'.repeat(40),
    pairs: [],
  };
  const output = Object.fromEntries(
    ['civil', 'military'].map((kind) => {
      const count = kind === 'civil' ? 12 : 8;
      return [
        kind,
        {
          count,
          tracked: null,
          billboards: Array.from({ length: count }, (_, i) => ({
            id: ((kind === 'civil' ? 0xa10000 : 0xa20000) + i).toString(16),
            ready: true,
            show: true,
            collectionShow: true,
            position: [1, 2, 3],
            color: [1, 1, 1, 1],
            rotation: 0,
            scale: 1,
          })),
        },
      ];
    }),
  );
  const models = {
    truncated: false,
    items: Object.values(output).flatMap((fleet) =>
      fleet.billboards.map((b) => ({
        id: b.id,
        ready: true,
        effectiveShow: true,
      })),
    ),
  };
  for (let i = 0; i < 5; i++) {
    const pair = {
      pair: i + 1,
      order: i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
      correctness: {},
      cadence: {},
    };
    for (const mode of ['correctness', 'cadence'])
      for (const implementation of ['baseline', 'candidate']) {
        const settings = {
          resolutionScale: 1,
          msaaSamples: 4,
          context: { antialias: true, preserveDrawingBuffer: true },
          environment: {
            appCommit: report[implementation],
            harnessCommit: report.harness,
            viewport: { width: 960, height: 640, dpr: 1 },
            drawingBuffer: { width: 960, height: 640 },
          },
        };
        const checks =
          mode === 'correctness'
            ? FLEET_CHECKS
            : [
                'population',
                'cadence-delivers-frames',
                'untracked-demand',
                'foreground',
                'no-render-errors',
              ];
        const clean = { holds: [], scheduledUpdates: [] };
        pair[mode][implementation] = {
          schema: 'gev-fleet-render-demand/v4',
          status: 'passed',
          applicationCommit: report[implementation],
          harnessCommit: report.harness,
          implementation,
          mode,
          fixture: '20-aircraft-fixed-source/v4',
          epochMs: Date.UTC(2026, 9, 8, 12),
          pageErrors: [],
          checks: checks.map((id) => ({ id, status: 'passed' })),
          settings,
          phases:
            mode === 'correctness'
              ? [
                  ...FLEET_SHOTS.slice(1, 6).map((name) => ({
                    name,
                    kind: 'movement',
                    logicalTimeMs:
                      Date.UTC(2026, 9, 8, 12) + FLEET_OFFSETS[name],
                    frames: 1,
                    elapsedMs: 90,
                    publicationFrame: 5,
                    observedFrame: 6,
                    revision: name === 'source-refresh' ? 3 : 2,
                  })),
                  ...FLEET_SHOTS.filter((name) => name !== 'disabled').map(
                    (name) => ({
                      name,
                      kind: 'settled',
                      logicalTimeMs:
                        Date.UTC(2026, 9, 8, 12) + FLEET_OFFSETS[name],
                      stableMs: 710,
                      elapsedMs: 900,
                      frames: 8,
                      models: structuredClone(models),
                    }),
                  ),
                  ...FLEET_SHOTS.slice(9, 13).map((name) => ({
                    name,
                    kind: 'model-readiness',
                    logicalTimeMs:
                      Date.UTC(2026, 9, 8, 12) + FLEET_OFFSETS[name] - 80,
                    maxWaitMs: 30000,
                    elapsedMs: 1200,
                    startFrame: 20,
                    observedFrame: 24,
                    models: structuredClone(models),
                  })),
                  ...FLEET_SHOTS.slice(9, 13).map((name) => ({
                    name,
                    kind: 'lighting-readiness',
                    logicalTimeMs:
                      Date.UTC(2026, 9, 8, 12) + FLEET_OFFSETS[name],
                    maxWaitMs: 30000,
                    elapsedMs: 2000,
                    startFrame: 25,
                    observedFrame: 30,
                    state: {
                      cesiumVersion: '1.138.0',
                      truncated: false,
                      globalQueue: { active: 0, queued: 0, maximumActive: 13 },
                      items: models.items.map((m) => ({
                        id: m.id,
                        enabled: true,
                        shouldUpdate: true,
                        dirty: Object.fromEntries(
                          [
                            'radianceMap',
                            'radianceCommands',
                            'convolutionsCommands',
                            'irradianceCommand',
                            'irradianceTexture',
                            'sphericalHarmonics',
                            'regenerateShaders',
                            'reset',
                          ].map((key) => [key, false]),
                        ),
                        pending: { radiance: 0, convolution: 0, irradiance: 0 },
                      })),
                    },
                  })),
                ]
              : [],
          cleanup: {
            viewerDestroyed: true,
            governor: { ...clean, installed: false },
            beforeUninstall: { ...clean },
            failures: [],
          },
          samples:
            mode === 'correctness'
              ? FLEET_SHOTS.map((name) => {
                  const visible = structuredClone(output);
                  for (const [kind, fleet] of Object.entries(visible)) {
                    fleet.tracked =
                      name === `${kind}-tracked`
                        ? fleet.billboards[0].id
                        : null;
                    fleet.billboards.forEach((b) => {
                      b.collectionShow = name !== 'disabled';
                      b.show = !FLEET_SHOTS.slice(9, 13).includes(name);
                    });
                  }
                  const offset = FLEET_OFFSETS[name];
                  return {
                    name,
                    output: visible,
                    trackedBillboards: {
                      truncated: false,
                      items: ['civil', 'military']
                        .filter((kind) => name === `${kind}-tracked`)
                        .map((kind) => ({
                          id: visible[kind].billboards[0].id,
                          layer: kind === 'civil' ? 'flights' : 'military',
                          ready: true,
                          show: true,
                          effectiveShow: true,
                          alpha: 0,
                        })),
                    },
                    camera: { position: [1, 2, 3] },
                    logicalTimeMs: Date.UTC(2026, 9, 8, 12) + offset,
                    sourceEpochMs:
                      Date.UTC(2026, 9, 8, 12) +
                      (name === 'reinitialized' ? 60000 : 0),
                    settings,
                    pixels: { ...(name === 'disabled' ? darkImage : image) },
                  };
                })
              : [],
          cadence: {
            durationMs: 3000,
            output: structuredClone(output),
            frameTimesMs: Array.from(
              { length: implementation === 'baseline' ? 150 : 36 },
              (_, n) => n * (implementation === 'baseline' ? 20 : 80),
            ),
            fleetUpdateTimesMs: {
              civil: Array.from({ length: 36 }, (_, n) => n * 80),
              military: Array.from({ length: 36 }, (_, n) => n * 80),
            },
            demand: {
              holds:
                implementation === 'baseline' ? ['flights', 'military'] : [],
              scheduledUpdates:
                implementation === 'baseline'
                  ? []
                  : ['flights-fleet', 'military-fleet'],
            },
          },
        };
      }
    report.pairs.push(pair);
  }
  report.baselineRepeat = [0, 1].map(() =>
    structuredClone(report.pairs[0].correctness.baseline),
  );
  return report;
}

function extendedReport() {
  const report = validReport();
  report.schema = 'gev-hosted-fleet-component-extended/v1';
  report.diagnosticOnly = false;
  report.protocol = {
    id: 'gev-s51-component-cadence/v1',
    warmupMs: 30000,
    measurementMs: 60000,
    repeatPairs: 5,
    scope:
      '20-aircraft component evidence; not S47 full-application acceptance',
    instrumentedTimingTrace: false,
  };
  const identityBefore = {
    civil: report.pairs[0].cadence.baseline.cadence.output.civil.billboards.map(
      (item) => item.id,
    ),
    military:
      report.pairs[0].cadence.baseline.cadence.output.military.billboards.map(
        (item) => item.id,
      ),
  };
  for (const pair of report.pairs)
    for (const implementation of ['baseline', 'candidate']) {
      const sample = pair.cadence[implementation];
      sample.mode = 'cadence-extended';
      sample.cadence.durationMs = 60000;
      sample.cadence.frameTimesMs = Array.from(
        { length: implementation === 'baseline' ? 3000 : 750 },
        (_, index) => index * (implementation === 'baseline' ? 20 : 80),
      );
      sample.cadence.fleetUpdateTimesMs = {
        civil: Array.from({ length: 750 }, (_, index) => index * 80),
        military: Array.from({ length: 750 }, (_, index) => index * 80),
      };
      sample.cadence.protocol = {
        id: report.protocol.id,
        warmupMs: report.protocol.warmupMs,
        measurementMs: report.protocol.measurementMs,
        scope: report.protocol.scope,
        warmupElapsedMs: 30010,
        measurementElapsedMs: 60000,
        settingsBefore: structuredClone(sample.settings),
        settingsAfter: structuredClone(sample.settings),
        identityBefore: structuredClone(identityBefore),
        identityAfter: structuredClone(identityBefore),
      };
    }
  return report;
}

test('valid five-pair evidence decodes all images and quantifies frame savings', async () => {
  const result = await validateFleetComparison(validReport());
  assert.equal(result.status, 'passed');
  assert.equal(result.decodedImages, 150);
  assert.equal(result.medianRenderedFrameReduction, 0.76);
});

test('accepts exact five-pair extended component cadence protocol', async () => {
  const result = await validateFleetComparison(extendedReport());
  assert.equal(result.status, 'passed');
  assert.equal(result.decodedImages, 150);
});

const extendedInvalidCases = [
  [
    'missing explicit protocol',
    (report) => {
      delete report.protocol;
    },
  ],
  [
    'wrong protocol identity',
    (report) => {
      report.protocol.id = 'other';
    },
  ],
  [
    'short warmup',
    (report) => {
      report.pairs[0].cadence.candidate.cadence.protocol.warmupElapsedMs = 29999;
    },
  ],
  [
    'missing measurement duration',
    (report) => {
      delete report.pairs[0].cadence.baseline.cadence.protocol
        .measurementElapsedMs;
    },
  ],
  [
    'mismatched before and after settings',
    (report) => {
      report.pairs[1].cadence.candidate.cadence.protocol.settingsAfter.msaaSamples = 2;
    },
  ],
  [
    'different identity after cadence sample',
    (report) => {
      report.pairs[2].cadence.baseline.cadence.protocol.identityAfter.civil.pop();
    },
  ],
  [
    'short 60-second sample',
    (report) => {
      report.pairs[3].cadence.candidate.cadence.durationMs = 59000;
      report.pairs[3].cadence.candidate.cadence.protocol.measurementElapsedMs = 59000;
    },
  ],
  [
    'excess measurement duration',
    (report) => {
      const sample = report.pairs[0].cadence.candidate.cadence;
      sample.durationMs = 61500;
      sample.protocol.measurementElapsedMs = 61500;
    },
  ],
  [
    'timing profiler trace in acceptance sample',
    (report) => {
      report.pairs[0].cadence.candidate.timingTrace = { enabled: true };
    },
  ],
  [
    'wrong cadence mode',
    (report) => {
      report.pairs[4].cadence.baseline.mode = 'cadence';
    },
  ],
];
for (const [name, mutate] of extendedInvalidCases)
  test(`reject extended cadence with ${name}`, async () => {
    const report = extendedReport();
    mutate(report);
    await assert.rejects(validateFleetComparison(report));
  });
const invalidCases = [
  [
    'pending lighting compute work',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'lighting-readiness',
      );
      p.state.globalQueue.active = 1;
    },
  ],
  [
    'unfinished model irradiance texture',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'lighting-readiness',
      );
      p.state.items[0].dirty.irradianceTexture = true;
    },
  ],
  [
    'unavailable model lighting metric posing as zero',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'lighting-readiness',
      );
      p.state.items[0].pending.convolution = null;
    },
  ],
  [
    'visible fleet fallback alongside models',
    (r) => {
      r.pairs[0].correctness.candidate.samples.find(
        (s) => s.name === 'civil-tracked',
      ).output.civil.billboards[0].show = true;
    },
  ],
  [
    'opaque tracked fallback alongside model',
    (r) => {
      r.pairs[0].correctness.candidate.samples.find(
        (s) => s.name === 'civil-tracked',
      ).trackedBillboards.items[0].alpha = 1;
    },
  ],
  [
    'missing tracked fallback observation',
    (r) => {
      delete r.pairs[0].correctness.candidate.samples.find(
        (s) => s.name === 'civil-tracked',
      ).trackedBillboards;
    },
  ],
  [
    'retained released tracked billboard',
    (r) => {
      const samples = r.pairs[0].correctness.candidate.samples;
      samples.find((s) => s.name === 'civil-released').trackedBillboards =
        structuredClone(
          samples.find((s) => s.name === 'civil-tracked').trackedBillboards,
        );
    },
  ],
  [
    'missing model readiness barrier',
    (r) => {
      r.pairs[0].correctness.candidate.phases =
        r.pairs[0].correctness.candidate.phases.filter(
          (p) => p.kind !== 'model-readiness',
        );
    },
  ],
  [
    'readiness from a previous frame',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'model-readiness',
      );
      p.observedFrame = p.startFrame;
    },
  ],
  [
    'no logical tick after readiness',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'model-readiness',
      );
      p.logicalTimeMs += 80;
    },
  ],
  [
    'duplicate model identity instead of a complete source population',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'model-readiness',
      );
      p.models.items[0].id = p.models.items[1].id;
    },
  ],
  [
    'unfinished model load',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'model-readiness',
      );
      p.models.items[0].ready = false;
    },
  ],
  [
    'unbounded cold activation',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'model-readiness',
      );
      p.elapsedMs = 30001;
    },
  ],
  [
    'billboard fallback posing as model handoff',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'settled' && p.name === 'civil-tracked',
      );
      p.models.items[0].effectiveShow = false;
    },
  ],
  [
    'pre-publication movement',
    (r) => {
      const p = r.pairs[0].correctness.candidate.phases.find(
        (p) => p.kind === 'movement',
      );
      p.observedFrame = p.publicationFrame;
    },
  ],
  [
    'missing baseline repeat',
    (r) => {
      delete r.baselineRepeat;
    },
  ],
  [
    'unstable baseline repeat',
    (r) => {
      r.baselineRepeat[1].samples[0].camera.position[0]++;
    },
  ],
  [
    'later baseline drift',
    (r) => {
      for (const side of ['baseline', 'candidate'])
        r.pairs[4].correctness[side].samples[0].camera.position[0]++;
    },
  ],
  [
    'missing stability witness',
    (r) => {
      r.pairs[0].correctness.candidate.phases = [];
    },
  ],
  [
    'fixed sleep posing as camera stability',
    (r) => {
      r.pairs[0].correctness.candidate.phases.find(
        (p) => p.name === 'civil-tracked',
      ).frames = 0;
    },
  ],
  [
    'rewound reinitialization clock',
    (r) => {
      for (const side of ['baseline', 'candidate'])
        r.pairs[0].correctness[side].samples.at(-1).logicalTimeMs = Date.UTC(
          2026,
          9,
          8,
          12,
        );
    },
  ],
  [
    'matched but wrong display epochs',
    (r) => {
      for (const side of ['baseline', 'candidate'])
        r.pairs[0].correctness[side].samples[1].logicalTimeMs++;
    },
  ],
  [
    'matched but visible disabled fleet',
    (r) => {
      for (const side of ['baseline', 'candidate']) {
        const s = r.pairs[0].correctness[side].samples.find(
          (s) => s.name === 'disabled',
        );
        s.pixels = { ...image };
      }
    },
  ],
  [
    'disabled collection still enabled',
    (r) => {
      r.pairs[0].correctness.candidate.samples.find(
        (s) => s.name === 'disabled',
      ).output.civil.billboards[0].collectionShow = true;
    },
  ],
  [
    'wrong source',
    (r) => {
      r.pairs[0].correctness.candidate.applicationCommit = 'c'.repeat(40);
    },
  ],
  [
    'missing pair',
    (r) => {
      r.pairs.pop();
    },
  ],
  [
    'missing checks',
    (r) => {
      r.pairs[0].correctness.baseline.checks = [];
    },
  ],
  [
    'different resolution',
    (r) => {
      r.pairs[0].correctness.candidate.settings.resolutionScale = 0.5;
    },
  ],
  [
    'different population',
    (r) => {
      r.pairs[0].correctness.candidate.samples[0].output.civil.count--;
    },
  ],
  [
    'different position',
    (r) => {
      r.pairs[0].correctness.candidate.samples[0].output.civil.billboards[0]
        .position[0]++;
    },
  ],
  [
    'forged pixel hash',
    (r) => {
      r.pairs[0].correctness.candidate.samples[0].pixels.sha256 = '0'.repeat(
        64,
      );
    },
  ],
  [
    'retained owner',
    (r) => {
      r.pairs[0].correctness.candidate.cleanup.beforeUninstall.holds = [
        'flights',
      ];
    },
  ],
  [
    'slower visual updates',
    (r) => {
      r.pairs[0].cadence.candidate.cadence.fleetUpdateTimesMs.civil =
        Array.from({ length: 24 }, (_, i) => i * 120);
    },
  ],
  [
    'no rendering benefit',
    (r) => {
      r.pairs[0].cadence.candidate.cadence.frameTimesMs = [
        ...r.pairs[0].cadence.baseline.cadence.frameTimesMs,
      ];
    },
  ],
];
for (const [name, mutate] of invalidCases)
  test(`reject ${name}`, async () => {
    const report = validReport();
    mutate(report);
    await assert.rejects(validateFleetComparison(report));
  });
