import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWorkspaceStorage } from '../storage/index.js';
import { createLayerCapabilityRegistry } from '../time/index.js';
import {
  createRecordedVesselSource,
  createVesselRecordingService,
  createVesselSourceRouter,
} from './index.js';

function fixture({ now = 0, ...options } = {}) {
  let time = now;
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = { ...base };
  Object.defineProperty(storage, 'savedByBrowser', { get: () => true });
  const service = createVesselRecordingService({
    storage,
    now: () => time,
    setInterval: () => 1,
    clearInterval: () => {},
    ...options,
  });
  return {
    service,
    storage: base,
    setTime(value) {
      time = value;
    },
  };
}

const region = { center: { latitude: 0, longitude: 179.8 }, radiusKm: 25 };
const vessel = (overrides = {}) => ({
  id: '123456789',
  latitude: 0.01,
  longitude: 179.9,
  observedAtMs: 0,
  speedMps: 2,
  courseDeg: 90,
  headingDeg: 89,
  name: 'Harbor Star',
  imo: 'IMO-1',
  type: 'cargo',
  destination: 'Port Alpha',
  ...overrides,
});

test('vessel retention rejects AIS sources without explicit archive permission', async (t) => {
  const { service, storage } = fixture();
  t.after(() => storage.destroy());
  await assert.rejects(
    service.start({
      id: 'vessel-recording-live',
      sourceId: 'aisstream',
      region,
    }),
    { code: 'retention-not-approved' },
  );
  service.destroy();
});

test('vessel recording subscribers receive bounded state changes without getState side effects', async (t) => {
  const { service, storage } = fixture();
  t.after(() => storage.destroy());
  const states = [];
  const unsubscribe = service.subscribe((state) => states.push(state));
  assert.equal(states[0], null);
  await service.start({ id: 'vessel-recording-subscribed', region });
  assert.equal(service.getState().status, 'active');
  assert.equal(states.length, 2);
  await service.ingest({ observations: [vessel()], receivedAt: 100 });
  assert.equal(states.at(-1).positionCount, 1);
  await service.noteSourceUnavailable('fixture-gap');
  assert.equal(states.at(-1).gapCount, 1);
  await service.stop('qa-complete');
  assert.equal(states.at(-1).status, 'complete');
  unsubscribe();
  service.destroy();
});

test('vessel capture is not visible to ingestion until its initial durable revision commits', async (t) => {
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = { ...base };
  Object.defineProperty(storage, 'savedByBrowser', { get: () => true });
  const commitWorkspace = storage.commitWorkspace.bind(storage);
  let releaseCommit;
  let signalCommitStarted;
  const commitStarted = new Promise((resolve) => {
    signalCommitStarted = resolve;
  });
  const commitGate = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  storage.commitWorkspace = async (value) => {
    signalCommitStarted();
    await commitGate;
    return commitWorkspace(value);
  };
  const service = createVesselRecordingService({
    storage,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => base.destroy());

  const start = service.start({ id: 'vessel-recording-start-race', region });
  await commitStarted;
  assert.equal(service.getState(), null);
  await assert.rejects(service.ingest({ observations: [vessel()] }), {
    code: 'no-active-recording',
  });
  await assert.rejects(
    service.start({ id: 'vessel-recording-start-race-2', region }),
    { code: 'recording-active' },
  );
  releaseCommit();
  await start;
  const captured = await service.ingest({ observations: [vessel()] });
  assert.equal(captured.accepted, 1);
  assert.equal(captured.positionCount, 1);
  service.destroy();
});

test('vessel recording stops at its logical duration limit', async (t) => {
  const { service, storage, setTime } = fixture({ maxDurationMs: 60_000 });
  t.after(() => storage.destroy());
  await service.start({ id: 'vessel-recording-duration', region });
  setTime(60_000);
  const state = await service.check();
  assert.equal(state.status, 'complete');
  assert.equal(state.stopReason, 'duration-limit');
  service.destroy();
});

test('vessel recording deduplicates positions and time-stamps metadata at receipt', async (t) => {
  const { service, storage, setTime } = fixture();
  t.after(() => storage.destroy());
  await service.start({ id: 'vessel-recording-synthetic', region });
  await service.ingest({ observations: [vessel()], receivedAt: 100 });
  const duplicate = await service.ingest({
    observations: [vessel()],
    receivedAt: 500,
  });
  assert.equal(duplicate.accepted, 0);
  setTime(1000);
  await service.ingest({
    observations: [
      vessel({
        observedAtMs: 60_000,
        longitude: -179.99,
        name: 'Harbor Star II',
      }),
    ],
    receivedAt: 1000,
  });
  setTime(2000);
  await service.ingest({
    observations: [
      vessel({
        observedAtMs: 60_000,
        longitude: -179.98,
        name: 'Harbor Star II',
      }),
    ],
    receivedAt: 2000,
  });
  const exported = await service.exportRecording('vessel-recording-synthetic');
  assert.equal(
    exported.document.sourcePolicy.policyId,
    'synthetic-vessel-fixture-v1',
  );
  assert.equal(exported.chunks.positions.length, 3);
  assert.equal(
    exported.chunks.positions.filter((row) => row.correctionOf).length,
    1,
  );
  assert.deepEqual(
    exported.chunks.metadata.map((event) => [event.changedAt, event.timeBasis]),
    [
      [100, 'received-at'],
      [1000, 'received-at'],
    ],
  );
  await service.stop();
  service.destroy();
});

test('vessel replay keeps sparse AIS gaps and sea-surface datum explicit', async (t) => {
  const { service, storage, setTime } = fixture();
  t.after(() => storage.destroy());
  await service.start({ id: 'vessel-recording-replay', region });
  await service.ingest({ observations: [vessel()], receivedAt: 0 });
  await service.noteSourceUnavailable('coastal-provider-outage');
  setTime(60_000);
  await service.ingest({
    observations: [vessel({ observedAtMs: 60_000, longitude: -179.99 })],
    receivedAt: 60_000,
  });
  setTime(180_000);
  await service.stop();

  const source = createRecordedVesselSource({
    storage,
    maxSampleAgeMs: 30_000,
  });
  assert.equal(
    (await source.selectRecording('vessel-recording-replay')).status,
    'selected',
  );
  const timeline = source.getTimeline();
  assert.ok(
    timeline.gaps.some((gap) => gap.reason === 'coastal-provider-outage'),
  );
  source.setTime(60_000);
  const selected = await source.getSnapshot();
  assert.equal(selected.records.length, 1);
  assert.equal(selected.records[0].altitudeDatum, 'sea-surface');
  assert.equal(selected.records[0].observedAtMs, 60_000);
  assert.equal(selected.records[0].name, 'Harbor Star');
  source.setTime(180_000);
  assert.equal((await source.getSnapshot()).records.length, 0);
  source.setTime(60_000);
  const track = await source.getTrack('123456789');
  assert.equal(
    track.records.length,
    1,
    'the trail stops at the outage boundary',
  );
  source.clear();
  service.destroy();
});

test('vessel router discards live responses after replay owns the source', async (t) => {
  const { service, storage, setTime } = fixture();
  t.after(() => storage.destroy());
  await service.start({ id: 'vessel-recording-router', region });
  await service.ingest({ observations: [vessel()], receivedAt: 0 });
  setTime(1000);
  await service.stop();
  let resolveLive;
  const live = {
    label: 'Live AIS',
    getSnapshot: () => new Promise((resolve) => (resolveLive = resolve)),
    async getTrack() {
      return { records: [] };
    },
  };
  const router = createVesselSourceRouter({
    live,
    recorded: createRecordedVesselSource({ storage }),
  });
  const registry = createLayerCapabilityRegistry();
  const detach = router.attachCapabilities(registry, {
    readLive: async () => ({ sampleTimeMs: 0, recordCount: 1 }),
  });
  const pending = router.getSnapshot();
  await router.selectRecording('vessel-recording-router');
  resolveLive({ records: [{ id: 'LIVE' }] });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(registry.snapshot().layers[0].mode, 'recorded');
  assert.equal((await router.getSnapshot()).records[0].id, '123456789');
  router.returnLive();
  assert.equal(registry.snapshot().layers[0].mode, 'live');
  detach();
  router.destroy();
  registry.destroy();
  service.destroy();
});
