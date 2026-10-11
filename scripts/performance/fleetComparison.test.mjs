import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  FLEET_CHECKS,
  FLEET_SHOTS,
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
          schema: 'gev-fleet-render-demand/v2',
          status: 'passed',
          applicationCommit: report[implementation],
          harnessCommit: report.harness,
          implementation,
          mode,
          fixture: '20-aircraft-fixed-source/v2',
          epochMs: Date.UTC(2026, 9, 8, 12),
          pageErrors: [],
          checks: checks.map((id) => ({ id, status: 'passed' })),
          settings,
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
                    });
                  }
                  const offset =
                    name === 'initial' || name === 'reinitialized'
                      ? 0
                      : name.startsWith('motion-')
                        ? Number(name.slice(7))
                        : 30000;
                  return {
                    name,
                    output: visible,
                    camera: { position: [1, 2, 3] },
                    logicalTimeMs: Date.UTC(2026, 9, 8, 12) + offset,
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
  return report;
}

test('valid five-pair evidence decodes all images and quantifies frame savings', async () => {
  const result = await validateFleetComparison(validReport());
  assert.equal(result.status, 'passed');
  assert.equal(result.decodedImages, 150);
  assert.equal(result.medianRenderedFrameReduction, 0.76);
});
const invalidCases = [
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
