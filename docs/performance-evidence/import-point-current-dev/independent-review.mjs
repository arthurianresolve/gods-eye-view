import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const directory = resolve(process.argv[2]);
const expectedCommit = 'eb2d6d95ab35bdbbf964eea305226cae763b8a48';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(join(directory, 'report.json'));
const report = JSON.parse(bytes);
assert.equal(report.status, 'passed');
assert.equal(report.provenance.applicationCommit, expectedCommit);
assert.equal(report.provenance.harnessCommit, expectedCommit);
assert.equal(report.pairs.length, 5);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const decodedDirectory = join(directory, 'decoded-review');
await mkdir(decodedDirectory, { recursive: true });
const images = [], rows = [], hashes = {};
async function decode(url, width, height, expectedHash, name) {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 1024);
  assert.ok(Number.isInteger(height) && height > 0 && height <= 1024);
  assert.ok(typeof url === 'string' && url.length <= 1_500_000);
  assert.ok(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(url));
  const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  const { data, info } = await sharp(png, { limitInputPixels: 1024 * 1024 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  assert.equal(info.channels, 4);
  const actualHash = sha(data);
  assert.equal(actualHash, expectedHash, `${name} declared pixel hash`);
  await writeFile(join(decodedDirectory, `${name}.png`), png);
  images.push({ name, width, height, pngSha256: sha(png), rgbaSha256: actualHash });
  return data;
}
for (const [index, pair] of report.pairs.entries()) {
  assert.equal(pair.pair, index);
  assert.deepEqual(pair.executionOrder, index % 2 ? ['primitive-collection', 'entity'] : ['entity', 'primitive-collection']);
  const fixtures = [];
  for (const [representation, nested, expectedHash] of [
    ['entity', pair.entityRun, pair.entityReportSha256],
    ['primitive-collection', pair.collectionRun, pair.collectionReportSha256],
  ]) {
    const filename = `pair-${index}-${representation}.json`;
    const raw = await readFile(join(directory, filename));
    const run = JSON.parse(raw);
    assert.deepEqual(run, nested, filename);
    assert.equal(sha(JSON.stringify(run)), expectedHash);
    hashes[filename] = sha(raw);
    assert.equal(run.status, 'passed');
    assert.equal(run.commit, expectedCommit);
    assert.equal(run.importPageErrors.length, 0);
    assert.equal(run.hardwareRenderingAvailable, true);
    assert.equal(run.captureMatrix.status, 'passed');
    const fixture = run.importBatches;
    assert.equal(fixture.applicationCommit, expectedCommit);
    assert.equal(fixture.harnessCommit, expectedCommit);
    assert.equal(fixture.pointRepresentation, representation);
    assert.equal(fixture.samples.length, 10);
    assert.equal(fixture.cancellation.attempted, 12);
    assert.equal(fixture.cancellation.abortErrors, 12);
    assert.equal(fixture.cancellation.pendingJobsAfter, 0);
    assert.equal(fixture.cancellation.featureCountAfter, 0);
    assert.equal(fixture.cancellation.pointPrimitiveCountAfter, 0);
    fixtures.push(fixture);
    const mixed = fixture.mixedGeometryParity;
    assert.equal(sha(JSON.stringify(mixed.rows)), mixed.rowsSha256);
    assert.equal(sha(JSON.stringify(mixed.nativePicks)), mixed.nativePicksSha256);
    assert.equal(mixed.nativePicks.length, 3);
    assert.ok(mixed.nativePicks.every(row => row.expectedEntityId === row.pickedEntityId));
  }
  const [entity, collection] = fixtures;
  for (let sampleIndex = 0; sampleIndex < 10; sampleIndex++) {
    const e = entity.samples[sampleIndex], c = collection.samples[sampleIndex];
    assert.equal(e.mode, c.mode);
    const pixels = [];
    for (const [representation, sample] of [['entity', e], ['collection', c]]) {
      const name = `pair-${index}-${representation}-${sampleIndex}`;
      pixels.push(await decode(sample.pixelPngDataUrl, sample.capture.width, sample.capture.height, sample.pixelSha256, name));
      assert.equal(sample.resources.importedFeatureCount, 5000);
      assert.equal(sample.resources.pointPrimitiveCount, 5000);
      assert.equal(sample.resourcesAfterClear.importedFeatureCount, 0);
      assert.equal(sample.resourcesAfterClear.pointPrimitiveCount, representation === 'entity' ? 5000 : 0);
      const picks = sample.pointVisualState.nativePickWitness.rows;
      assert.equal(picks.length, 9);
      // The dense grid intentionally overlaps at this camera scale. Compare
      // the natural frontmost pick across renderers, not the aimed-at center.
      assert.ok(picks.every(row => /^gev-import:fixture:fixture:\d+$/.test(row.pickedEntityId)));
    }
    assert.ok(pixels[0].equals(pixels[1]), `pair ${index} sample ${sampleIndex} pixels`);
    assert.deepEqual(e.pointVisualState.nativePickWitness.rows, c.pointVisualState.nativePickWitness.rows);
    for (const field of ['entityOrderAndStateSha256', 'entityToPrimitiveAssignmentSha256', 'primitiveDrawOrderAndStateSha256'])
      assert.equal(e.pointVisualState[field], c.pointVisualState[field]);
  }
  const mixedPixels = [];
  for (const [representation, fixture] of [['entity', entity], ['collection', collection]]) {
    const capture = fixture.mixedGeometryParity.capture;
    mixedPixels.push(await decode(capture.pngDataUrl, capture.width, capture.height, capture.pixelSha256, `pair-${index}-${representation}-mixed`));
  }
  assert.ok(mixedPixels[0].equals(mixedPixels[1]));
  assert.deepEqual(entity.mixedGeometryParity.rows, collection.mixedGeometryParity.rows);
  assert.deepEqual(entity.mixedGeometryParity.nativePicks, collection.mixedGeometryParity.nativePicks);
  const metrics = { pair: index };
  for (const mode of ['synchronous', 'cooperative']) {
    metrics[mode] = {};
    for (const field of ['elapsedMs', 'clearCallElapsedMs', 'resetDrainElapsedMs', 'clearAndDrainElapsedMs', 'captureElapsedMs', 'maxHeartbeatGapMs']) {
      const e = median(entity.samples.filter(s => s.mode === mode).map(s => s[field]));
      const c = median(collection.samples.filter(s => s.mode === mode).map(s => s[field]));
      metrics[mode][field] = { entity: e, collection: c, deltaPercent: e ? (c / e - 1) * 100 : null };
    }
  }
  rows.push(metrics);
}
const review = {
  schema: 'gev-independent-import-point-review/v1',
  expectedCommit,
  sourceSha256: sha(bytes),
  rawHashes: hashes,
  decodedPngs: images.length,
  exactMatchedImagePairs: images.length / 2,
  images,
  perPairMetrics: rows,
  medianPairedDeltaPercent: Object.fromEntries(['synchronous', 'cooperative'].map(mode => [mode, Object.fromEntries(Object.keys(rows[0][mode]).map(field => [field, median(rows.map(row => row[mode][field].deltaPercent))]))])),
  scope: 'Five hosted renderer pairs; raw PNG pixels and native picks independently compared. Full 5000-row states are hashed in source reports and cannot be independently reconstructed from bounded reports. Live point counts are not post-GC heap evidence. No physical Windows or full S59/S60 acceptance.',
};
await writeFile(join(directory, 'independent-review.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ decodedPngs: review.decodedPngs, exactMatchedImagePairs: review.exactMatchedImagePairs, medianPairedDeltaPercent: review.medianPairedDeltaPercent }, null, 2));
