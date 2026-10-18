import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createModel } from './model.js';
import { PROJECTION_ACTIVE_REFRESH_MS } from './policy.js';

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

test('the real CCTV model gates settled stills by active cadence and wakes cold failures', () => {
  const record = {
    camera: { id: 'camera-one' },
    projection: {
      video: null,
      imageLoading: false,
      imageReady: true,
      lastImageRefreshAt: 1_000,
    },
  };
  const state = {
    _enabled: true,
    _viewer: {},
    _showProjection: true,
    _activeCameraId: record.camera.id,
  };
  const parts = { selection: { getActiveRecord: () => record } };
  const model = createModel({
    state,
    parts,
    services: { focus: { focusPassIsNeeded: () => false, getFocusTarget: () => null } },
    source: {},
  });
  const previousNow = Date.now;
  try {
    Date.now = () => 1_000 + PROJECTION_ACTIVE_REFRESH_MS - 1;
    assert.equal(model.projectionLoopIsNeeded(), false, 'settled stills sleep before cadence');
    Date.now = () => 1_000 + PROJECTION_ACTIVE_REFRESH_MS;
    assert.equal(model.projectionLoopIsNeeded(), true, 'active cadence wakes a refresh');
    record.projection.imageReady = false;
    record.projection.lastImageRefreshAt = 0;
    assert.equal(model.projectionLoopIsNeeded(), true, 'decode failure remains retryable');
  } finally {
    Date.now = previousNow;
  }
});
