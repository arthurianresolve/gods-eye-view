import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const input = new URL('bounds-report.json', import.meta.url);
const reportBytes = await readFile(input);
const r = JSON.parse(reportBytes);
const c = r.pointCollections;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = async data => {
  assert.match(data, /^data:image\/png;base64,/);
  const {data: pixels, info} = await sharp(Buffer.from(data.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  return pixels;
};
assert.equal(r.commit, 'c5889ef0046f8ca05e2f2cd0321e2038a58d7f74');
assert.equal(r.status, 'failed');
assert.equal(c.status, 'failed');
assert.equal(c.samples.length, 2);
const [mixed, partitioned] = c.samples;
const a = partitioned.boundsAttribution;
assert.equal(mixed.mode, 'mixed');
assert.equal(partitioned.mode, 'partitioned');
assert.equal(mixed.positionSha256, partitioned.positionSha256);
assert.equal(mixed.points, 10840);
assert.equal(partitioned.points, mixed.points);
assert.equal(c.settings.msaaSamples, 4);
assert.equal(c.settings.resolutionScale, 1);
assert.equal(c.settings.context.antialias, true);
assert.equal(c.settings.context.preserveDrawingBuffer, true);
const [before, after, intervened, restored] = await Promise.all([
  c.visualMismatch.beforePng, c.visualMismatch.afterPng, a.intervenedPng, a.restoredPng,
].map(decode));
assert.equal(sha(before), mixed.pixels);
assert.equal(sha(after), partitioned.pixels);
assert.equal(sha(intervened), a.intervenedPixels);
assert.equal(sha(restored), a.restoredPixels);
assert.deepEqual(before, intervened);
assert.deepEqual(after, restored);
let changedPixels = 0, maximumChannelDifference = 0;
for (let i = 0; i < before.length; i += 4) {
  let changed = false;
  for (let j = 0; j < 4; j++) {
    const difference = Math.abs(before[i+j] - after[i+j]);
    maximumChannelDifference = Math.max(maximumChannelDifference, difference);
    changed ||= difference !== 0;
  }
  if (changed) changedPixels++;
}
assert.equal(changedPixels, 24);
assert.equal(maximumChannelDifference, 36);
const planes = d => d.frustums.map(({near,far}) => ({near,far}));
assert.deepEqual(planes(mixed.renderDiagnostics), planes(a.intervenedDiagnostics));
assert.deepEqual(planes(partitioned.renderDiagnostics), planes(a.restoredDiagnostics));
assert.notDeepEqual(planes(mixed.renderDiagnostics), planes(partitioned.renderDiagnostics));
assert.equal(a.intervenedDiagnostics.emittedPointCommands.length, 4);
for (const command of a.intervenedDiagnostics.emittedPointCommands) assert.deepEqual(command.bounds, a.sourceMixedBounds);
for (const d of [mixed.renderDiagnostics, partitioned.renderDiagnostics, a.intervenedDiagnostics, a.restoredDiagnostics]) {
  assert.equal(d.oit.active, true);
  assert.equal(d.captureFrameNumber, d.emittedCommandFrameNumber);
  assert.equal(d.truncatedEmittedPointCommands, 0);
  assert.equal(d.projectedPointCount, 10840);
  assert.equal(d.projectedMismatchNeighborhoods.length, 24);
  assert.ok(d.projectedMismatchNeighborhoods.every(target => target.points.length > 0));
  assert.deepEqual(d.projectedMismatchNeighborhoods, mixed.renderDiagnostics.projectedMismatchNeighborhoods);
}
assert.equal(r.browserClose.closeCompleted, true);
assert.equal(r.browserClose.forcedProcessTermination, false);
const review = {
  status: 'verified-causal-control-original-comparison-failed',
  commit: r.commit,
  reportSha256: sha(reportBytes),
  decodedImages: 4,
  naturalChangedPixels: changedPixels,
  maximumChannelDifference,
  interventionChangedPixelsVersusMixed: 0,
  restoredChangedPixelsVersusNatural: 0,
  pointCount: mixed.points,
  positionSha256: mixed.positionSha256,
  boundsInterventionOnlyAfterMeasurements: true,
  actualOitActiveInAllFourCaptures: true,
  frameBoundMetadata: true,
  identicalProjectedNeighborhoods: true,
  planes: {mixed:planes(mixed.renderDiagnostics), partitioned:planes(partitioned.renderDiagnostics), intervened:planes(a.intervenedDiagnostics), restored:planes(a.restoredDiagnostics)},
  environment: c.environment,
  conclusion: 'For this fixed Cesium 1.138 fixture, replacing split draw-command bounds with the original mixed bounds removes the image difference and restoring natural split bounds restores it. OIT remains active, positions/settings remain unchanged, and fitted frustum planes follow the intervention. This identifies the bounds/frustum dependency without identifying the exact GPU arithmetic instruction. No production private-command override or collection partition is accepted.',
};
console.log(JSON.stringify({...review, environment: undefined}));
