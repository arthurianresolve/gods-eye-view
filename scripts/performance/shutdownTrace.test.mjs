import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeShutdownTrace } from './shutdownTrace.mjs';

test('shutdown trace keeps nested wall intervals separate and omits arguments', () => {
  const common = { cat: 'shutdown', pid: 10, tid: 20 };
  const report = summarizeShutdownTrace({
    traceEvents: [
      {
        ...common,
        ph: 'B',
        ts: 1000,
        name: 'parent',
        args: { profilePath: 'secret' },
      },
      { ...common, ph: 'X', ts: 2000, dur: 5000, name: 'child' },
      { ...common, ph: 'E', ts: 9000 },
      {
        ...common,
        ph: 'X',
        cat: 'network',
        ts: 1000,
        dur: 999999,
        args: { url: 'secret' },
      },
      { ...common, ph: 'B', ts: 10000, name: 'not-flushed' },
      { ...common, tid: 30, ph: 'E', ts: 11000 },
    ],
  });
  assert.equal(report.status, 'observed');
  assert.equal(report.completedSpanCount, 2);
  assert.deepEqual(
    report.longestSpans.map((s) => [s.name, s.durationMs]),
    [
      ['parent', 8],
      ['child', 5],
    ],
  );
  assert.equal(report.openSpans, 1);
  assert.equal(report.unmatchedEnds, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret|profilePath/);
});

test('missing shutdown events remain unavailable and malformed events fail closed', () => {
  assert.equal(
    summarizeShutdownTrace({ traceEvents: [] }).status,
    'unavailable',
  );
  for (const trace of [
    null,
    { traceEvents: {} },
    { traceEvents: Array(100001) },
    {
      traceEvents: [
        { cat: 'shutdown', ph: 'X', ts: 0, pid: 1, tid: 2, dur: -1 },
      ],
    },
    {
      traceEvents: [
        { cat: 'shutdown', ph: 'X', ts: NaN, pid: 1, tid: 2, dur: 1 },
      ],
    },
  ])
    assert.throws(() => summarizeShutdownTrace(trace), /trace/i);
});
