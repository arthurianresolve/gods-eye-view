import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineArbiter } from '../time/index.js';
import { createInvestigationTimelineController } from './investigationTimelineController.js';

function fakeClock() {
  const listeners = new Set();
  let state = { mode: 'live', timeMs: 0, rate: 1 };
  const emit = () => {
    for (const listener of [...listeners]) listener(state);
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    seek(timeMs) {
      state = {
        ...state,
        mode: state.mode === 'replay' ? 'replay' : 'paused',
        timeMs,
      };
      emit();
    },
    play(rate) {
      state = { ...state, mode: 'replay', rate };
      emit();
    },
    pause() {
      state = { ...state, mode: 'paused' };
      emit();
    },
    setRate(rate) {
      state = { ...state, rate };
      emit();
    },
    returnLive() {
      state = { ...state, mode: 'live', timeMs: null, rate: 1 };
      emit();
    },
    advance(timeMs) {
      state = { ...state, timeMs };
      emit();
    },
  };
}

function fixture({
  confirmHandoff = async () => false,
  includeVessel = false,
  bundleRecording = null,
} = {}) {
  const clock = fakeClock();
  const arbiter = createTimelineArbiter();
  const workspaces = [
    {
      id: 'recording-ui-test',
      kind: 'aircraft-recording',
      status: 'complete',
      title: 'Synthetic route',
      updatedAt: 3000,
    },
    {
      id: 'ordinary-workspace',
      kind: 'workspace',
      status: '',
      title: 'View',
    },
  ];
  if (includeVessel)
    workspaces.push({
      id: 'vessel-recording-ui-test',
      kind: 'vessel-recording',
      status: 'complete',
      title: 'Synthetic AIS route',
      updatedAt: 3000,
    });
  const storage = {
    async listWorkspaces() {
      return workspaces;
    },
    async getWorkspace(id) {
      return {
        manifest: { revision: 2 },
        document: { kind: 'aircraft-recording', id },
        chunks: {},
      };
    },
    async deleteWorkspace() {
      return true;
    },
    async commitWorkspace({ id, document }) {
      workspaces.push({
        id,
        kind: document.kind,
        status: document.status,
        title: document.title,
        updatedAt: Date.now(),
      });
      return { saved: true, revision: 1 };
    },
  };
  const source = {
    selected: null,
    target: null,
    async selectRecording(id) {
      this.selected = id;
      this.target = 1000;
      return { status: 'selected' };
    },
    getTimeline() {
      return {
        ticks: [1000, 2000, 3000],
        gaps: [{ startedAt: 2200, endedAt: 2800, reason: 'provider-silent' }],
        coverage: { from: 1000, to: 3000 },
      };
    },
    setTime(value) {
      this.target = value;
    },
    async getSnapshot() {
      const inGap = this.target >= 2200 && this.target <= 2800;
      return {
        records: inGap ? [] : [{ id: 'SYNTH-UI' }],
        observedAtMs: inGap ? null : this.target <= 2000 ? 1000 : 3000,
      };
    },
    returnLive() {
      this.selected = null;
      this.target = null;
    },
  };
  const vesselSource = includeVessel
    ? {
        target: null,
        async selectRecording(id) {
          this.selected = id;
          return { status: 'selected' };
        },
        getTimeline() {
          return {
            ticks: [1500, 2500],
            gaps: [],
            coverage: { from: 1500, to: 2500 },
          };
        },
        setTime(value) {
          this.target = value;
        },
        async getSnapshot() {
          return { records: [{ id: 'VESSEL-1' }], observedAtMs: this.target };
        },
        returnLive() {
          this.selected = null;
          this.target = null;
        },
      }
    : null;
  let refreshes = 0;
  const dataManager = {
    isEnabled: () => true,
    async refreshLayer(_id, { signal }) {
      if (signal?.aborted) return false;
      refreshes++;
      return true;
    },
  };
  const recordingService = {
    async exportRecording(id) {
      return bundleRecording
        ? {
            ...bundleRecording,
            document: { ...bundleRecording.document, id },
          }
        : { document: { id } };
    },
    async deleteRecording() {
      return true;
    },
  };
  const controller = createInvestigationTimelineController({
    storage,
    aircraftSource: source,
    vesselSource,
    investigationTime: clock,
    timelineArbiter: arbiter,
    dataManager,
    recordingService,
    vesselRecordingService: recordingService,
    confirmHandoff,
  });
  return {
    controller,
    clock,
    arbiter,
    source,
    vesselSource,
    getRefreshes: () => refreshes,
  };
}

test('timeline requires a handoff, exposes actual samples and shows coverage gaps', async (t) => {
  let allowHandoff = false;
  const fixtureState = fixture({
    confirmHandoff: async () => allowHandoff,
  });
  const { controller, clock, arbiter, source, getRefreshes } = fixtureState;
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await arbiter.claim('director');
  await controller.refreshRecordings();
  assert.equal(controller.getState().recordings.length, 1);
  assert.equal(
    (await controller.selectRecording('recording-ui-test')).status,
    'timeline-owned',
  );
  assert.equal(source.selected, null);
  allowHandoff = true;
  assert.equal(
    (await controller.selectRecording('recording-ui-test')).status,
    undefined,
  );
  assert.equal(controller.getState().mode, 'recorded');
  assert.equal(controller.getState().actualSampleTimeMs, 1000);
  assert.equal(controller.getState().gaps.length, 1);
  assert.equal(arbiter.getState().owner, 'investigation');

  await controller.seek(2500);
  assert.equal(controller.getState().requestedTimeMs, 2500);
  assert.equal(controller.getState().actualSampleTimeMs, null);
  assert.match(controller.getState().notice, /gap/);
  assert.ok(getRefreshes() >= 2);
  await controller.returnLive();
  assert.equal(controller.getState().mode, 'live');
  assert.equal(arbiter.getState().owner, null);
  assert.equal(clock.getState().mode, 'live');
});

test('timeline playback follows event ticks and export/delete target only the selected recording', async (t) => {
  const { controller, clock, arbiter } = fixture();
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await controller.refreshRecordings();
  await controller.selectRecording('recording-ui-test');
  assert.equal(controller.togglePlay(), true);
  clock.advance(2100);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().index, 1);
  assert.equal(controller.getState().requestedTimeMs, 2000);
  assert.deepEqual(await controller.exportSelected(), {
    document: { id: 'recording-ui-test' },
  });
  assert.equal(await controller.deleteSelected(), true);
  assert.equal(controller.getState().mode, 'live');
});

test('timeline exports a portable bundle and verifies it before importing a new recording', async (t) => {
  const { controller, arbiter, source } = fixture({
    bundleRecording: {
      format: 'gods-eye-view-aircraft-recording',
      schemaVersion: 1,
      document: {
        id: 'recording-ui-test',
        kind: 'aircraft-recording',
        schemaVersion: 1,
        title: 'Synthetic route',
        status: 'complete',
        sourcePolicy: {
          policyId: 'fixture-approved-v1',
          retentionAllowed: true,
          exportAllowed: true,
        },
      },
      chunks: { 'observations-000000': [] },
    },
  });
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await controller.refreshRecordings();
  await controller.selectRecording('recording-ui-test');
  const bundle = await controller.exportSelectedBundle();
  assert.equal(bundle.format, 'gods-eye-view-recording-bundle');
  assert.match(bundle.manifest.sha256, /^[a-f0-9]{64}$/);
  const text = await new Response(
    (await import('../recording/bundle.js')).recordingBundleStream(bundle),
  ).text();
  const imported = await controller.importBundle(text);
  assert.match(imported.id, /^imported-recording-/);
  assert.equal(controller.getState().recordingId, imported.id);
  assert.equal(source.selected, imported.id);
  assert.match(controller.getState().notice, /verified and imported/);
});

test('a stale recording load cannot replace a newer selection', async (t) => {
  const { controller, arbiter, source } = fixture();
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await controller.refreshRecordings();
  let finishSlowSelection;
  source.selectRecording = (id) =>
    id === 'slow'
      ? new Promise((resolve) => {
          finishSlowSelection = resolve;
        })
      : Promise.resolve({ status: 'selected' });

  const slow = controller.selectRecording('slow');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await controller.selectRecording('newer')).recordingId,
    'newer',
  );
  finishSlowSelection({ status: 'selected' });
  assert.deepEqual(await slow, { status: 'cancelled' });
  assert.equal(controller.getState().recordingId, 'newer');
});

test('returning live invalidates a recording load that has not finished', async (t) => {
  const { controller, arbiter, source } = fixture();
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await controller.refreshRecordings();
  let finishSelection;
  source.selectRecording = () =>
    new Promise((resolve) => {
      finishSelection = resolve;
    });

  const loading = controller.selectRecording('slow');
  await new Promise((resolve) => setImmediate(resolve));
  await controller.returnLive();
  finishSelection({ status: 'selected' });
  assert.deepEqual(await loading, { status: 'cancelled' });
  assert.equal(controller.getState().mode, 'live');
  assert.equal(arbiter.getState().owner, null);
});

test('aircraft and vessel recordings seek to one shared investigation instant', async (t) => {
  const { controller, arbiter, source, vesselSource } = fixture({
    includeVessel: true,
  });
  t.after(() => {
    controller.destroy();
    arbiter.destroy();
  });
  await controller.refreshRecordings();
  await controller.selectRecording('recording-ui-test');
  await controller.selectRecording('vessel-recording-ui-test');
  assert.equal(controller.getState().aircraftRecordingId, 'recording-ui-test');
  assert.equal(
    controller.getState().vesselRecordingId,
    'vessel-recording-ui-test',
  );
  await controller.seek(2500);
  assert.equal(source.target, 2500);
  assert.equal(vesselSource.target, 2500);
  assert.equal(controller.getState().vesselSampleTimeMs, 2500);
  assert.equal(controller.getState().requestedTimeMs, 2500);
});
