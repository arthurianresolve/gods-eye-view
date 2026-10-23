import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildTrackedFloorCoverage,
  trackedFloorCoverageSample,
  trackedFloorCoverageSamplePasses,
} from './trackedFloorCoverage.mjs';

test('tracked-floor route covers display start, feed fix, and bounded forward motion', () => {
  // Exercise the exact Function-construction used to install these pure
  // helpers in the serialized browser callback, where module closures do not
  // exist.
  const buildInPage = new Function(
    `return (${buildTrackedFloorCoverage.toString()})`,
  )();
  const sampleInPage = new Function(
    `return (${trackedFloorCoverageSample.toString()})`,
  )();
  const passesInPage = new Function(
    `return (${trackedFloorCoverageSamplePasses.toString()})`,
  )();
  const route = buildInPage({
    start: { lat: 30.26, lon: -97.754 },
    feedFix: { lat: 30.26, lon: -97.75 },
    trackDeg: 90,
    velocityMps: 12,
    horizonMs: 43100,
  });

  assert.equal(route.error, undefined);
  assert.ok(route.forwardDistanceM > 517 && route.forwardDistanceM < 518);
  assert.ok(route.endpoint.lon > route.feedFix.lon);
  assert.ok(route.cells.length <= 64);
  assert.ok(route.sampledPoints <= 1024);
  for (const point of [route.start, route.feedFix, route.endpoint]) {
    const key = `${Number(point.lat.toFixed(3))},${Number(point.lon.toFixed(3))}`;
    assert.ok(route.cells.some((cell) => `${cell.lat},${cell.lon}` === key));
  }

  const endpointSample = sampleInPage({
    position: { ...route.endpoint, heightM: 100 },
    startedAtMs: 500,
    nowMs: 43100,
    route,
    meshFloor: 440,
  });
  assert.equal(endpointSample.withinSeededRoute, true);
  assert.equal(endpointSample.withinTimeBound, true);
  assert.equal(passesInPage(endpointSample, 440), true);
});

test('coverage rejects elapsed, unseeded, missing-floor, and malformed checkpoints', () => {
  const route = buildTrackedFloorCoverage({
    start: { lat: 30.26, lon: -97.754 },
    feedFix: { lat: 30.26, lon: -97.75 },
    trackDeg: 90,
    velocityMps: 12,
    horizonMs: 43100,
  });
  const input = {
    position: {
      lat: route.endpoint.lat,
      lon: route.endpoint.lon,
      heightM: 100,
    },
    startedAtMs: 1000,
    nowMs: 44101,
    route,
    meshFloor: 440,
  };
  assert.equal(
    trackedFloorCoverageSamplePasses(trackedFloorCoverageSample(input), 440),
    false,
  );
  assert.equal(
    trackedFloorCoverageSamplePasses(
      trackedFloorCoverageSample({
        ...input,
        nowMs: 2000,
        position: {
          lat: route.endpoint.lat + 0.02,
          lon: route.endpoint.lon,
          heightM: 100,
        },
      }),
      440,
    ),
    false,
  );
  assert.equal(
    trackedFloorCoverageSamplePasses(
      trackedFloorCoverageSample({
        ...input,
        nowMs: 2000,
        meshFloor: null,
      }),
      440,
    ),
    false,
  );
  assert.equal(trackedFloorCoverageSample({ ...input, position: null }), null);
});

test('route construction fails closed before producing a partial route over its cap', () => {
  const rejected = buildTrackedFloorCoverage({
    start: { lat: 30.26, lon: -97.754 },
    feedFix: { lat: 30.26, lon: -97.75 },
    trackDeg: 90,
    velocityMps: 12,
    horizonMs: 43100,
    maxCells: 4,
  });
  assert.match(rejected.error, /exceeds construction bounds/);
  assert.ok(rejected.cellCount <= 5);
  assert.ok(!Array.isArray(rejected.cells));

  const malformed = buildTrackedFloorCoverage({
    start: { lat: 30.26, lon: -97.754 },
    feedFix: { lat: 30.26, lon: -97.75 },
    trackDeg: 90,
    velocityMps: 12,
    horizonMs: 43100,
    maxSamples: 2,
  });
  assert.match(malformed.error, /exceeds construction bounds/);
});

test('tracking browser callback receives the serialized helpers it constructs', async () => {
  const runnerPath = new URL('../track-regression.mjs', import.meta.url);
  const source = await readFile(fileURLToPath(runnerPath), 'utf8');
  assert.match(
    source,
    /const coverageHelperSource\s*=\s*\{[\s\S]*?build:\s*buildTrackedFloorCoverage\.toString\(\)[\s\S]*?sample:\s*trackedFloorCoverageSample\.toString\(\)/,
  );
  assert.match(
    source,
    /const dfTracked\s*=\s*await evalPage\(async \(helperSource\) => \{[\s\S]*?new Function\(`return \(\$\{helperSource\.build\}\)`\)\(\)[\s\S]*?\},\s*coverageHelperSource\);/,
  );
});
