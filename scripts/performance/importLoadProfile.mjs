import { summarizeCpuProfile } from './sampledCpuProfile.mjs';

const MAX_HEAP_PROFILE_NODES = 50_000;
const MAX_HEAP_PROFILE_DEPTH = 64;
const MAX_HEAP_PROFILE_SAMPLES = 250_000;
const MAX_PROFILE_LOCATIONS = 30;
export const IMPORT_LOAD_PROFILE_SCOPE =
  'Profiler window includes explicit browser start/stop control clicks and wait/poll time around one warmed cooperative load; it may include idle stacks and garbage collection. Fresh-frame capture and teardown are outside the window. Sampled profile summaries are diagnostic and not performance acceptance.';

function positiveTimeout(value, name) {
  if (!Number.isFinite(value) || value <= 0)
    throw new TypeError(`${name} must be a positive finite number`);
  return value;
}

function bounded(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function fixturePath(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('/') && !value.startsWith('//') && !/[?#]/.test(value))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1'
      ? url.pathname
      : '[non-fixture source]';
  } catch {
    return '[non-fixture source]';
  }
}

export function normalizeImportHeapProfile(profile) {
  if (
    !profile?.head ||
    typeof profile.head !== 'object' ||
    !Array.isArray(profile.samples) ||
    profile.samples.length > MAX_HEAP_PROFILE_SAMPLES
  )
    throw new Error('Invalid loading heap profile: missing root or samples.');
  let nodeCount = 0;
  const copyNode = (node, depth) => {
    if (
      depth > MAX_HEAP_PROFILE_DEPTH ||
      nodeCount >= MAX_HEAP_PROFILE_NODES ||
      !node ||
      !Number.isSafeInteger(node.id) ||
      !Number.isFinite(node.selfSize) ||
      node.selfSize < 0 ||
      typeof node.callFrame?.functionName !== 'string' ||
      !Array.isArray(node.children) ||
      node.children.some((child) => !child || typeof child !== 'object')
    )
      throw new Error(
        'Loading heap profile exceeded its normalization bounds.',
      );
    nodeCount++;
    return {
      id: node.id,
      selfSize: node.selfSize,
      callFrame: {
        functionName: node.callFrame.functionName.slice(0, 240),
        url: fixturePath(node.callFrame.url),
        lineNumber: Number.isInteger(node.callFrame.lineNumber)
          ? node.callFrame.lineNumber
          : null,
        columnNumber: Number.isInteger(node.callFrame.columnNumber)
          ? node.callFrame.columnNumber
          : null,
      },
      children: node.children.map((child) => copyNode(child, depth + 1)),
    };
  };
  return {
    head: copyNode(profile.head, 0),
    samples: profile.samples.map((sample) => ({
      size: sample.size,
      nodeId: sample.nodeId,
      ordinal: sample.ordinal,
    })),
    nodeCount,
  };
}

export function summarizeImportHeapProfile(profile) {
  if (
    !profile?.head ||
    typeof profile.head !== 'object' ||
    !Array.isArray(profile.samples) ||
    profile.samples.length > MAX_HEAP_PROFILE_SAMPLES
  )
    throw new Error(
      'Invalid loading heap profile: missing root or malformed samples',
    );
  for (const sample of profile.samples) {
    if (
      !sample ||
      !Number.isFinite(sample.size) ||
      sample.size < 0 ||
      !Number.isSafeInteger(sample.nodeId) ||
      !Number.isFinite(sample.ordinal)
    )
      throw new Error('Invalid loading heap profile: malformed sample');
  }
  const locations = new Map();
  const stack = [{ node: profile.head, depth: 0 }];
  let nodeCount = 0;
  let sampledAllocationBytes = 0;
  let truncated = false;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (nodeCount >= MAX_HEAP_PROFILE_NODES || depth > MAX_HEAP_PROFILE_DEPTH) {
      truncated = true;
      continue;
    }
    if (
      !node ||
      !Number.isFinite(node.selfSize) ||
      node.selfSize < 0 ||
      typeof node.callFrame?.functionName !== 'string'
    )
      throw new Error('Invalid loading heap profile: malformed node');
    nodeCount++;
    sampledAllocationBytes += node.selfSize;
    const frame = node.callFrame;
    const row = {
      functionName: frame.functionName,
      url: fixturePath(frame.url),
      lineNumber: Number.isInteger(frame.lineNumber) ? frame.lineNumber : null,
      columnNumber: Number.isInteger(frame.columnNumber)
        ? frame.columnNumber
        : null,
    };
    const key = JSON.stringify(row);
    const group = locations.get(key) || { ...row, sampledBytes: 0, nodes: 0 };
    group.sampledBytes += node.selfSize;
    group.nodes++;
    locations.set(key, group);
    if (!Array.isArray(node.children))
      throw new Error('Invalid loading heap profile: malformed children');
    for (const child of node.children) {
      if (stack.length + nodeCount >= MAX_HEAP_PROFILE_NODES) {
        truncated = true;
        break;
      }
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  const ranked = [...locations.values()].sort(
    (left, right) => right.sampledBytes - left.sampledBytes,
  );
  return {
    schema: 'gev-import-load-heap-profile/v1',
    scope:
      'HeapProfiler sampled allocation callsites during the profiled window; sampled bytes are estimates, not exact allocation totals or retained-memory evidence.',
    performanceAcceptanceEligible: false,
    recomputation:
      'The sanitized bounded heap profile tree is retained in the enclosing diagnostic report so this summary can be independently recomputed; sampled bytes remain estimates.',
    nodeCount,
    sampleCount: profile.samples.length,
    sampledAllocationBytes,
    groupedLocations: ranked.length,
    topLocations: ranked.slice(0, MAX_PROFILE_LOCATIONS),
    omittedLocations: Math.max(0, ranked.length - MAX_PROFILE_LOCATIONS),
    truncated,
  };
}

export function validateImportLoadProfileFixture({
  fixtureReport,
  profileReport,
  mode,
  commit,
}) {
  const errors = [];
  const phases = fixtureReport?.importLoadProfile?.phases;
  const ordered = [
    phases?.setupStartedAtMs,
    phases?.setupReadyAtMs,
    phases?.profilerGateReadyAtMs,
    phases?.loadingStartedAtMs,
    phases?.loadingEndedAtMs,
    phases?.captureStartedAtMs,
    phases?.captureEndedAtMs,
    phases?.teardownStartedAtMs,
    phases?.teardownEndedAtMs,
  ];
  if (mode !== 'cpu' && mode !== 'heap') errors.push('invalid profile mode');
  if (
    fixtureReport?.applicationCommit !== commit ||
    fixtureReport?.harnessCommit !== commit
  )
    errors.push('fixture commit identity mismatch');
  if (
    fixtureReport?.fixture !== 'synthetic-5000-import-points/v1' ||
    fixtureReport?.status !== 'passed'
  )
    errors.push('fixture identity or status mismatch');
  if (
    fixtureReport?.importLoadProfile?.mode !== mode ||
    fixtureReport?.importLoadProfile?.performanceAcceptanceEligible !== false
  )
    errors.push('fixture profile mode or scope mismatch');
  if (
    phases?.profileStopRequestedBeforeCapture !== true ||
    !ordered.every(Number.isFinite) ||
    !ordered.every((value, index) => index === 0 || value >= ordered[index - 1])
  )
    errors.push('fixture phase ordering is incomplete');
  if (
    !Array.isArray(fixtureReport?.samples) ||
    fixtureReport.samples.length !== 1 ||
    fixtureReport.samples[0]?.capture?.completed !== true ||
    !/^[a-f0-9]{64}$/.test(fixtureReport.samples[0]?.pixelSha256 || '')
  )
    errors.push('single fresh-frame capture is incomplete');
  if (
    fixtureReport?.importLoadProfile?.workload?.featureCountAfter !== 5000 ||
    fixtureReport?.importLoadProfile?.workload?.pendingJobsAfter !== 0
  )
    errors.push('profiled workload did not complete the full population');
  if (
    !Array.isArray(fixtureReport?.checks) ||
    !fixtureReport.checks.some(
      (check) =>
        check &&
        check.id ===
          'single-profiled-load-separated-from-capture-and-teardown' &&
        check.status === 'passed',
    )
  )
    errors.push('profile separation check is missing');
  if (
    profileReport?.mode !== mode ||
    profileReport?.performanceAcceptanceEligible !== false ||
    profileReport?.profileScope !== IMPORT_LOAD_PROFILE_SCOPE
  )
    errors.push('profiler report mode or scope mismatch');
  if (
    !Number.isInteger(profileReport?.nodeCount) ||
    profileReport.nodeCount < 1 ||
    !Number.isInteger(profileReport?.groupedLocations) ||
    profileReport.groupedLocations < 1 ||
    !Number.isInteger(profileReport?.omittedLocations) ||
    profileReport.omittedLocations < 0 ||
    !Array.isArray(profileReport?.topLocations) ||
    profileReport.topLocations.length > MAX_PROFILE_LOCATIONS ||
    typeof profileReport?.recomputation !== 'string' ||
    profileReport.recomputation.length === 0
  )
    errors.push('bounded profile summary is incomplete');
  if (
    Array.isArray(profileReport?.topLocations) &&
    (profileReport.topLocations.some(
      (row) =>
        !row ||
        typeof row.functionName !== 'string' ||
        typeof row.url !== 'string' ||
        (mode === 'cpu'
          ? !Number.isInteger(row.samples) ||
            !Number.isFinite(row.sampledWeightMs) ||
            row.sampledWeightMs < 0
          : !Number.isInteger(row.nodes) ||
            row.nodes < 1 ||
            !Number.isFinite(row.sampledBytes) ||
            row.sampledBytes < 0),
    ) ||
      profileReport.omittedLocations !==
        Math.max(
          0,
          profileReport.groupedLocations - profileReport.topLocations.length,
        ))
  )
    errors.push('profile summary locations are malformed');
  if (
    mode === 'cpu' &&
    (!Number.isInteger(profileReport?.sampleCount) ||
      profileReport.sampleCount < 1 ||
      !Number.isFinite(profileReport?.profileWindowMs) ||
      profileReport.profileWindowMs <= 0 ||
      !Number.isFinite(profileReport?.totalSampleWeightMs) ||
      profileReport.totalSampleWeightMs < 0 ||
      !profileReport?.profile ||
      !Array.isArray(profileReport.profile.nodes) ||
      profileReport.profile.nodes.length < 1 ||
      profileReport.profile.nodes.length > 50_000 ||
      profileReport.profile.nodes.some(
        (node) =>
          !node ||
          !Number.isSafeInteger(node.id) ||
          typeof node.callFrame?.functionName !== 'string' ||
          typeof node.callFrame?.url !== 'string' ||
          (node.children !== undefined &&
            (!Array.isArray(node.children) ||
              node.children.some((id) => !Number.isSafeInteger(id)))),
      ) ||
      !Array.isArray(profileReport.profile.samples) ||
      profileReport.profile.samples.length < 1 ||
      profileReport.profile.samples.length > 250_000 ||
      profileReport.profile.samples.some((id) => !Number.isSafeInteger(id)) ||
      !Array.isArray(profileReport.profile.timeDeltas) ||
      profileReport.profile.timeDeltas.length !==
        profileReport.profile.samples.length ||
      profileReport.profile.timeDeltas.some(
        (delta) => !Number.isFinite(delta) || delta < 0,
      ) ||
      !Number.isFinite(profileReport.profile.startTime) ||
      !Number.isFinite(profileReport.profile.endTime) ||
      profileReport.profile.endTime < profileReport.profile.startTime)
  )
    errors.push('CPU profile summary is incomplete');
  if (
    mode === 'heap' &&
    (!Number.isInteger(profileReport?.nodeCount) ||
      profileReport.nodeCount < 1 ||
      !Number.isInteger(profileReport?.sampleCount) ||
      profileReport.sampleCount < 1 ||
      !Number.isFinite(profileReport?.sampledAllocationBytes) ||
      profileReport.sampledAllocationBytes < 0 ||
      profileReport?.truncated !== false ||
      !Number.isInteger(profileReport?.omittedLocations) ||
      profileReport.omittedLocations < 0)
  )
    errors.push('heap profile summary is incomplete');
  if (
    profileReport?.control?.fixtureReadyGateObserved !== true ||
    profileReport?.control?.loadCompleteGateObserved !== true ||
    profileReport?.control?.profilerStoppedBeforeFinishControl !== true ||
    profileReport?.control?.captureAndTeardownOutsideProfile !== true
  )
    errors.push('profiler control witnesses are incomplete');
  return { valid: errors.length === 0, errors };
}

export async function startImportLoadProfile(
  page,
  mode,
  { timeoutMs = 15_000, cleanupTimeoutMs = 1_000 } = {},
) {
  positiveTimeout(timeoutMs, 'timeoutMs');
  positiveTimeout(cleanupTimeoutMs, 'cleanupTimeoutMs');
  if (mode !== 'cpu' && mode !== 'heap')
    throw new TypeError('Import load profile mode must be cpu or heap');
  if (!page || typeof page.createCDPSession !== 'function')
    throw new TypeError('Invalid import profile page');
  let timedOutCreatingSession = false;
  let lateSession = null;
  let lateDetachStarted = false;
  const sessionPromise = Promise.resolve().then(() => page.createCDPSession());
  sessionPromise.then(
    (session) => {
      lateSession = session;
      if (timedOutCreatingSession && !lateDetachStarted) {
        lateDetachStarted = true;
        bounded(
          Promise.resolve().then(() => session.detach()),
          cleanupTimeoutMs,
          'Late import profile session detach timed out',
        ).catch(() => {});
      }
    },
    () => {},
  );
  let session;
  try {
    session = await bounded(
      sessionPromise,
      timeoutMs,
      'Import profile session creation timed out',
    );
  } catch (error) {
    timedOutCreatingSession = true;
    if (lateSession && !lateDetachStarted) {
      lateDetachStarted = true;
      try {
        await bounded(
          Promise.resolve().then(() => lateSession.detach()),
          cleanupTimeoutMs,
          'Late import profile session detach timed out',
        );
      } catch (cleanupError) {
        error.profileCleanupError = String(
          cleanupError?.message || cleanupError,
        ).slice(0, 240);
      }
    }
    throw error;
  }
  const domain = mode === 'cpu' ? 'Profiler' : 'HeapProfiler';
  let enableAttempted = false;
  let startAttempted = false;
  let stopped = false;
  const detach = () =>
    bounded(
      Promise.resolve().then(() => session.detach()),
      cleanupTimeoutMs,
      'Import profile session detach timed out',
    );
  try {
    enableAttempted = true;
    await bounded(
      Promise.resolve().then(() => session.send(`${domain}.enable`)),
      timeoutMs,
      'Import profile enable timed out',
    );
    if (mode === 'cpu') {
      await bounded(
        Promise.resolve().then(() =>
          session.send('Profiler.setSamplingInterval', { interval: 1000 }),
        ),
        timeoutMs,
        'Import CPU sampling setup timed out',
      );
      startAttempted = true;
      await bounded(
        Promise.resolve().then(() => session.send('Profiler.start')),
        timeoutMs,
        'Import CPU profile start timed out',
      );
    } else {
      startAttempted = true;
      await bounded(
        Promise.resolve().then(() =>
          session.send('HeapProfiler.startSampling', {
            samplingInterval: 16_384,
            stackDepth: 64,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
          }),
        ),
        timeoutMs,
        'Import heap profile start timed out',
      );
    }
  } catch (error) {
    const cleanupErrors = [];
    if (startAttempted) {
      try {
        const method =
          mode === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling';
        await bounded(
          Promise.resolve().then(() => session.send(method)),
          cleanupTimeoutMs,
          'Partial import profile stop timed out',
        );
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (enableAttempted) {
      try {
        await bounded(
          Promise.resolve().then(() => session.send(`${domain}.disable`)),
          cleanupTimeoutMs,
          'Partial import profile disable timed out',
        );
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await detach();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length && error && typeof error === 'object')
      error.profileCleanupError = cleanupErrors
        .map((cleanupError) => String(cleanupError?.message || cleanupError))
        .join('; ')
        .slice(0, 240);
    throw error;
  }

  return {
    async stop() {
      if (stopped) throw new Error('Import load profile already stopped');
      stopped = true;
      let profile;
      let stopError = null;
      try {
        const method =
          mode === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling';
        const response = await bounded(
          Promise.resolve().then(() => session.send(method)),
          timeoutMs,
          'Import load profile stop timed out',
        );
        profile = response?.profile;
      } catch (error) {
        stopError = error;
      } finally {
        try {
          await bounded(
            Promise.resolve().then(() => session.send(`${domain}.disable`)),
            cleanupTimeoutMs,
            'Import profile disable timed out',
          );
        } catch (error) {
          stopError ||= error;
        }
        try {
          await detach();
        } catch (error) {
          stopError ||= error;
        }
      }
      if (stopError) throw stopError;
      const summary =
        mode === 'cpu'
          ? (() => {
              const cpuSummary = summarizeCpuProfile(profile);
              return {
                ...cpuSummary,
                recomputation:
                  'The normalized bounded CPU profile is retained so the summary can be independently recomputed; sample weights remain statistical estimates.',
              };
            })()
          : {
              ...summarizeImportHeapProfile(profile),
              profile: normalizeImportHeapProfile(profile),
              recomputation:
                'The sanitized bounded heap profile tree is retained so this summary can be independently recomputed; sampled bytes remain estimates.',
            };
      return {
        ...summary,
        mode,
        samplingInterval: mode === 'cpu' ? 1000 : 16_384,
        profileScope: IMPORT_LOAD_PROFILE_SCOPE,
        performanceAcceptanceEligible: false,
      };
    },
  };
}
