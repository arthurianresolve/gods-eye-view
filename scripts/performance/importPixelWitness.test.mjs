import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRgbaDifferences } from './importPixelWitness.mjs';

test('pixel witness reports exact changed coordinates with a bounded sample', () => {
  const before = new Uint8ClampedArray(4 * 10);
  const after = new Uint8ClampedArray(4 * 10);
  after[4] = 12;
  after[5 * 4 + 2] = 255;
  const result = summarizeRgbaDifferences(before, after, 5, 2, 1);

  assert.equal(result.differingPixels, 2);
  assert.equal(result.maximumChannelDelta, 255);
  assert.deepEqual(result.firstSamples, [
    { x: 1, y: 0, before: [0, 0, 0, 0], after: [12, 0, 0, 0] },
  ]);
  assert.equal(result.samplesTruncated, true);
});

test('pixel witness rejects mismatched buffers and unbounded sample limits', () => {
  const pixels = new Uint8ClampedArray(4);
  assert.throws(
    () => summarizeRgbaDifferences(pixels, new Uint8ClampedArray(8), 1, 1),
    /dimensions or buffers are invalid/,
  );
  assert.throws(
    () => summarizeRgbaDifferences(pixels, pixels, 1, 1, 25),
    /dimensions or buffers are invalid/,
  );
});
