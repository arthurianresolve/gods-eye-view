import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { beginCpuTiming, endCpuTiming, getCpuTimings, setCpuTimingsEnabled } from './cpuTimings.js';

afterEach(() => setCpuTimingsEnabled(false));

test('disabled CPU instrumentation reads no clock and reports unavailable', () => {
  setCpuTimingsEnabled(false, { now: () => assert.fail('disabled clock read') });
  assert.equal(beginCpuTiming('cctv', 'geometry-prepare'), null);
  endCpuTiming(null);
  assert.equal(getCpuTimings(), null);
});

test('CPU series retain only bounded recent samples and numeric summaries', () => {
  let clock = 0;
  setCpuTimingsEnabled(true, { now: () => clock });
  for (let i = 0; i < 1000; i++) {
    const span = beginCpuTiming('cctv', 'geometry-prepare');
    clock += 3;
    endCpuTiming(span);
  }
  assert.deepEqual(getCpuTimings().series, [{
    owner: 'cctv', phase: 'geometry-prepare', count: 1000, totalMs: 3000,
    maxMs: 3, sampleCount: 120, p50Ms: 3, p95Ms: 3,
  }]);
  assert.equal(beginCpuTiming('https://secret.example', 'geometry'), null);
});

test('series overflow is explicit and disabling invalidates in-progress spans', () => {
  let clock = 0;
  setCpuTimingsEnabled(true, { now: () => clock++ });
  for (let i = 0; i < 130; i++) endCpuTiming(beginCpuTiming(`layer-${i}`, 'update-sync'));
  assert.equal(getCpuTimings().series.length, 128);
  assert.equal(getCpuTimings().overflow, true);
  const stale = beginCpuTiming('layer-0', 'update-sync');
  setCpuTimingsEnabled(false);
  setCpuTimingsEnabled(true, { now: () => clock++ });
  endCpuTiming(stale);
  assert.deepEqual(getCpuTimings().series, []);
});
