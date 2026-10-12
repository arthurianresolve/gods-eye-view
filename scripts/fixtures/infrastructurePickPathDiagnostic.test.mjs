import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INFRASTRUCTURE_PICK_PATH_CONTROLS,
  INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
  INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT,
  INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME,
  INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE,
  INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA,
  runInfrastructurePickPathControls,
  processOwnedCapturedFrame,
  pickPathDiagnosticRequested,
  infrastructurePickPathDiagnosticOptionEnabled,
  validateInfrastructurePickPathEnvelope,
} from './infrastructurePickPathDiagnostic.mjs';

const screen = { x: 120, y: 200 };
const stemScreen = { x: 120, y: 230 };
const signature = `${'a'.repeat(64)}:${'b'.repeat(64)}`;
const entity = (id) => ({ id });

test('witness-read failure remains diagnostic-only and releases the copied frame', async () => {
  const events = [];
  const canvas = { released: false };
  const result = await processOwnedCapturedFrame({
    async capture() {
      events.push('capture');
      return canvas;
    },
    readFrameState() {
      events.push('witness');
      throw Object.assign(new Error('private'), { name: 'DeveloperError' });
    },
    async process(actualCanvas, witness) {
      events.push('process');
      assert.equal(actualCanvas, canvas);
      assert.deepEqual(witness, {
        completedFrameState: null,
        completedFrameStateErrorName: 'DeveloperError',
      });
      return 'capture-still-completed';
    },
    release(actualCanvas) {
      events.push('release');
      actualCanvas.released = true;
    },
  });
  assert.equal(result, 'capture-still-completed');
  assert.equal(canvas.released, true);
  assert.deepEqual(events, ['capture', 'witness', 'process', 'release']);
});

test('cancellation after capture handoff still releases the acquired canvas', async () => {
  const controller = new AbortController();
  const canvas = { released: false };
  await assert.rejects(
    processOwnedCapturedFrame({
      async capture() {
        controller.abort();
        return canvas;
      },
      process() {
        assert.equal(controller.signal.aborted, true);
        throw new Error('diagnostic cancelled after capture');
      },
      release(actualCanvas) {
        actualCanvas.released = true;
      },
    }),
    /diagnostic cancelled after capture/,
  );
  assert.equal(canvas.released, true);
});

test('a primary frame-processing error survives a later cleanup error', async () => {
  const primary = new Error('frame processing failed');
  await assert.rejects(
    processOwnedCapturedFrame({
      capture: async () => ({}),
      process: () => {
        throw primary;
      },
      release: () => {
        throw new Error('cleanup failed');
      },
    }),
    (error) => error === primary,
  );
});

function run(overrides = {}) {
  const selection = { value: entity('prior') };
  const calls = [];
  const budget = overrides.budget || { calls: 0, limit: 20 };
  const frameState = overrides.initialFrameState || {
    completedRenderRevision: 42,
    cameraPosition: [1, 2, 3],
    renderClockIso: '2026-10-12T10:00:00.000Z',
  };
  const record = runInfrastructurePickPathControls({
    pick(kind, position) {
      calls.push({
        type: 'pick',
        kind,
        position,
        selected: selection.value?.id,
      });
      return {
        id: kind === 'point' ? entity('point-owner') : entity('stem-owner'),
      };
    },
    resolve(picked, kind) {
      return {
        ownerVerified: true,
        entityId: picked.id.id,
        sourceRecordId: `${picked.id.id}-source`,
        primitiveType: kind === 'point' ? 'PointPrimitive' : 'Primitive',
        appearanceType: kind === 'stem' ? 'PolylineColorAppearance' : null,
        selectionValue: picked.id,
      };
    },
    getSelection: () => selection.value,
    setSelection(value) {
      calls.push({ type: 'selection', id: value?.id || null });
      selection.value = value;
    },
    candidateEntityId: 'candidate-1',
    pointScreen: screen,
    stemScreen,
    completedRenderRevision: 42,
    renderSignature: signature,
    phase: 'initial-stable-render',
    budget,
    captureFrameState: overrides.captureFrameState || frameState,
    readFrameState: () => {
      if (overrides.readFrameState) return overrides.readFrameState();
      return frameState;
    },
    ...overrides,
  });
  return { record, calls, selection, budget };
}

test('controls compare the prescribed pick orders on one completed render and restore selection', () => {
  const { record, calls, selection, budget } = run();
  assert.equal(record.status, 'completed');
  assert.equal(record.completedRenderRevision, 42);
  assert.equal(record.phase, 'initial-stable-render');
  assert.equal(record.initialSelectionId, 'prior');
  assert.deepEqual(
    record.controls.map((control) => control.name),
    INFRASTRUCTURE_PICK_PATH_CONTROLS,
  );
  assert.deepEqual(
    calls.filter((call) => call.type === 'pick').map((call) => call.kind),
    ['point', 'stem', 'point', 'stem', 'stem'],
  );
  const selectionCalls = calls.filter((call) => call.type === 'selection');
  assert.deepEqual(
    selectionCalls.map((call) => call.id),
    ['prior', 'point-owner', 'prior', 'prior'],
  );
  assert.equal(selection.value.id, 'prior');
  assert.equal(record.selectionRestoredBetweenControls, true);
  assert.equal(record.selectionRestoredAfter, true);
  assert.equal(record.pickCalls, 5);
  assert.equal(budget.calls, 5);
  assert.ok(
    record.controls
      .flatMap((control) => control.picks)
      .every((pick) => !Object.hasOwn(pick, 'selectionValue')),
  );
});

test('a bounded budget rejects a partial control set without making a pick', () => {
  const { record, calls, budget } = run({
    budget: { calls: 16, limit: 20 },
  });
  assert.equal(record.status, 'budget-exhausted');
  assert.equal(record.pickCalls, 0);
  assert.deepEqual(record.controls, []);
  assert.equal(budget.calls, 16);
  assert.deepEqual(calls, []);
  assert.ok(INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME <= 20);
});

test('render revision change between capture and controls records a mismatch without picking', () => {
  const captureFrameState = {
    completedRenderRevision: 42,
    cameraPosition: [1, 2, 3],
    renderClockIso: '2026-10-12T10:00:00.000Z',
  };
  const { record, calls } = run({
    captureFrameState,
    readFrameState: () => ({
      ...captureFrameState,
      completedRenderRevision: 43,
    }),
  });
  assert.equal(record.status, 'frame-changed-before-controls');
  assert.equal(record.captureFrameState.completedRenderRevision, 42);
  assert.equal(record.controlStartFrameState.completedRenderRevision, 43);
  assert.equal(record.pickCalls, 0);
  assert.deepEqual(calls, []);
});

test('a render completed during synchronous controls is recorded as a different frame', () => {
  let revision = 42;
  let picks = 0;
  const { record } = run({
    pick(kind, position) {
      picks++;
      if (picks === 3) revision++;
      return { id: entity(kind === 'point' ? 'point-owner' : 'stem-owner') };
    },
    readFrameState: () => ({
      completedRenderRevision: revision,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    }),
  });
  assert.equal(record.status, 'frame-changed-during-controls');
  assert.equal(record.controlStartFrameState.completedRenderRevision, 42);
  assert.equal(record.controlEndFrameState.completedRenderRevision, 43);
  assert.equal(record.frameStableDuringControls, false);
});

test('ignored selectedEntity assignment fails the selection control and restores prior selection', () => {
  const selection = { value: entity('prior') };
  const controls = [];
  const record = runInfrastructurePickPathControls({
    pick(kind) {
      controls.push(kind);
      return { id: entity(kind === 'point' ? 'point-owner' : 'stem-owner') };
    },
    resolve(picked) {
      return {
        ownerVerified: true,
        entityId: picked.id.id,
        sourceRecordId: 'source-1',
        selectionValue: picked.id,
      };
    },
    getSelection: () => selection.value,
    setSelection(value) {
      if (value?.id !== 'point-owner') selection.value = value;
    },
    candidateEntityId: 'candidate-1',
    pointScreen: screen,
    stemScreen,
    completedRenderRevision: 42,
    renderSignature: signature,
    phase: 'initial-stable-render',
    budget: { calls: 0, limit: 5 },
    captureFrameState: {
      completedRenderRevision: 42,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    },
    readFrameState: () => ({
      completedRenderRevision: 42,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    }),
  });
  assert.equal(record.status, 'control-error');
  assert.equal(record.controls[1].status, 'error');
  assert.equal(record.controls[1].errorName, 'DeveloperError');
  assert.equal(record.selectionRestoredAfter, true);
  assert.equal(selection.value.id, 'prior');
  assert.deepEqual(controls, ['point', 'stem', 'point', 'stem']);
});

test('pick errors are recorded, subsequent controls remain bounded, and selection is restored', () => {
  const calls = [];
  const selection = { value: entity('prior') };
  const record = runInfrastructurePickPathControls({
    pick(kind) {
      calls.push(kind);
      if (kind === 'stem')
        throw Object.assign(new Error('private detail'), { name: 'PickError' });
      return { id: entity('point-owner') };
    },
    resolve(picked) {
      return {
        ownerVerified: true,
        entityId: picked.id.id,
        sourceRecordId: 'source-1',
        primitiveType: 'PointPrimitive',
        selectionValue: picked.id,
      };
    },
    getSelection: () => selection.value,
    setSelection: (value) => {
      selection.value = value;
    },
    candidateEntityId: 'candidate-1',
    pointScreen: screen,
    stemScreen,
    completedRenderRevision: 43,
    renderSignature: signature,
    phase: 'subsequent-completed-render',
    budget: { calls: 0, limit: 5 },
    captureFrameState: {
      completedRenderRevision: 43,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    },
    readFrameState: () => ({
      completedRenderRevision: 43,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    }),
  });
  assert.equal(record.status, 'control-error');
  assert.equal(record.controls[0].status, 'error');
  assert.equal(record.controls[0].errorName, 'PickError');
  assert.equal(Object.hasOwn(record.controls[0], 'errorMessage'), false);
  assert.deepEqual(calls, ['point', 'stem', 'point', 'stem', 'stem']);
  assert.equal(record.pickCalls, 5);
  assert.equal(record.selectionRestoredAfter, true);
  assert.equal(selection.value.id, 'prior');
});

test('selection restoration failure is explicit and does not escape into acceptance flow', () => {
  const selection = { value: entity('prior') };
  let setCalls = 0;
  const record = runInfrastructurePickPathControls({
    pick: () => ({ id: entity('point-owner') }),
    resolve: (picked) => ({
      ownerVerified: true,
      entityId: picked.id.id,
      sourceRecordId: 'source-1',
      selectionValue: picked.id,
    }),
    getSelection: () => selection.value,
    setSelection(value) {
      setCalls++;
      if (setCalls === 3) throw new Error('restore failed');
      selection.value = value;
    },
    candidateEntityId: 'candidate-1',
    pointScreen: screen,
    stemScreen,
    completedRenderRevision: 44,
    renderSignature: signature,
    phase: 'initial-stable-render',
    budget: { calls: 0, limit: 5 },
    captureFrameState: {
      completedRenderRevision: 44,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    },
    readFrameState: () => ({
      completedRenderRevision: 44,
      cameraPosition: [1, 2, 3],
      renderClockIso: '2026-10-12T10:00:00.000Z',
    }),
  });
  assert.equal(record.status, 'selection-restore-error');
  assert.equal(record.selectionRestoredBetweenControls, false);
  assert.equal(record.selectionRestoredAfter, true);
  assert.equal(
    record.controls.length,
    INFRASTRUCTURE_PICK_PATH_CONTROLS.length,
  );
  assert.equal(record.pickCalls, 4);
});

test('diagnostic opt-in is inert unless the explicit query value is present', () => {
  let reads = 0;
  const params = {
    get(name) {
      reads++;
      return name === 'pick-path-diagnostic' ? '1' : null;
    },
  };
  assert.equal(pickPathDiagnosticRequested({ get: () => null }), false);
  assert.equal(pickPathDiagnosticRequested(params), true);
  assert.equal(reads, 1);
  assert.equal(pickPathDiagnosticRequested(null), false);
});

test('hosted pick-path option is confined to the datacenter runtime fixture', () => {
  assert.equal(
    infrastructurePickPathDiagnosticOptionEnabled([
      '--infrastructure-datacenters',
      '--infrastructure-pick-path-diagnostic',
    ]),
    true,
  );
  assert.equal(infrastructurePickPathDiagnosticOptionEnabled([]), false);
  assert.throws(
    () =>
      infrastructurePickPathDiagnosticOptionEnabled([
        '--infrastructure-pick-path-diagnostic',
      ]),
    /requires --infrastructure-datacenters/,
  );
});

test('bounded envelope validates two lifetime observations and their native pick calls', () => {
  const baseline = run().record;
  const candidate = run().record;
  const envelope = {
    schema: INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA,
    enabled: true,
    instrumented: true,
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    pickAcceptanceEligible: false,
    scope:
      'synchronous native scene picks in three selection-order controls; diagnostic calls never satisfy fixture pick gates',
    frameWitnessSemantics:
      'postRender count, camera position and clock only; scene.pick may advance internal preparation',
    status: 'complete',
    maxCandidatesPerLifetime:
      INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME,
    maxCompletedRenderRevisionsPerCandidate:
      INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE,
    maxPickCallsPerLifetime: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
    maxPickCalls: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT,
    pickCalls: 10,
    lifetimes: [
      {
        mode: 'entities',
        status: 'passed',
        maxPickCalls: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
        pickCalls: 5,
        renderRevisionObserver: { available: true, cleanupConfirmed: true },
        observations: [
          {
            ...baseline,
            caseId: 'default-style',
            pair: 0,
            cameraPosition: [1, 2, 3],
            renderClockIso: '2026-10-12T10:00:00.000Z',
          },
        ],
      },
      {
        mode: 'primitive-collections',
        status: 'passed',
        maxPickCalls: INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME,
        pickCalls: 5,
        renderRevisionObserver: { available: true, cleanupConfirmed: true },
        observations: [
          {
            ...candidate,
            caseId: 'default-style',
            pair: 0,
            cameraPosition: [1, 2, 3],
            renderClockIso: '2026-10-12T10:00:00.000Z',
          },
        ],
      },
    ],
  };
  assert.equal(validateInfrastructurePickPathEnvelope(envelope), envelope);
  const forgedStable = structuredClone(envelope);
  forgedStable.lifetimes[0].observations[0].frameStableDuringControls = false;
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(forgedStable),
    /malformed/,
  );
  const forgedStartRevision = structuredClone(envelope);
  forgedStartRevision.lifetimes[0].observations[0].controlStartFrameState
    .completedRenderRevision++;
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(forgedStartRevision),
    /malformed/,
  );
  const forgedCaptureRevision = structuredClone(envelope);
  forgedCaptureRevision.lifetimes[0].observations[0].completedRenderRevision++;
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(forgedCaptureRevision),
    /malformed/,
  );
  const skippedControls = structuredClone(envelope);
  skippedControls.pickCalls = 0;
  for (const lifetime of skippedControls.lifetimes) {
    lifetime.pickCalls = 0;
    lifetime.observations = [
      {
        phase: 'initial-stable-render',
        caseId: 'default-style',
        pair: 0,
        candidateEntityId: 'candidate-1',
        completedRenderRevision: 42,
        renderSignature: signature,
        status: 'candidate-not-pickable-in-view',
        pickCalls: 0,
      },
    ];
  }
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(skippedControls),
    /malformed/,
  );
  const duplicateRevision = structuredClone(envelope);
  duplicateRevision.lifetimes[0].observations.push(
    structuredClone(duplicateRevision.lifetimes[0].observations[0]),
  );
  duplicateRevision.lifetimes[0].pickCalls = 10;
  duplicateRevision.pickCalls = 15;
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(duplicateRevision),
    /malformed/,
  );
  const overBudget = structuredClone(envelope);
  overBudget.maxPickCalls = 500;
  assert.throws(
    () => validateInfrastructurePickPathEnvelope(overBudget),
    /malformed/,
  );

  const unknownFrame = structuredClone(envelope);
  unknownFrame.status = 'partial-or-diagnostic-error';
  unknownFrame.pickCalls = 0;
  unknownFrame.lifetimes[0].status = 'diagnostic-error';
  unknownFrame.lifetimes[0].pickCalls = 0;
  unknownFrame.lifetimes[0].observations = [
    {
      phase: 'diagnostic-error',
      caseId: 'default-style',
      pair: 0,
      candidateEntityId: null,
      completedRenderRevision: null,
      renderSignature: null,
      errorName: 'Error',
      status: 'diagnostic-error',
      pickCalls: 0,
    },
  ];
  unknownFrame.lifetimes[1].status = 'diagnostic-error';
  unknownFrame.lifetimes[1].pickCalls = 0;
  unknownFrame.lifetimes[1].observations = [];
  assert.equal(
    validateInfrastructurePickPathEnvelope(unknownFrame),
    unknownFrame,
  );
});
