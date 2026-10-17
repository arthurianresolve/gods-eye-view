import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createLayerCapabilityRegistry } from '../time/index.js';
import { createWorkspaceStorage } from '../storage/index.js';
import { createAircraftRecordingService } from './aircraft.js';
import { createRecordedAircraftSource } from './replaySource.js';
import { createAircraftSourceRouter } from './sourceRouter.js';

test('router switches live and recorded feeds without a live fallthrough', async (t) => {
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = {
    ...base,
    get savedByBrowser() {
      return true;
    },
  };
  let now = 1000;
  const recording = createAircraftRecordingService({
    storage,
    now: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => {
    recording.destroy();
    base.destroy();
  });
  await recording.start({
    id: 'recording-router',
    region: { center: { lat: 0, lon: 0 }, radiusKm: 25 },
  });
  await recording.ingest({
    receivedAt: now,
    observations: [
      {
        id: 'SYNTH-ROUTER',
        observedAt: now,
        latitude: 0,
        longitude: 0,
        altitudeM: 1000,
      },
    ],
  });
  await recording.stop();
  let liveReads = 0;
  const router = createAircraftSourceRouter({
    live: {
      label: 'Live fixture',
      async getSnapshot() {
        liveReads++;
        return { records: [], source: 'Live fixture' };
      },
    },
    recorded: createRecordedAircraftSource({ storage }),
  });
  const capabilities = createLayerCapabilityRegistry();
  const detach = router.attachCapabilities(capabilities, {
    readLive: async () => ({ sampleTimeMs: now, recordCount: 0 }),
  });
  t.after(() => {
    detach();
    router.destroy();
    capabilities.destroy();
  });
  assert.equal((await router.getSnapshot()).source, 'Live fixture');
  assert.equal(liveReads, 1);
  assert.equal(capabilities.snapshot().layers[0].mode, 'live');
  assert.equal(
    (await router.selectRecording('recording-router')).status,
    'selected',
  );
  assert.equal(router.getState().mode, 'recorded');
  assert.equal(capabilities.snapshot().layers[0].mode, 'recorded');
  const replay = await router.getSnapshot();
  assert.match(replay.source, /recording-router/);
  assert.equal(replay.records[0].id, 'SYNTH-ROUTER');
  assert.equal(liveReads, 1, 'historical reads never fall through to live');
  router.returnLive();
  assert.equal(router.getState().mode, 'live');
  assert.equal(capabilities.snapshot().layers[0].mode, 'live');
  assert.equal((await router.getSnapshot()).source, 'Live fixture');
  assert.equal(liveReads, 2);
});

test('a live result that resolves after replay takes ownership is discarded', async (t) => {
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = {
    ...base,
    get savedByBrowser() {
      return true;
    },
  };
  const recording = createAircraftRecordingService({
    storage,
    now: () => 1000,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => {
    recording.destroy();
    base.destroy();
  });
  await recording.start({
    id: 'recording-router-stale-live',
    region: { center: { lat: 0, lon: 0 }, radiusKm: 25 },
  });
  await recording.ingest({
    receivedAt: 1000,
    observations: [
      { id: 'SYNTH-STALE', observedAt: 1000, latitude: 0, longitude: 0 },
    ],
  });
  await recording.stop();
  let releaseLive;
  const router = createAircraftSourceRouter({
    live: {
      getSnapshot: () => new Promise((resolve) => (releaseLive = resolve)),
    },
    recorded: createRecordedAircraftSource({ storage }),
  });
  t.after(() => router.destroy());
  const stale = router.getSnapshot();
  await router.selectRecording('recording-router-stale-live');
  releaseLive({ records: [{ id: 'LIVE-STALE' }], source: 'Live' });
  await assert.rejects(stale, { name: 'AbortError' });
});
