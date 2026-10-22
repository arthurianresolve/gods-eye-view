import assert from 'node:assert/strict';

export const VISIBLE_CONTROL_VARIANCE_POLICY =
  'matched-visible-control-variance-v1';

/**
 * A narrow control for browser raster variation, never a pixel mask. Both
 * revisions must independently produce both identical full-image controls.
 * The initial still must equal one complete control from its own revision.
 */
export function validateVisibleControlVariance({ still, visible, restored }) {
  const images = [
    still.baseline,
    still.candidate,
    visible.baseline,
    visible.candidate,
    restored.baseline,
    restored.candidate,
  ];
  for (const pixels of images) {
    assert.ok(Buffer.isBuffer(pixels), 'Decoded RGBA control pixels required');
    assert.ok(pixels.length > 0 && pixels.length % 4 === 0);
    assert.equal(pixels.length, images[0].length, 'Control dimensions differ');
  }
  assert.ok(
    visible.baseline.equals(visible.candidate),
    'Visible controls differ across builds',
  );
  assert.ok(
    restored.baseline.equals(restored.candidate),
    'Restored controls differ across builds',
  );
  for (const side of ['baseline', 'candidate'])
    assert.ok(
      still[side].equals(visible[side]) || still[side].equals(restored[side]),
      `${side} still does not match either complete same-build control`,
    );
  const differences = [];
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < visible.baseline.length; offset += 4) {
    const a = visible.baseline.subarray(offset, offset + 4);
    const b = restored.baseline.subarray(offset, offset + 4);
    if (a.equals(b)) continue;
    assert.equal(a[3], b[3], 'Control alpha changed');
    for (let channel = 0; channel < 3; channel++)
      maximumChannelDelta = Math.max(
        maximumChannelDelta,
        Math.abs(a[channel] - b[channel]),
      );
    assert.ok(
      maximumChannelDelta <= 10,
      'Control color variation exceeds 10/255',
    );
    differences.push({
      pixelIndex: offset / 4,
      visible: [...a],
      restored: [...b],
    });
    assert.ok(differences.length <= 10, 'Control variation exceeds 10 pixels');
  }
  return {
    policy: VISIBLE_CONTROL_VARIANCE_POLICY,
    variedPixels: differences.length,
    totalPixels: images[0].length / 4,
    maximumChannelDelta,
    differences,
  };
}
