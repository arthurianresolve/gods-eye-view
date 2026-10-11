const MAX_PIXEL_SAMPLES = 24;

/** Summarize exact RGBA differences without retaining an unbounded pixel list. */
export function summarizeRgbaDifferences(
  before,
  after,
  width,
  height,
  limit = MAX_PIXEL_SAMPLES,
) {
  const expectedLength = width * height * 4;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    before?.length !== expectedLength ||
    after?.length !== expectedLength ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > MAX_PIXEL_SAMPLES
  )
    throw new TypeError('Pixel witness dimensions or buffers are invalid.');

  let differingPixels = 0;
  let maximumChannelDelta = 0;
  const samples = [];
  for (let offset = 0; offset < expectedLength; offset += 4) {
    let changed = false;
    let pixelMaximum = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        before[offset + channel] - after[offset + channel],
      );
      if (delta !== 0) changed = true;
      pixelMaximum = Math.max(pixelMaximum, delta);
    }
    if (!changed) continue;
    differingPixels++;
    maximumChannelDelta = Math.max(maximumChannelDelta, pixelMaximum);
    if (samples.length < limit) {
      const pixelIndex = offset / 4;
      samples.push({
        x: pixelIndex % width,
        y: Math.floor(pixelIndex / width),
        before: Array.from(before.subarray(offset, offset + 4)),
        after: Array.from(after.subarray(offset, offset + 4)),
      });
    }
  }
  return {
    differingPixels,
    maximumChannelDelta,
    firstSamples: samples,
    samplesTruncated: differingPixels > samples.length,
  };
}
