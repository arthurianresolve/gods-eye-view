import { summarizeCpuProfile } from './sampledCpuProfile.mjs';

const MAX_HEAP_PROFILE_NODES = 50_000;
const MAX_HEAP_PROFILE_DEPTH = 64;
const MAX_PROFILE_LOCATIONS = 30;

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

export function summarizeImportHeapProfile(profile) {
  if (!profile?.head || typeof profile.head !== 'object')
    throw new Error('Invalid loading heap profile: missing root');
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
      'HeapProfiler sampled allocation callsites during one warmed cooperative load; sampled bytes are estimates, not exact allocation totals or retained-memory evidence.',
    performanceAcceptanceEligible: false,
    nodeCount,
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
    fixtureReport?.samples?.length !== 1 ||
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
    !fixtureReport?.checks?.some(
      (check) =>
        check.id ===
          'single-profiled-load-separated-from-capture-and-teardown' &&
        check.status === 'passed',
    )
  )
    errors.push('profile separation check is missing');
  if (
    profileReport?.mode !== mode ||
    profileReport?.performanceAcceptanceEligible !== false ||
    profileReport?.profileScope !== 'single warmed cooperative load only'
  )
    errors.push('profiler report mode or scope mismatch');
  if (
    mode === 'cpu' &&
    (!Number.isInteger(profileReport?.sampleCount) ||
      profileReport.sampleCount < 1)
  )
    errors.push('CPU profile has no sample count');
  if (
    mode === 'heap' &&
    (!Number.isInteger(profileReport?.nodeCount) ||
      !Number.isFinite(profileReport?.sampledAllocationBytes) ||
      profileReport.sampledAllocationBytes < 0)
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
  const session = await bounded(
    Promise.resolve().then(() => page.createCDPSession()),
    timeoutMs,
    'Import profile session creation timed out',
  );
  const domain = mode === 'cpu' ? 'Profiler' : 'HeapProfiler';
  let started = false;
  let stopped = false;
  const detach = () =>
    bounded(
      Promise.resolve().then(() => session.detach()),
      cleanupTimeoutMs,
      'Import profile session detach timed out',
    );
  try {
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
      await bounded(
        Promise.resolve().then(() => session.send('Profiler.start')),
        timeoutMs,
        'Import CPU profile start timed out',
      );
    } else {
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
    started = true;
  } catch (error) {
    try {
      await detach();
    } catch (cleanupError) {
      error.profileCleanupError = String(
        cleanupError?.message || cleanupError,
      ).slice(0, 240);
    }
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
        if (started) {
          try {
            await bounded(
              Promise.resolve().then(() => session.send(`${domain}.disable`)),
              cleanupTimeoutMs,
              'Import profile disable timed out',
            );
          } catch (error) {
            stopError ||= error;
          }
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
              const { profile: _boundedProfile, ...cpuSummary } =
                summarizeCpuProfile(profile);
              return cpuSummary;
            })()
          : summarizeImportHeapProfile(profile);
      return {
        ...summary,
        mode,
        samplingInterval: mode === 'cpu' ? 1000 : 16_384,
        profileScope: 'single warmed cooperative load only',
        performanceAcceptanceEligible: false,
      };
    },
  };
}
