import assert from 'node:assert/strict';

export const REPEATED_VISUAL_POLICY = 'repeated-full-image-controls-v1';
export const REPEATED_VISUAL_REPEATS = 3;

/**
 * Large raster variants need an independent complete-image counterpart in the
 * other build. Tiny residual variation keeps the prior 10 pixels / 10 RGB
 * bound AND requires each differing value to recur at that pixel in BOTH
 * builds' fixed controls. A novel candidate pixel cannot borrow a noise budget.
 * No coordinates are masked and no accepted image is synthesized.
 */
export function validateRepeatedFullImageControls(
  { baseline, candidate },
  { exact = false } = {},
) {
  let byteLength;
  for (const [side, images] of Object.entries({ baseline, candidate })) {
    assert.equal(
      images.length,
      REPEATED_VISUAL_REPEATS,
      `${side} needs three fixed controls`,
    );
    assert.equal(new Set(images.map((image) => image.id)).size, images.length);
    for (const image of images) {
      assert.ok(
        Buffer.isBuffer(image.pixels) &&
          image.pixels.length > 0 &&
          image.pixels.length % 4 === 0,
        'Decoded RGBA image required',
      );
      byteLength ??= image.pixels.length;
      assert.equal(
        image.pixels.length,
        byteLength,
        'Control dimensions differ',
      );
    }
  }
  const valueOccurs = (images, offset, pixels) =>
    images.some((image) =>
      image.pixels
        .subarray(offset, offset + 4)
        .equals(pixels.subarray(offset, offset + 4)),
    );
  const compare = (left, right) => {
    if (left.pixels.equals(right.pixels))
      return { changedPixels: 0, maximumChannelDelta: 0, differences: [] };
    const differences = [];
    let maximumChannelDelta = 0;
    for (let offset = 0; offset < byteLength; offset += 4) {
      if (
        left.pixels[offset] === right.pixels[offset] &&
        left.pixels[offset + 1] === right.pixels[offset + 1] &&
        left.pixels[offset + 2] === right.pixels[offset + 2] &&
        left.pixels[offset + 3] === right.pixels[offset + 3]
      )
        continue;
      if (exact || left.pixels[offset + 3] !== right.pixels[offset + 3])
        return null;
      for (let channel = 0; channel < 3; channel++)
        maximumChannelDelta = Math.max(
          maximumChannelDelta,
          Math.abs(
            left.pixels[offset + channel] - right.pixels[offset + channel],
          ),
        );
      if (maximumChannelDelta > 10 || differences.length >= 10) return null;
      for (const images of [baseline, candidate])
        if (
          !valueOccurs(images, offset, left.pixels) ||
          !valueOccurs(images, offset, right.pixels)
        )
          return null;
      differences.push({
        pixelIndex: offset / 4,
        left: [...left.pixels.subarray(offset, offset + 4)],
        right: [...right.pixels.subarray(offset, offset + 4)],
      });
    }
    return {
      changedPixels: differences.length,
      maximumChannelDelta,
      differences,
    };
  };
  const matches = [];
  for (const [side, images, controls] of [
    ['baseline', baseline, candidate],
    ['candidate', candidate, baseline],
  ]) {
    for (const image of images) {
      const witnesses = controls.flatMap((control) => {
        const difference = compare(image, control);
        return difference ? [{ id: control.id, ...difference }] : [];
      });
      assert.ok(
        witnesses.length > 0,
        `${side} ${image.id} has no independently reproduced complete-image control`,
      );
      matches.push({ side, id: image.id, witnesses });
    }
  }
  return {
    policy: REPEATED_VISUAL_POLICY,
    totalPixels: byteLength / 4,
    exact,
    matches,
  };
}
