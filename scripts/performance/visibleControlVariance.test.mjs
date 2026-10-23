import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVisibleControlVariance } from './visibleControlVariance.mjs';

function sample(count = 7, delta = 9) {
  const a = Buffer.alloc(80, 100),
    b = Buffer.from(a);
  for (let i = 0; i < count; i++) b[i * 4] += delta;
  return {
    still: { baseline: Buffer.from(a), candidate: Buffer.from(b) },
    visible: { baseline: Buffer.from(a), candidate: Buffer.from(a) },
    restored: { baseline: Buffer.from(b), candidate: Buffer.from(b) },
  };
}

test('accepts only tiny variation independently present in both complete controls', () => {
  const result = validateVisibleControlVariance(sample());
  assert.equal(result.variedPixels, 7);
  assert.equal(result.maximumChannelDelta, 9);
  assert.equal(result.totalPixels, 20);
});

test('a new one-pixel candidate regression cannot borrow control variance', () => {
  const value = sample();
  value.still.candidate[60]++;
  assert.throws(
    () => validateVisibleControlVariance(value),
    /complete same-build control/,
  );
});

test('controls must agree across revisions and cannot synthesize mixed images', () => {
  const changed = sample();
  changed.visible.candidate[60]++;
  assert.throws(
    () => validateVisibleControlVariance(changed),
    /controls differ across builds/,
  );
  const mixed = sample();
  mixed.still.candidate[0] = mixed.visible.candidate[0];
  assert.throws(
    () => validateVisibleControlVariance(mixed),
    /complete same-build control/,
  );
});

test('excessive area, color change and alpha changes remain failures', () => {
  assert.throws(() => validateVisibleControlVariance(sample(11)), /10 pixels/);
  assert.throws(() => validateVisibleControlVariance(sample(1, 11)), /10\/255/);
  const alpha = sample();
  for (const pair of [alpha.restored, alpha.still]) pair.candidate[3]++;
  alpha.restored.baseline[3]++;
  assert.throws(
    () => validateVisibleControlVariance(alpha),
    /Control alpha changed/,
  );
});

test('rejects malformed decoded buffers and dimension mismatches', () => {
  const absent = sample();
  absent.visible.baseline = null;
  assert.throws(() => validateVisibleControlVariance(absent), /RGBA/);
  const truncated = sample();
  truncated.visible.baseline = Buffer.alloc(4);
  assert.throws(
    () => validateVisibleControlVariance(truncated),
    /dimensions differ/,
  );
});
