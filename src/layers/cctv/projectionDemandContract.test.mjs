import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./projection.js', import.meta.url), 'utf8');
const model = await readFile(new URL('./model.js', import.meta.url), 'utf8');

test('still projection demand contract keeps declared cadence and edge wakeups', () => {
  assert.match(source, /PROJECTION_ACTIVE_REFRESH_MS/);
  assert.match(source, /PROJECTION_IDLE_REFRESH_MS/);
  assert.match(source, /cctv-still-ready/);
  assert.match(source, /scheduleStillRetry/);
  assert.match(source, /runtime\.disposed/);
  assert.match(model, /runtime\.lastImageRefreshAt === 0/);
});

test('still projection disposal clears retry ownership', () => {
  assert.match(source, /if \(runtime\.retryTimer\) clearTimeout\(runtime\.retryTimer\)/);
  assert.match(source, /layerState\._projectionStillWakeTimer/);
});
