export const INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA =
  'gev-infrastructure-pick-path-diagnostic/v1';
export const INFRASTRUCTURE_PICK_PATH_CONTROLS = Object.freeze([
  'point-and-stem-before-selection',
  'point-select-then-stem',
  'stem-only',
]);
export const INFRASTRUCTURE_PICK_PATH_PICKS_PER_CANDIDATE = 5;
export const INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME = 2;
export const INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE = 2;
export const INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME =
  INFRASTRUCTURE_PICK_PATH_PICKS_PER_CANDIDATE *
  INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME *
  INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE;
export const INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT =
  INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME * 2;

const errorName = (error) =>
  ['TypeError', 'DeveloperError', 'RangeError', 'PickError'].includes(
    error?.name,
  )
    ? error.name
    : 'Error';

/** Keep a copied canvas owned through witness sampling and asynchronous processing. */
export async function processOwnedCapturedFrame({
  capture,
  readFrameState,
  process,
  release,
}) {
  if (
    typeof capture !== 'function' ||
    typeof process !== 'function' ||
    typeof release !== 'function'
  )
    throw new TypeError('Captured-frame ownership callbacks are required.');
  const canvas = await capture();
  let primaryError = null;
  try {
    let completedFrameState = null;
    let completedFrameStateErrorName = null;
    if (typeof readFrameState === 'function') {
      try {
        completedFrameState = readFrameState();
      } catch (error) {
        completedFrameStateErrorName = errorName(error);
      }
    }
    return await process(canvas, {
      completedFrameState,
      completedFrameStateErrorName,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (canvas) {
      try {
        release(canvas);
      } catch (error) {
        if (!primaryError) throw error;
      }
    }
  }
}

const identity = (value) => {
  const id = typeof value?.id === 'string' ? value.id : '';
  return id.length > 0 && id.length <= 160 ? id : null;
};

const boundedStringOrNull = (value, limit = 160) =>
  value === null ||
  (typeof value === 'string' && value.length > 0 && value.length <= limit);
const onlyKeys = (value, allowed) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));

export function validateInfrastructurePickPathEnvelope(envelope) {
  const invalid = () => {
    throw new Error('Infrastructure pick-path diagnostic is malformed.');
  };
  if (
    !envelope ||
    !onlyKeys(envelope, [
      'schema',
      'enabled',
      'instrumented',
      'diagnosticOnly',
      'performanceAcceptanceEligible',
      'pickAcceptanceEligible',
      'scope',
      'frameWitnessSemantics',
      'maxCandidatesPerLifetime',
      'maxCompletedRenderRevisionsPerCandidate',
      'maxPickCallsPerLifetime',
      'maxPickCalls',
      'pickCalls',
      'status',
      'lifetimes',
    ]) ||
    envelope.schema !== INFRASTRUCTURE_PICK_PATH_DIAGNOSTIC_SCHEMA ||
    envelope.enabled !== true ||
    envelope.instrumented !== true ||
    envelope.diagnosticOnly !== true ||
    envelope.performanceAcceptanceEligible !== false ||
    envelope.pickAcceptanceEligible !== false ||
    envelope.scope !==
      'synchronous native scene picks in three selection-order controls; diagnostic calls never satisfy fixture pick gates' ||
    envelope.frameWitnessSemantics !==
      'postRender count, camera position and clock only; scene.pick may advance internal preparation' ||
    !['complete', 'partial-or-diagnostic-error', 'running'].includes(
      envelope.status,
    ) ||
    envelope.maxCandidatesPerLifetime !==
      INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME ||
    envelope.maxCompletedRenderRevisionsPerCandidate !==
      INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE ||
    envelope.maxPickCallsPerLifetime !==
      INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME ||
    envelope.maxPickCalls !== INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_REPORT ||
    !Number.isSafeInteger(envelope.pickCalls) ||
    envelope.pickCalls < 0 ||
    envelope.pickCalls > envelope.maxPickCalls ||
    !Array.isArray(envelope.lifetimes) ||
    envelope.lifetimes.length > 2
  )
    invalid();
  const modes = ['entities', 'primitive-collections'];
  let totalCalls = 0;
  for (let index = 0; index < envelope.lifetimes.length; index++) {
    const lifetime = envelope.lifetimes[index];
    if (
      lifetime?.mode !== modes[index] ||
      !onlyKeys(lifetime, [
        'mode',
        'maxPickCalls',
        'pickCalls',
        'status',
        'observations',
        'renderRevisionObserver',
      ]) ||
      !lifetime.renderRevisionObserver ||
      !onlyKeys(lifetime.renderRevisionObserver, [
        'available',
        'cleanupConfirmed',
        'errorName',
      ]) ||
      typeof lifetime.renderRevisionObserver.available !== 'boolean' ||
      typeof lifetime.renderRevisionObserver.cleanupConfirmed !== 'boolean' ||
      (lifetime.renderRevisionObserver.errorName !== undefined &&
        !['Error', 'TypeError', 'DeveloperError', 'RangeError'].includes(
          lifetime.renderRevisionObserver.errorName,
        )) ||
      !['running', 'passed', 'failed', 'diagnostic-error'].includes(
        lifetime.status,
      ) ||
      lifetime.maxPickCalls !==
        INFRASTRUCTURE_PICK_PATH_MAX_CALLS_PER_LIFETIME ||
      !Number.isSafeInteger(lifetime.pickCalls) ||
      lifetime.pickCalls < 0 ||
      lifetime.pickCalls > lifetime.maxPickCalls ||
      !Array.isArray(lifetime.observations) ||
      lifetime.observations.length >
        INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME *
          INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE
    )
      invalid();
    let lifetimeCalls = 0;
    const candidateRevisions = new Map();
    const seenCandidateRevisions = new Set();
    for (const observation of lifetime.observations) {
      if (
        !observation ||
        !onlyKeys(observation, [
          'phase',
          'caseId',
          'pair',
          'candidateEntityId',
          'completedRenderRevision',
          'renderSignature',
          'pointScreen',
          'stemScreen',
          'captureFrameState',
          'controlStartFrameState',
          'controlEndFrameState',
          'frameStableDuringControls',
          'frameStateErrorName',
          'errorName',
          'initialSelectionId',
          'controls',
          'selectionRestoredBetweenControls',
          'selectionRestoredAfter',
          'pickCalls',
          'status',
          'cameraPosition',
          'renderClockIso',
        ]) ||
        ![
          'initial-stable-render',
          'subsequent-completed-render',
          'diagnostic-error',
        ].includes(observation.phase) ||
        typeof observation.caseId !== 'string' ||
        !['default-style', 'camera-lod-update'].includes(observation.caseId) ||
        !Number.isSafeInteger(observation.pair) ||
        observation.pair < 0 ||
        observation.pair >= 5 ||
        (!(
          Number.isSafeInteger(observation.completedRenderRevision) &&
          observation.completedRenderRevision > 0
        ) &&
          !(
            observation.status === 'diagnostic-error' &&
            observation.completedRenderRevision === null
          )) ||
        (!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(
          observation.renderSignature || '',
        ) &&
          !(
            observation.status === 'diagnostic-error' &&
            observation.renderSignature === null
          )) ||
        !boundedStringOrNull(observation.candidateEntityId) ||
        (observation.pointScreen !== undefined &&
          !validScreen(observation.pointScreen)) ||
        (observation.stemScreen !== undefined &&
          !validScreen(observation.stemScreen)) ||
        (observation.cameraPosition !== undefined &&
          observation.cameraPosition !== null &&
          (!Array.isArray(observation.cameraPosition) ||
            observation.cameraPosition.length !== 3 ||
            !observation.cameraPosition.every(Number.isFinite))) ||
        (observation.renderClockIso !== undefined &&
          (typeof observation.renderClockIso !== 'string' ||
            observation.renderClockIso.length > 40 ||
            !Number.isFinite(Date.parse(observation.renderClockIso)))) ||
        !Number.isSafeInteger(observation.pickCalls) ||
        observation.pickCalls < 0 ||
        observation.pickCalls > INFRASTRUCTURE_PICK_PATH_PICKS_PER_CANDIDATE ||
        ![
          'completed',
          'control-error',
          'selection-restore-error',
          'selection-read-error',
          'invalid-input',
          'budget-exhausted',
          'budget-accounting-error',
          'candidate-not-visible',
          'candidate-not-pickable-in-view',
          'diagnostic-error',
          'frame-changed-before-controls',
          'frame-changed-during-controls',
          'frame-state-read-error',
        ].includes(observation.status)
      )
        invalid();
      if (observation.status === 'diagnostic-error') {
        if (
          ![
            'Error',
            'TypeError',
            'DeveloperError',
            'RangeError',
            'PickError',
          ].includes(observation.errorName) ||
          observation.pickCalls !== 0 ||
          !boundedStringOrNull(observation.candidateEntityId) ||
          observation.controls !== undefined
        )
          invalid();
        continue;
      }
      if (observation.candidateEntityId) {
        candidateRevisions.set(
          observation.candidateEntityId,
          (candidateRevisions.get(observation.candidateEntityId) || 0) + 1,
        );
        const candidateRevision = `${observation.candidateEntityId}:${observation.completedRenderRevision}`;
        if (seenCandidateRevisions.has(candidateRevision)) invalid();
        seenCandidateRevisions.add(candidateRevision);
      }
      if (
        [
          'selection-read-error',
          'invalid-input',
          'budget-exhausted',
          'budget-accounting-error',
          'frame-changed-before-controls',
        ].includes(observation.status)
      ) {
        if (
          observation.pickCalls !== 0 ||
          (observation.controls !== undefined &&
            (!Array.isArray(observation.controls) ||
              observation.controls.length !== 0))
        )
          invalid();
        if (observation.status === 'frame-changed-before-controls') {
          if (
            !validFrameState(observation.captureFrameState) ||
            !validFrameState(observation.controlStartFrameState) ||
            sameFrameState(
              observation.captureFrameState,
              observation.controlStartFrameState,
            ) ||
            observation.frameStableDuringControls !== false ||
            observation.controlEndFrameState !== null
          )
            invalid();
        }
        continue;
      }
      if (
        observation.status === 'frame-state-read-error' &&
        Array.isArray(observation.controls) &&
        observation.controls.length === 0
      ) {
        if (
          observation.pickCalls !== 0 ||
          ![
            'Error',
            'TypeError',
            'DeveloperError',
            'RangeError',
            'PickError',
          ].includes(observation.errorName)
        )
          invalid();
        continue;
      }
      if (
        ['candidate-not-visible', 'candidate-not-pickable-in-view'].includes(
          observation.status,
        )
      ) {
        if (observation.pickCalls !== 0 || observation.controls !== undefined)
          invalid();
        continue;
      }
      if (
        !Array.isArray(observation.controls) ||
        observation.controls.length !==
          INFRASTRUCTURE_PICK_PATH_CONTROLS.length ||
        typeof observation.selectionRestoredBetweenControls !== 'boolean' ||
        typeof observation.selectionRestoredAfter !== 'boolean' ||
        !boundedStringOrNull(observation.initialSelectionId)
      )
        invalid();
      if (
        !validScreen(observation.pointScreen) ||
        !validScreen(observation.stemScreen)
      )
        invalid();
      if (
        !validFrameState(observation.captureFrameState) ||
        observation.captureFrameState.completedRenderRevision !==
          observation.completedRenderRevision ||
        !validFrameState(observation.controlStartFrameState) ||
        (!validFrameState(observation.controlEndFrameState) &&
          !(
            observation.status === 'frame-state-read-error' &&
            observation.controlEndFrameState === null
          )) ||
        typeof observation.frameStableDuringControls !== 'boolean' ||
        (observation.frameStateErrorName !== undefined &&
          ![
            'Error',
            'TypeError',
            'DeveloperError',
            'RangeError',
            'PickError',
          ].includes(observation.frameStateErrorName))
      )
        invalid();
      const expectedPickCounts = [2, 2, 1];
      for (
        let controlIndex = 0;
        controlIndex < observation.controls.length;
        controlIndex++
      ) {
        const control = observation.controls[controlIndex];
        if (
          control?.name !== INFRASTRUCTURE_PICK_PATH_CONTROLS[controlIndex] ||
          !onlyKeys(control, ['name', 'status', 'picks', 'errorName']) ||
          !['completed', 'error', 'selection-restore-error'].includes(
            control.status,
          ) ||
          !Array.isArray(control.picks) ||
          control.picks.length > expectedPickCounts[controlIndex] ||
          (control.status === 'error' &&
            ![
              'Error',
              'TypeError',
              'DeveloperError',
              'RangeError',
              'PickError',
            ].includes(control.errorName))
        )
          invalid();
        if (
          (control.status === 'completed' &&
            control.picks.length !== expectedPickCounts[controlIndex]) ||
          (control.status === 'selection-restore-error' &&
            control.picks.length !== 0) ||
          (control.status !== 'error' && control.errorName !== undefined)
        )
          invalid();
        for (const pick of control.picks) {
          if (
            !pick ||
            !onlyKeys(pick, [
              'result',
              'entityId',
              'sourceRecordId',
              'ownerVerified',
              'primitiveType',
              'appearanceType',
              'errorName',
            ]) ||
            !['owned-hit', 'unowned-hit', 'miss', 'error'].includes(
              pick.result,
            ) ||
            !boundedStringOrNull(pick.entityId) ||
            !boundedStringOrNull(pick.sourceRecordId) ||
            typeof pick.ownerVerified !== 'boolean' ||
            !boundedStringOrNull(pick.primitiveType, 80) ||
            !boundedStringOrNull(pick.appearanceType, 80) ||
            pick.selectionValue !== undefined ||
            (pick.result === 'owned-hit' &&
              (pick.ownerVerified !== true ||
                !pick.entityId ||
                !pick.sourceRecordId)) ||
            (pick.result !== 'owned-hit' && pick.ownerVerified === true) ||
            (pick.result === 'error' &&
              ![
                'Error',
                'TypeError',
                'DeveloperError',
                'RangeError',
                'PickError',
              ].includes(pick.errorName))
          )
            invalid();
        }
      }
      const observedCalls = observation.controls.reduce(
        (sum, control) => sum + control.picks.length,
        0,
      );
      if (observedCalls !== observation.pickCalls) invalid();
      if (
        (observation.status === 'completed' &&
          (!observation.selectionRestoredBetweenControls ||
            !observation.selectionRestoredAfter ||
            !observation.frameStableDuringControls ||
            !sameFrameState(
              observation.captureFrameState,
              observation.controlStartFrameState,
            ) ||
            !sameFrameState(
              observation.controlStartFrameState,
              observation.controlEndFrameState,
            ) ||
            observation.controls.some(
              (control) => control.status !== 'completed',
            ))) ||
        (observation.status === 'frame-changed-before-controls' &&
          (sameFrameState(
            observation.captureFrameState,
            observation.controlStartFrameState,
          ) ||
            observation.frameStableDuringControls !== false)) ||
        (observation.status === 'frame-changed-during-controls' &&
          (observation.frameStableDuringControls !== false ||
            !sameFrameState(
              observation.captureFrameState,
              observation.controlStartFrameState,
            ) ||
            sameFrameState(
              observation.controlStartFrameState,
              observation.controlEndFrameState,
            ))) ||
        (observation.status === 'frame-state-read-error' &&
          !observation.frameStateErrorName) ||
        (observation.status === 'control-error' &&
          !observation.controls.some(
            (control) => control.status === 'error',
          )) ||
        (observation.status === 'selection-restore-error' &&
          observation.selectionRestoredBetweenControls &&
          observation.selectionRestoredAfter &&
          !observation.controls.some(
            (control) => control.status === 'selection-restore-error',
          ))
      )
        invalid();
      lifetimeCalls += observedCalls;
    }
    if (
      candidateRevisions.size >
        INFRASTRUCTURE_PICK_PATH_MAX_CANDIDATES_PER_LIFETIME ||
      [...candidateRevisions.values()].some(
        (revisionCount) =>
          revisionCount > INFRASTRUCTURE_PICK_PATH_MAX_REVISIONS_PER_CANDIDATE,
      )
    )
      invalid();
    if (lifetimeCalls !== lifetime.pickCalls) invalid();
    totalCalls += lifetimeCalls;
  }
  if (totalCalls !== envelope.pickCalls) invalid();
  if (
    envelope.status === 'complete' &&
    (envelope.lifetimes.length !== 2 ||
      envelope.lifetimes.some(
        (lifetime) =>
          lifetime.status !== 'passed' ||
          !lifetime.observations.some(
            (observation) => observation.status === 'completed',
          ) ||
          lifetime.renderRevisionObserver.available !== true ||
          lifetime.renderRevisionObserver.cleanupConfirmed !== true,
      ))
  )
    invalid();
  return envelope;
}

export function pickPathDiagnosticRequested(searchParams) {
  return searchParams?.get?.('pick-path-diagnostic') === '1';
}

export function infrastructurePickPathDiagnosticOptionEnabled(args) {
  const options = Array.isArray(args) ? args : [];
  const enabled = options.includes('--infrastructure-pick-path-diagnostic');
  if (enabled && !options.includes('--infrastructure-datacenters'))
    throw new Error(
      '--infrastructure-pick-path-diagnostic requires --infrastructure-datacenters.',
    );
  return enabled;
}

/** Run the three native-pick order controls synchronously against one captured render. */
export function runInfrastructurePickPathControls({
  pick,
  resolve,
  getSelection,
  setSelection,
  candidateEntityId,
  pointScreen,
  stemScreen,
  completedRenderRevision,
  renderSignature,
  phase,
  budget,
  captureFrameState,
  readFrameState,
}) {
  const callsBefore = Number.isSafeInteger(budget?.calls) ? budget.calls : 0;
  const callLimit = Math.min(
    INFRASTRUCTURE_PICK_PATH_PICKS_PER_CANDIDATE,
    Number.isSafeInteger(budget?.limit)
      ? Math.max(0, budget.limit - callsBefore)
      : 0,
  );
  const record = {
    phase,
    candidateEntityId: identity({ id: candidateEntityId }),
    completedRenderRevision:
      Number.isSafeInteger(completedRenderRevision) &&
      completedRenderRevision > 0
        ? completedRenderRevision
        : null,
    renderSignature:
      typeof renderSignature === 'string' &&
      /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(renderSignature)
        ? renderSignature
        : null,
    pointScreen: screen(pointScreen),
    stemScreen: screen(stemScreen),
    initialSelectionId: null,
    controls: [],
    selectionRestoredBetweenControls: true,
    selectionRestoredAfter: false,
    captureFrameState: validFrameState(captureFrameState)
      ? copyFrameState(captureFrameState)
      : null,
    controlStartFrameState: null,
    controlEndFrameState: null,
    frameStableDuringControls: false,
    pickCalls: 0,
  };
  if (
    typeof pick !== 'function' ||
    typeof resolve !== 'function' ||
    typeof getSelection !== 'function' ||
    typeof setSelection !== 'function' ||
    !budget ||
    !Number.isSafeInteger(budget.calls) ||
    !Number.isSafeInteger(budget.limit) ||
    budget.calls < 0 ||
    budget.limit < budget.calls ||
    !record.candidateEntityId ||
    !record.pointScreen ||
    !record.stemScreen ||
    !record.completedRenderRevision ||
    !record.renderSignature ||
    !record.captureFrameState ||
    typeof readFrameState !== 'function' ||
    !['initial-stable-render', 'subsequent-completed-render'].includes(phase)
  ) {
    record.status = 'invalid-input';
    return record;
  }
  try {
    record.controlStartFrameState = copyFrameState(readFrameState());
  } catch (error) {
    record.status = 'frame-state-read-error';
    record.errorName = errorName(error);
    return record;
  }
  if (
    !sameFrameState(record.captureFrameState, record.controlStartFrameState)
  ) {
    record.status = 'frame-changed-before-controls';
    return record;
  }
  if (callLimit < INFRASTRUCTURE_PICK_PATH_PICKS_PER_CANDIDATE) {
    record.status = 'budget-exhausted';
    return record;
  }

  let initialSelection;
  try {
    initialSelection = getSelection();
    record.initialSelectionId = identity(initialSelection);
  } catch (error) {
    record.status = 'selection-read-error';
    record.errorName = errorName(error);
    return record;
  }

  const restoreSelection = () => {
    try {
      setSelection(initialSelection);
      return getSelection() === initialSelection;
    } catch {
      return false;
    }
  };
  const runPick = (kind, screenPosition) => {
    budget.calls++;
    record.pickCalls++;
    try {
      const picked = pick(kind, screenPosition);
      const result = resolve(picked, kind);
      return {
        result:
          result?.ownerVerified === true
            ? 'owned-hit'
            : picked
              ? 'unowned-hit'
              : 'miss',
        entityId: result?.entityId || pickedEntityId(picked),
        sourceRecordId: result?.sourceRecordId || null,
        ownerVerified: result?.ownerVerified === true,
        primitiveType: result?.primitiveType || primitiveType(picked),
        appearanceType: result?.appearanceType || appearanceType(picked),
        selectionValue: result?.selectionValue ?? null,
      };
    } catch (error) {
      return {
        result: 'error',
        entityId: null,
        sourceRecordId: null,
        ownerVerified: false,
        primitiveType: null,
        appearanceType: null,
        errorName: errorName(error),
      };
    }
  };
  const addControl = (name, action) => {
    const control = { name, status: 'completed', picks: [] };
    if (record.controls.length > 0 && !restoreSelection()) {
      record.selectionRestoredBetweenControls = false;
      control.status = 'selection-restore-error';
      record.controls.push(control);
      return false;
    }
    try {
      action(control);
    } catch (error) {
      control.status = 'error';
      control.errorName = errorName(error);
    }
    const pickError = control.picks.find((item) => item.result === 'error');
    if (pickError) {
      control.status = 'error';
      control.errorName = pickError.errorName;
    }
    record.controls.push(control);
    return record.selectionRestoredBetweenControls;
  };

  try {
    const firstControlReady = addControl(
      INFRASTRUCTURE_PICK_PATH_CONTROLS[0],
      (control) => {
        control.picks.push(runPick('point', record.pointScreen));
        control.picks.push(runPick('stem', record.stemScreen));
      },
    );
    const secondControlReady =
      firstControlReady &&
      addControl(INFRASTRUCTURE_PICK_PATH_CONTROLS[1], (control) => {
        const point = runPick('point', record.pointScreen);
        control.picks.push(point);
        if (point.selectionValue != null) {
          setSelection(point.selectionValue);
          if (getSelection() !== point.selectionValue)
            throw Object.assign(
              new Error('Selection assignment was ignored.'),
              {
                name: 'DeveloperError',
              },
            );
        }
        control.picks.push(runPick('stem', record.stemScreen));
      });
    if (secondControlReady)
      addControl(INFRASTRUCTURE_PICK_PATH_CONTROLS[2], (control) => {
        control.picks.push(runPick('stem', record.stemScreen));
      });
    else
      record.controls.push({
        name: INFRASTRUCTURE_PICK_PATH_CONTROLS[2],
        status: 'selection-restore-error',
        picks: [],
      });
  } finally {
    record.selectionRestoredAfter = restoreSelection();
    try {
      record.controlEndFrameState = copyFrameState(readFrameState());
      record.frameStableDuringControls = sameFrameState(
        record.controlStartFrameState,
        record.controlEndFrameState,
      );
    } catch (error) {
      record.frameStateErrorName = errorName(error);
    }
    for (const control of record.controls)
      for (const pickRecord of control.picks) delete pickRecord.selectionValue;
  }
  record.status =
    !record.selectionRestoredAfter || !record.selectionRestoredBetweenControls
      ? 'selection-restore-error'
      : record.controls.some((control) => control.status !== 'completed')
        ? 'control-error'
        : record.frameStateErrorName
          ? 'frame-state-read-error'
          : !record.frameStableDuringControls
            ? 'frame-changed-during-controls'
            : 'completed';
  if (budget.calls - callsBefore !== record.pickCalls)
    record.status = 'budget-accounting-error';
  return record;
}

function screen(value) {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    value.x < 0 ||
    value.y < 0
  )
    return null;
  return { x: value.x, y: value.y };
}

function validScreen(value) {
  return Boolean(
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.y >= 0,
  );
}

function validFrameState(value) {
  return Boolean(
    value &&
    Number.isSafeInteger(value.completedRenderRevision) &&
    value.completedRenderRevision > 0 &&
    Array.isArray(value.cameraPosition) &&
    value.cameraPosition.length === 3 &&
    value.cameraPosition.every(Number.isFinite) &&
    typeof value.renderClockIso === 'string' &&
    value.renderClockIso.length <= 40 &&
    Number.isFinite(Date.parse(value.renderClockIso)),
  );
}

function copyFrameState(value) {
  if (!validFrameState(value)) throw new Error('Frame state is invalid.');
  return {
    completedRenderRevision: value.completedRenderRevision,
    cameraPosition: value.cameraPosition.slice(),
    renderClockIso: value.renderClockIso,
  };
}

function sameFrameState(left, right) {
  return (
    validFrameState(left) &&
    validFrameState(right) &&
    left.completedRenderRevision === right.completedRenderRevision &&
    left.renderClockIso === right.renderClockIso &&
    left.cameraPosition.every(
      (value, index) => value === right.cameraPosition[index],
    )
  );
}

function pickedEntityId(picked) {
  const pickedId = picked?.id;
  const value = typeof pickedId === 'string' ? pickedId : pickedId?.id;
  return typeof value === 'string' && value.length <= 160 ? value : null;
}

function primitiveType(picked) {
  const value = picked?.primitive?.constructor?.name;
  return typeof value === 'string' && value.length <= 80 ? value : null;
}

function appearanceType(picked) {
  const value = picked?.primitive?.appearance?.constructor?.name;
  return typeof value === 'string' && value.length <= 80 ? value : null;
}
