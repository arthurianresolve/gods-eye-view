/** Own one opt-in CPU profile over an existing provider-fixture sample. */
export function isProviderSampleCpuProfileTarget(scenario, run) {
  return (
    (scenario === 'idle' && (run === 1 || run === 2)) ||
    (scenario === 'scripted-motion' && run === 1)
  );
}

export function upsertProviderSampleCpuProfile(records, record) {
  if (!Array.isArray(records) || !Number.isSafeInteger(record?.captureOrdinal))
    throw new TypeError('Provider CPU profile record identity is invalid.');
  const index = records.findIndex(
    (item) => item.captureOrdinal === record.captureOrdinal,
  );
  if (index < 0) records.push(record);
  else records[index] = record;
  return record;
}

export function createProviderSampleCpuProfileWindow({
  enabled,
  profileRunner,
  page,
  artifactDirectory,
  targetScenario,
  targetRun,
  documentRole,
  documentId,
  captureOrdinal,
  onRecord = () => {},
}) {
  if (!enabled)
    return {
      record: null,
      started: Promise.resolve(null),
      stop: async () => null,
    };
  if (typeof profileRunner !== 'function')
    throw new TypeError('A bounded CPU profile runner is required.');
  if (
    !isProviderSampleCpuProfileTarget(targetScenario, targetRun) ||
    !Number.isSafeInteger(targetRun) ||
    targetRun < 1 ||
    !Number.isSafeInteger(captureOrdinal) ||
    captureOrdinal < 0 ||
    typeof documentRole !== 'string' ||
    typeof documentId !== 'string' ||
    !documentRole ||
    !documentId ||
    documentRole.length > 80 ||
    documentId.length > 160
  )
    throw new TypeError('Provider CPU profile target identity is invalid.');

  const key =
    targetScenario === 'idle'
      ? `provider-idle-${targetRun}`
      : `provider-scripted-motion-${targetRun}`;
  const record = {
    schema: 'gev-provider-sample-cpu-profile-window/v1',
    enabled: true,
    targetScenario,
    targetRun,
    captureOrdinal,
    documentRole,
    documentId,
    status: 'starting',
    scope: `${targetScenario} run ${targetRun} from immediately before warmup through measurement-boundary completion or failure; sampled main-thread stacks include idle and garbage collection, and are not precise CPU execution or GPU timing`,
    performanceAcceptanceEligible: false,
    profilerStarted: null,
    stopReason: null,
    profile: null,
  };
  const update = () => {
    try {
      onRecord(record);
    } catch {
      // Optional report bookkeeping cannot replace capture behavior.
    }
  };
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let finishOperation;
  const operation = new Promise((resolve) => {
    finishOperation = resolve;
  });
  operation.catch(() => {});
  const profileTask = profileRunner({
    page,
    label: `${key}-warmup-through-measurement-boundary`,
    target: {
      scenario: targetScenario,
      run: targetRun,
      captureOrdinal,
      documentRole: record.documentRole,
      documentId: record.documentId,
    },
    artifactDirectory,
    fileName: `${key}-cpu-profile.json`,
    indexFileName: `${key}-cpu-profile-ref.json`,
    maxWindowMs: 60_000,
    operation: () => operation,
    onStarted: ({ profilerStarted }) => {
      record.profilerStarted = profilerStarted === true;
      record.status = profilerStarted
        ? 'recording'
        : 'recording-profiler-unavailable';
      markStarted();
      update();
    },
    onProfile: (profile) => {
      record.profile = profile;
      record.status = profile.status;
      record.windowCapReached = profile.windowCapReached === true;
      record.windowCapMs = profile.windowCapMs ?? null;
      record.profileWindowMs = profile.profileWindowMs ?? null;
      record.stopOverrunMs = profile.stopOverrunMs ?? null;
      update();
    },
  });
  const settledProfileTask = profileTask.catch((error) => {
    record.status = 'failed';
    record.error = {
      name: String(error?.name || 'Error').slice(0, 80),
      message: String(error?.message || error).slice(0, 240),
    };
    markStarted();
    update();
    return null;
  });
  let stopPromise = null;
  return {
    record,
    started,
    async stop(reason) {
      if (!stopPromise) {
        record.stopReason = String(reason).slice(0, 100);
        finishOperation({ status: 'window-ended', reason: record.stopReason });
        update();
        stopPromise = settledProfileTask.then(() => record);
      }
      return stopPromise;
    },
  };
}
