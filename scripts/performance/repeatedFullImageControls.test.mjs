import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRepeatedFullImageControls } from './repeatedFullImageControls.mjs';

const blank = () =>
  Buffer.from(Array.from({ length: 32 }, () => [20, 30, 40, 255]).flat());
const changed = (source, index, delta) => {
  const result = Buffer.from(source);
  result[index * 4] += delta;
  return result;
};
const images = (values) =>
  values.map((pixels, index) => ({ id: String(index + 1), pixels }));

test('admits large variants only when whole images recur independently in both builds', () => {
  const a = blank();
  const b = changed(a, 0, 103);
  const result = validateRepeatedFullImageControls({
    baseline: images([a, b, a]),
    candidate: images([b, a, b]),
  });
  assert.equal(result.matches.length, 6);
  const novel = changed(b, 20, 1);
  assert.throws(
    () =>
      validateRepeatedFullImageControls({
        baseline: images([a, b, a]),
        candidate: images([b, a, novel]),
      }),
    /no independently reproduced/,
  );
});

test('rejects candidate-only low-delta pixels even below the historical small bound', () => {
  const a = blank();
  const b = changed(a, 0, 1);
  assert.throws(
    () =>
      validateRepeatedFullImageControls({
        baseline: images([a, a, a]),
        candidate: images([b, b, b]),
      }),
    /no independently reproduced/,
  );
});

test('allows tiny independently observed values without requiring matched occurrence order', () => {
  const a = blank();
  const b = changed(a, 0, 7);
  const c = changed(a, 1, 8);
  const d = changed(b, 1, 8);
  const result = validateRepeatedFullImageControls({
    baseline: images([a, b, d]),
    candidate: images([a, c, d]),
  });
  assert.equal(result.matches.length, 6);
  assert.ok(
    result.matches.some((match) =>
      match.witnesses.some((w) => w.changedPixels > 0),
    ),
  );
  assert.throws(
    () =>
      validateRepeatedFullImageControls(
        {
          baseline: images([a, b, d]),
          candidate: images([a, c, d]),
        },
        { exact: true },
      ),
    /no independently reproduced/,
  );
});

test('does not construct a mixed image from large variants or hide novel geometry', () => {
  const a = blank();
  const b = changed(changed(a, 0, 100), 1, 100);
  const mixed = changed(a, 0, 100);
  assert.throws(
    () =>
      validateRepeatedFullImageControls({
        baseline: images([a, b, a]),
        candidate: images([a, b, mixed]),
      }),
    /no independently reproduced/,
  );
});

test('enforces reciprocal coverage, alpha equality, all three controls, and dimensions', () => {
  const a = blank();
  const b = changed(a, 0, 100);
  assert.throws(
    () =>
      validateRepeatedFullImageControls({
        baseline: images([a, b, a]),
        candidate: images([a, a, a]),
      }),
    /baseline.*no independently reproduced/,
  );
  const alpha = Buffer.from(a);
  alpha[3]--;
  assert.throws(() =>
    validateRepeatedFullImageControls({
      baseline: images([a, a, a]),
      candidate: images([alpha, alpha, alpha]),
    }),
  );
  assert.throws(() =>
    validateRepeatedFullImageControls({
      baseline: images([a, a]),
      candidate: images([a, a, a]),
    }),
  );
  assert.throws(() =>
    validateRepeatedFullImageControls({
      baseline: images([a, a, a]),
      candidate: images([a, a, a.subarray(4)]),
    }),
  );
});
