import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCsvDecodeFixtures,
  summarizeCsvComparison,
} from './csvDecodeComparison.mjs';
import { parseCsv } from '../../src/imports/geojsonCsv.js';

test('CSV comparison fixtures are bounded and exercise aligned CRLF with quoted commas', () => {
  for (const fixture of createCsvDecodeFixtures()) {
    assert.ok(Buffer.byteLength(fixture.input) <= 8 * 1024 * 1024);
    const parsed = parseCsv(fixture.input);
    assert.equal(parsed.rows.length, fixture.rows);
    assert.equal(parsed.rows[0][0], 'row-0');
    assert.equal(parsed.rows.at(-1)[0], `row-${fixture.rows - 1}`);
    if (fixture.id.includes('crlf')) {
      const firstRecordEnd = fixture.input.indexOf(
        '\r\n',
        fixture.input.indexOf('\r\n') + 2,
      );
      assert.equal(firstRecordEnd, 1023);
      assert.equal(fixture.input.indexOf('\r\n', firstRecordEnd + 2), 2047);
      assert.ok(parsed.rows[0][4].endsWith('"quoted",tail'));
    }
  }
});

test('CSV comparison rejects missing, duplicate, mismatched and invalid samples', () => {
  const samples = Array.from({ length: 5 }, (_, pair) =>
    ['baseline', 'candidate'].map((variant) => ({
      pair,
      variant,
      totalCompletionMs: variant === 'baseline' ? 10 : 12,
      maxMainThreadGapMs: 4,
      outputSha256: 'a'.repeat(64),
    })),
  ).flat();
  assert.ok(
    Math.abs(summarizeCsvComparison(samples).changeRatio - 0.2) < 1e-12,
  );
  assert.equal(
    summarizeCsvComparison(
      samples.map((sample) => ({ ...sample, maxMainThreadGapMs: null })),
    ).candidateMedianTimerGapMs,
    null,
  );
  assert.throws(() => summarizeCsvComparison(samples.slice(1)));
  assert.throws(() =>
    summarizeCsvComparison(
      samples.map((sample, i) =>
        i === 0 ? { ...sample, variant: 'candidate' } : sample,
      ),
    ),
  );
  assert.throws(() =>
    summarizeCsvComparison(
      samples.map((sample, i) =>
        i === 0 ? { ...sample, outputSha256: 'b'.repeat(64) } : sample,
      ),
    ),
  );
  assert.throws(() =>
    summarizeCsvComparison(
      samples.map((sample, i) =>
        i === 0 ? { ...sample, totalCompletionMs: Number.NaN } : sample,
      ),
    ),
  );
});
