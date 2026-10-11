/** Hosted fixture attribution only. Sample weights are not CPU/GPU timings. */
const MAX_NODES = 50_000;
const MAX_SAMPLES = 250_000;
const requireValid = (value, message) => {
  if (!value) throw new Error(`Invalid CPU profile: ${message}`);
};

function publicFixturePath(value) {
  if (!value) return '';
  // A downloaded, sanitized profile can be independently summarized again.
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

export function summarizeCpuProfile(profile) {
  requireValid(
    Array.isArray(profile?.nodes) &&
      profile.nodes.length > 0 &&
      profile.nodes.length <= MAX_NODES,
    'node bounds',
  );
  requireValid(
    Array.isArray(profile.samples) &&
      profile.samples.length > 0 &&
      profile.samples.length <= MAX_SAMPLES &&
      Array.isArray(profile.timeDeltas) &&
      profile.timeDeltas.length === profile.samples.length,
    'sample bounds or missing deltas',
  );
  requireValid(
    Number.isFinite(profile.startTime) &&
      Number.isFinite(profile.endTime) &&
      profile.endTime >= profile.startTime,
    'time bounds',
  );
  const nodes = new Map();
  for (const node of profile.nodes) {
    requireValid(
      Number.isSafeInteger(node?.id) &&
        !nodes.has(node.id) &&
        node.callFrame &&
        typeof node.callFrame.functionName === 'string',
      'node identity',
    );
    nodes.set(node.id, node);
  }
  const groups = new Map();
  let totalWeightUs = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const node = nodes.get(profile.samples[index]);
    const weightUs = profile.timeDeltas[index];
    if (!node || !Number.isFinite(weightUs) || weightUs < 0) {
      const error = new Error(
        'Invalid CPU profile: unknown sample or invalid weight',
      );
      // Preserve the failing scalar observation without source URLs, stacks or
      // an unbounded profile. Invalid data must not become a timing summary.
      error.profileFailureEvidence = {
        schema: 'gev-cpu-profile-invalid-sample/v1',
        performanceAcceptanceEligible: false,
        nodeCount: nodes.size,
        sampleCount: profile.samples.length,
        profileWindowUs: profile.endTime - profile.startTime,
        index,
        nodeId: Number.isSafeInteger(profile.samples[index])
          ? profile.samples[index]
          : null,
        knownNode: Boolean(node),
        weightUs: Number.isFinite(weightUs) ? weightUs : null,
        reason: !node
          ? 'unknown-node'
          : !Number.isFinite(weightUs)
            ? 'nonfinite-weight'
            : 'negative-weight',
      };
      throw error;
    }
    const frame = node.callFrame;
    const url = publicFixturePath(frame.url);
    const key = JSON.stringify([
      frame.functionName,
      url,
      frame.lineNumber,
      frame.columnNumber,
    ]);
    const group = groups.get(key) || {
      functionName: frame.functionName,
      url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
      samples: 0,
      sampledWeightMs: 0,
    };
    group.samples++;
    group.sampledWeightMs += weightUs / 1000;
    groups.set(key, group);
    totalWeightUs += weightUs;
  }
  const ranked = [...groups.values()].sort(
    (left, right) => right.sampledWeightMs - left.sampledWeightMs,
  );
  return {
    schema: 'gev-sampled-cpu-attribution/v1',
    scope:
      'sample-weighted main-thread stacks including idle and garbage collection; not precise CPU execution, GPU timing, or performance acceptance',
    performanceAcceptanceEligible: false,
    profileWindowMs: (profile.endTime - profile.startTime) / 1000,
    totalSampleWeightMs: totalWeightUs / 1000,
    nodeCount: nodes.size,
    sampleCount: profile.samples.length,
    groupedLocations: ranked.length,
    topLocations: ranked.slice(0, 30),
    omittedLocations: Math.max(0, ranked.length - 30),
    profile: {
      startTime: profile.startTime,
      endTime: profile.endTime,
      nodes: profile.nodes.map((node) => ({
        id: node.id,
        callFrame: {
          functionName: node.callFrame.functionName,
          scriptId: node.callFrame.scriptId,
          url: publicFixturePath(node.callFrame.url),
          lineNumber: node.callFrame.lineNumber,
          columnNumber: node.callFrame.columnNumber,
        },
        ...(node.children ? { children: node.children } : {}),
      })),
      samples: profile.samples,
      timeDeltas: profile.timeDeltas,
    },
  };
}

/** Own one profiler session; partial startup and all stop paths detach it. */
export async function startFixtureCpuProfile(page) {
  const session = await page.createCDPSession();
  let stopped = false;
  try {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 1000 });
    await session.send('Profiler.start');
  } catch (error) {
    await session.detach();
    throw error;
  }
  return {
    async stop() {
      if (stopped) throw new Error('CPU profile already stopped');
      stopped = true;
      try {
        const { profile } = await session.send('Profiler.stop');
        return summarizeCpuProfile(profile);
      } finally {
        try {
          await session.send('Profiler.disable');
        } finally {
          await session.detach();
        }
      }
    },
  };
}
