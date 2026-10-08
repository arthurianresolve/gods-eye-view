import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWorkspaceStorage } from '../storage/index.js';
import { createLayerCapabilityRegistry } from '../time/index.js';
import {
  createAircraftRecordingService,
  createRecordedAircraftSource,
  createSyntheticAircraftFrames,
  isWithinRecordingRegion,
  validateRecordingRegion,
} from './index.js';

function fixture({ now = 0, ...options } = {}) {
  let time = now;
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = { ...base };
  Object.defineProperty(storage, 'savedByBrowser', { get: () => true });
  const service = createAircraftRecordingService({
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

test('recording regions enforce the radius ceiling and handle the antimeridian', () => {
  const region = validateRecordingRegion({
    center: { latitude: 0, longitude: 179.9 },
    radiusKm: 25,
  });
  assert.equal(
    isWithinRecordingRegion(region, { latitude: 0, longitude: -179.9 }),
    true,
  );
  assert.equal(
    isWithinRecordingRegion(region, { latitude: 0, longitude: 179.4 }),
    false,
  );
  assert.throws(
    () =>
      validateRecordingRegion({ center: { lat: 0, lon: 0 }, radiusKm: 251 }),
    /Radius/,
  );
  assert.throws(
    () => validateRecordingRegion({ center: { lat: 0, lon: 0 }, radiusKm: 0 }),
    /Radius/,
  );
});

test('only retention-approved sources record; live provider archives stay disabled', async (t) => {
  const { service, storage } = fixture();
  t.after(() => storage.destroy());
  await assert.rejects(
    service.start({
      id: 'recording-live-source',
      sourceId: 'opensky',
      region: { center: { lat: 0, lon: 0 }, radiusKm: 1 },
    }),
    { code: 'retention-not-approved' },
  );
  await assert.rejects(
    service.start({
      id: 'recording-too-wide',
      region: { center: { lat: 0, lon: 0 }, radiusKm: 300 },
    }),
    /Radius/,
  );
  assert.equal(service.getState(), null);
  service.destroy();
});

test('synthetic recording deduplicates, preserves corrections and marks provider gaps', async (t) => {
  const { service, storage, setTime } = fixture({ silenceMs: 30_000 });
  t.after(() => storage.destroy());
  await service.start({
    id: 'recording-synthetic-evidence',
    region: { center: { lat: 0, lon: 179.7 }, radiusKm: 25 },
  });
  const frames = createSyntheticAircraftFrames({ sampleCount: 4 });
  let result = await service.ingest(frames[0]);
  assert.equal(result.accepted, 1);
  setTime(60_000);
  result = await service.ingest(frames[1]);
  assert.equal(result.duplicates, 1);
  setTime(120_000);
  result = await service.ingest(frames[2]);
  assert.equal(result.accepted, 2);
  setTime(180_000);
  result = await service.ingest(frames[3]);
  assert.equal(result.outsideRegion, 1);
  const saved = await service.exportRecording('recording-synthetic-evidence');
  const rows = Object.entries(saved.chunks)
    .filter(([name]) => name.startsWith('observations-'))
    .flatMap(([, chunk]) => chunk);
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((row) => row.correctionOf).length, 1);
  assert.ok(saved.chunks.gaps.length >= 1);
  assert.equal(saved.document.sourcePolicy.policyId, 'synthetic-fixture-v1');
  await service.stop();
  service.destroy();
});

test('recordings stop at 60 logical minutes with an explicit limit reason', async (t) => {
  const { service, storage, setTime } = fixture();
  t.after(() => storage.destroy());
  await service.start({
    id: 'recording-sixty-minutes',
    region: { center: { lat: 0, lon: 179.7 }, radiusKm: 25 },
  });
  const frames = createSyntheticAircraftFrames();
  for (let index = 0; index < 60; index++) {
    setTime(index * 60_000);
    await service.ingest(frames[index]);
  }
  setTime(60 * 60_000);
  const ended = await service.check();
  assert.equal(ended.status, 'complete');
  assert.equal(ended.stopReason, 'duration-limit');
  assert.equal(ended.endedAt, 60 * 60_000);
  const saved = await service.exportRecording('recording-sixty-minutes');
  assert.equal(saved.document.status, 'complete');
  assert.equal(saved.document.stopReason, 'duration-limit');
  service.destroy();
});

test('recording byte ceiling stops cleanly before storing the over-limit report', async (t) => {
  const { service, storage, setTime } = fixture({ maxRecordingBytes: 1800 });
  t.after(() => storage.destroy());
  await service.start({
    id: 'recording-byte-ceiling',
    region: { center: { lat: 0, lon: 179.7 }, radiusKm: 25 },
  });
  const frames = createSyntheticAircraftFrames({ sampleCount: 20 });
  let state;
  for (let index = 0; index < frames.length; index++) {
    setTime(index * 1000);
    state = await service.ingest(frames[index]);
    if (state.status !== 'active') break;
  }
  assert.equal(state.status, 'complete');
  assert.equal(state.stopReason, 'recording-byte-limit');
  const saved = await service.exportRecording('recording-byte-ceiling');
  assert.ok(saved.document.bytes <= 1800);
  assert.equal(saved.document.stopReason, 'recording-byte-limit');
  service.destroy();
});

test('memory-only storage refuses to start an unsaved recording', async (t) => {
  const storage = createWorkspaceStorage({
    indexedDB: null,
    crypto: webcrypto,
  });
  const service = createAircraftRecordingService({
    storage,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => storage.destroy());
  await assert.rejects(
    service.start({
      id: 'recording-unsaved',
      region: { center: { lat: 0, lon: 0 }, radiusKm: 1 },
    }),
    { code: 'storage-not-persistent' },
  );
  service.destroy();
});

test('a failed durable append keeps the last committed revision and reports interruption', async (t) => {
  const base = createWorkspaceStorage({ indexedDB: null, crypto: webcrypto });
  const storage = {
    ...base,
    async commitWorkspace(request) {
      if (request.expectedRevision > 0)
        throw Object.assign(new Error('Simulated browser quota exhaustion'), {
          code: 'quota',
        });
      return base.commitWorkspace(request);
    },
  };
  Object.defineProperty(storage, 'savedByBrowser', { get: () => true });
  const service = createAircraftRecordingService({
    storage,
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  t.after(() => base.destroy());
  await service.start({
    id: 'recording-quota-failure',
    region: { center: { lat: 0, lon: 0 }, radiusKm: 10 },
  });
  const state = await service.ingest({
    receivedAt: 1000,
    observations: [
      {
        id: 'SYNTH-QUOTA',
        observedAt: 1000,
        latitude: 0,
        longitude: 0,
        altitudeM: 1000,
      },
    ],
  });
  assert.equal(state.status, 'interrupted');
  assert.equal(state.stopReason, 'quota');
  assert.equal(state.persistenceError, 'quota');
  const lastGood = await base.getWorkspace('recording-quota-failure');
  assert.equal(lastGood.manifest.revision, 1);
  assert.deepEqual(lastGood.chunks, { gaps: [] });
  service.destroy();
});

test('an active persisted session becomes an explicit interrupted interval after reload', async (t) => {
  const { service: first, storage, setTime } = fixture();
  t.after(() => storage.destroy());
  await first.start({
    id: 'recording-recover-interrupted',
    region: { center: { lat: 0, lon: 0 }, radiusKm: 10 },
  });
  await first.ingest({
    receivedAt: 1000,
    observations: [
      {
        id: 'SYNTH-RECOVER',
        observedAt: 1000,
        latitude: 0,
        longitude: 0,
      },
    ],
  });
  first.destroy();
  setTime(5000);
  const second = createAircraftRecordingService({
    storage: {
      ...storage,
      get savedByBrowser() {
        return true;
      },
    },
    now: () => 5000,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const recovered = await second.recoverInterrupted();
  assert.deepEqual(recovered, [
    { id: 'recording-recover-interrupted', revision: 3 },
  ]);
  const exported = await second.exportRecording(
    'recording-recover-interrupted',
  );
  assert.equal(exported.document.status, 'interrupted');
  assert.equal(exported.document.endedAt, 5000);
  assert.equal(
    exported.chunks.gaps.at(-1).reason,
    'page-lifecycle-interrupted',
  );
  second.destroy();
});

test('recorded aircraft source selects actual prior observations and never falls forward', async (t) => {
  const { service, storage, setTime } = fixture({ silenceMs: 60_000 });
  t.after(() => storage.destroy());
  await service.start({
    id: 'recording-replay-source',
    region: { center: { lat: 1.5, lon: 1.5 }, radiusKm: 100 },
  });
  await service.ingest({
    receivedAt: 1000,
    observations: [
      {
        id: 'SYNTH-REPLAY',
        observedAt: 1000,
        latitude: 1,
        longitude: 1,
        altitudeM: 5000,
      },
    ],
  });
  setTime(5000);
  await service.ingest({
    receivedAt: 5000,
    observations: [
      {
        id: 'SYNTH-REPLAY',
        observedAt: 5000,
        latitude: 2,
        longitude: 2,
        altitudeM: 6000,
      },
    ],
  });
  await service.stop();
  const replay = createRecordedAircraftSource({
    storage,
    maxSampleAgeMs: 10_000,
  });
  assert.equal(
    (await replay.selectRecording('recording-replay-source')).status,
    'selected',
  );
  replay.setTime(3000);
  const historical = await replay.getSnapshot();
  assert.equal(historical.records.length, 1);
  assert.equal(historical.records[0].positionTimeMs, 1000);
  assert.equal(historical.records[0].latitude, 1);
  assert.equal(historical.observedAtMs, 1000);
  const capabilities = createLayerCapabilityRegistry();
  const registration = replay.attachCapabilities(capabilities);
  const available = await capabilities.resolveAt('flights', 3000);
  assert.equal(available.status, 'available');
  assert.equal(available.sampleTimeMs, 1000);
  assert.equal(available.selectedTimeMs, 3000);
  assert.equal(
    (await capabilities.resolveAt('flights', 6000)).status,
    'no-coverage',
  );
  registration.remove();
  capabilities.destroy();
  replay.setTime(6000);
  const afterCoverage = await replay.getSnapshot();
  assert.deepEqual(afterCoverage.records, []);
  assert.equal(afterCoverage.observedAtMs, null);
  service.destroy();
});
