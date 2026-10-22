import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_NODES = 20_000;
const MAX_SAMPLES = 100_000;
const MAX_CHILD_REFERENCES = 100_000;
const MAX_PROFILE_BYTES = 8 * 1024 * 1024;
const MAX_PROFILE_WINDOW_MS = 60_000;
const PROFILE_OPERATION_TIMEOUT_MS = 2_000;

function publicProfileUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  const publicPath = (pathname) =>
    pathname.length <= 320 &&
    !pathname.includes('..') &&
    (/^\/(?:assets|src|scripts|node_modules|@id)\/[A-Za-z0-9._/@-]+$/.test(
      pathname,
    ) ||
      /^\/cesium\/(?:Cesium\.js|[a-f0-9]{64}\/Cesium\.js)$/.test(pathname));
  if (publicPath(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      publicPath(url.pathname)
      ? url.pathname
      : '[non-fixture source]';
  } catch {
    return '[non-fixture source]';
  }
}

function assertProfile(value, message) {
  if (!value) throw new Error(`Invalid CPU profile: ${message}`);
}

export function normalizeCpuProfile(
  profile,
  {
    maxDurationMs = MAX_PROFILE_WINDOW_MS,
    scope = 'unspecified bounded capture window',
  } = {},
) {
  assertProfile(
    Number.isFinite(maxDurationMs) &&
      maxDurationMs > 0 &&
      maxDurationMs <= MAX_PROFILE_WINDOW_MS + PROFILE_OPERATION_TIMEOUT_MS,
    'maximum duration bound',
  );
  assertProfile(
    Array.isArray(profile?.nodes) &&
      profile.nodes.length > 0 &&
      profile.nodes.length <= MAX_NODES,
    'node bounds',
  );
  assertProfile(
    Array.isArray(profile.samples) &&
      profile.samples.length > 0 &&
      profile.samples.length <= MAX_SAMPLES &&
      Array.isArray(profile.timeDeltas) &&
      profile.timeDeltas.length === profile.samples.length,
    'sample bounds or missing deltas',
  );
  assertProfile(
    Number.isFinite(profile.startTime) &&
      Number.isFinite(profile.endTime) &&
      profile.endTime >= profile.startTime &&
      profile.endTime - profile.startTime <= maxDurationMs * 1000,
    'time bounds',
  );
  const ids = new Set();
  const nodeById = new Map();
  let childReferenceCount = 0;
  const nodes = profile.nodes.map((node) => {
    assertProfile(
      Number.isSafeInteger(node?.id) &&
        !ids.has(node.id) &&
        typeof node?.callFrame?.functionName === 'string',
      'node identity',
    );
    assertProfile(
      node.children === undefined ||
        (Array.isArray(node.children) &&
          node.children.length <= MAX_NODES &&
          node.children.every((childId) => Number.isSafeInteger(childId))),
      'node children',
    );
    childReferenceCount += node.children?.length || 0;
    assertProfile(
      childReferenceCount <= MAX_CHILD_REFERENCES,
      'child count bound',
    );
    ids.add(node.id);
    const normalized = {
      id: node.id,
      callFrame: {
        functionName: node.callFrame.functionName.slice(0, 240),
        scriptId:
          typeof node.callFrame.scriptId === 'string'
            ? node.callFrame.scriptId.slice(0, 80)
            : '',
        url: publicProfileUrl(node.callFrame.url),
        lineNumber: Number.isInteger(node.callFrame.lineNumber)
          ? node.callFrame.lineNumber
          : 0,
        columnNumber: Number.isInteger(node.callFrame.columnNumber)
          ? node.callFrame.columnNumber
          : 0,
      },
      ...(Array.isArray(node.children) ? { children: node.children } : {}),
    };
    nodeById.set(node.id, normalized);
    return normalized;
  });
  for (const node of nodes)
    for (const childId of node.children || [])
      assertProfile(nodeById.has(childId), 'unknown child node');
  const groups = new Map();
  const samples = [...profile.samples];
  const timeDeltas = [...profile.timeDeltas];
  let timestampUs = profile.startTime;
  const ordered = [];
  for (let index = 0; index < samples.length; index += 1) {
    const weightUs = timeDeltas[index];
    assertProfile(
      ids.has(samples[index]) &&
        Number.isFinite(weightUs) &&
        Number.isFinite((timestampUs += weightUs)) &&
        timestampUs >= profile.startTime &&
        timestampUs <= profile.endTime,
      'sample identity or timing',
    );
    ordered.push({ nodeId: samples[index], timestampUs, index });
  }
  ordered.sort(
    (left, right) =>
      left.timestampUs - right.timestampUs || left.index - right.index,
  );
  let previousTimestampUs = profile.startTime;
  for (const entry of ordered) {
    const sampleWeightUs = entry.timestampUs - previousTimestampUs;
    previousTimestampUs = entry.timestampUs;
    const node = nodeById.get(entry.nodeId);
    const frame = node.callFrame;
    const key = JSON.stringify([
      frame.functionName,
      frame.url,
      frame.lineNumber,
      frame.columnNumber,
    ]);
    const group = groups.get(key) || {
      functionName: frame.functionName,
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
      samples: 0,
      sampledWeightMs: 0,
    };
    group.samples += 1;
    group.sampledWeightMs += sampleWeightUs / 1000;
    groups.set(key, group);
  }
  const topLocations = [...groups.values()]
    .sort((left, right) => right.sampledWeightMs - left.sampledWeightMs)
    .slice(0, 30);
  return {
    schema: 'gev-sampled-cpu-attribution/v1',
    scope: `Sampled main-thread stacks for ${String(scope).slice(0, 160)}, including idle and garbage collection. Sample weights are statistical attribution, not precise CPU execution, GPU timing, or performance acceptance.`,
    performanceAcceptanceEligible: false,
    profileWindowMs: (profile.endTime - profile.startTime) / 1000,
    nodeCount: nodes.length,
    sampleCount: samples.length,
    topLocations,
    profile: {
      startTime: profile.startTime,
      endTime: profile.endTime,
      nodes,
      samples,
      timeDeltas,
    },
  };
}

function safeProfilerError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'<>]+[\\/])*[^\s"'<>]*/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 180);
}

function timeout(promise, timeoutMs, label) {
  let timer;
  const bounded = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${timeoutMs} ms.`)),
      timeoutMs,
    );
    Promise.resolve(promise).then(resolve, reject);
  });
  return bounded.finally(() => clearTimeout(timer));
}

async function safeSend(session, method, params, timeoutMs) {
  return timeout(session.send(method, params), timeoutMs, method);
}

async function cleanupSession(session, state, timeoutMs) {
  const errors = [];
  if (state.startAttempted) {
    try {
      await safeSend(session, 'Profiler.stop', undefined, timeoutMs);
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 180));
    }
  }
  if (state.enableAttempted) {
    try {
      await safeSend(session, 'Profiler.disable', undefined, timeoutMs);
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 180));
    }
  }
  try {
    await timeout(session.detach(), timeoutMs, 'Profiler detach');
  } catch (error) {
    errors.push(String(error?.message || error).slice(0, 180));
  }
  return errors;
}

/**
 * Profile one existing render-boundary operation. Profiler failures are
 * recorded separately; they never replace an error from the render boundary.
 */
export async function runBoundedBoundaryProfile({
  page,
  label,
  artifactDirectory,
  fileName,
  operation,
  target = null,
  onStarted = () => {},
  onProfile = () => {},
  indexFileName = null,
  maxWindowMs = null,
  operationTimeoutMs = PROFILE_OPERATION_TIMEOUT_MS,
}) {
  if (
    !Number.isInteger(operationTimeoutMs) ||
    operationTimeoutMs < 1 ||
    operationTimeoutMs > PROFILE_OPERATION_TIMEOUT_MS
  )
    throw new TypeError(
      'Profiler operation timeout must be a positive integer.',
    );
  if (!/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(fileName))
    throw new TypeError('Profile artifact filename is invalid.');
  if (
    indexFileName !== null &&
    !/^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(indexFileName)
  )
    throw new TypeError('Profile index filename is invalid.');
  if (
    maxWindowMs !== null &&
    (!Number.isInteger(maxWindowMs) ||
      maxWindowMs < 1 ||
      maxWindowMs > MAX_PROFILE_WINDOW_MS)
  )
    throw new TypeError(
      `Profile window cap must be between 1 and ${MAX_PROFILE_WINDOW_MS} ms.`,
    );
  const record = {
    schema: 'gev-render-boundary-cpu-profile-ref/v1',
    label: String(label).slice(0, 80),
    status: 'incomplete',
    performanceAcceptanceEligible: false,
    target,
    fileName,
    sha256: null,
    byteLength: null,
    profilerErrors: [],
    lateSessionCleanup: null,
  };
  let indexWrite = Promise.resolve();
  const persistIndex = () => {
    if (!indexFileName) return indexWrite;
    const indexPath = path.join(artifactDirectory, indexFileName);
    const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;
    const bytes = Buffer.from(
      `${JSON.stringify({
        schema: 'gev-provider-sample-cpu-profile-index/v1',
        performanceAcceptanceEligible: false,
        target,
        profile: record,
      })}\n`,
      'utf8',
    );
    if (bytes.byteLength > 16 * 1024)
      return Promise.reject(
        new Error('CPU profile index exceeded the artifact bound.'),
      );
    indexWrite = indexWrite.then(async () => {
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(temporaryPath, bytes, { flag: 'wx' });
      try {
        await rename(temporaryPath, indexPath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    return indexWrite;
  };
  let session = null;
  const state = {
    enableAttempted: false,
    startAttempted: false,
    startConfirmed: false,
  };
  let profile = null;
  let primaryError = null;
  let operationResult;
  let windowCapTimer = null;
  let windowCapReached = false;

  try {
    const createSession = Promise.resolve().then(() => page.createCDPSession());
    try {
      session = await timeout(
        createSession,
        operationTimeoutMs,
        'Profiler session creation',
      );
    } catch (error) {
      record.lateSessionCleanup = 'pending';
      createSession
        .then(async (lateSession) => {
          const errors = await cleanupSession(
            lateSession,
            state,
            operationTimeoutMs,
          );
          record.lateSessionCleanup = errors.length ? 'failed' : 'confirmed';
          record.profilerErrors.push(...errors.map(safeProfilerError));
          record.status = 'incomplete';
          await persistIndex();
        })
        .catch(async (lateError) => {
          record.lateSessionCleanup = 'creation-rejected';
          record.profilerErrors.push(safeProfilerError(lateError));
          record.status = 'incomplete';
          await persistIndex().catch(() => {});
        });
      throw error;
    }
    state.enableAttempted = true;
    await safeSend(session, 'Profiler.enable', undefined, operationTimeoutMs);
    await safeSend(
      session,
      'Profiler.setSamplingInterval',
      { interval: 1000 },
      operationTimeoutMs,
    );
    state.startAttempted = true;
    await safeSend(session, 'Profiler.start', undefined, operationTimeoutMs);
    state.startConfirmed = true;
  } catch (error) {
    record.profilerErrors.push(safeProfilerError(error));
  }

  try {
    await onStarted({ profilerStarted: state.startConfirmed });
  } catch (error) {
    record.profilerErrors.push(
      `start callback: ${safeProfilerError(error).slice(0, 140)}`,
    );
  }

  try {
    const operationPromise = Promise.resolve().then(operation);
    operationPromise.catch(() => {});
    if (maxWindowMs === null) operationResult = await operationPromise;
    else {
      let capTimer;
      const cap = new Promise((resolve) => {
        capTimer = setTimeout(() => resolve({ kind: 'cap' }), maxWindowMs);
      });
      windowCapTimer = capTimer;
      const outcome = await Promise.race([
        operationPromise.then(
          (value) => ({ kind: 'value', value }),
          (error) => ({ kind: 'error', error }),
        ),
        cap,
      ]);
      clearTimeout(capTimer);
      windowCapTimer = null;
      if (outcome.kind === 'cap') windowCapReached = true;
      else if (outcome.kind === 'error') primaryError = outcome.error;
      else operationResult = outcome.value;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (windowCapTimer) clearTimeout(windowCapTimer);
  }

  if (session && state.startAttempted) {
    try {
      const result = await safeSend(
        session,
        'Profiler.stop',
        undefined,
        operationTimeoutMs,
      );
      profile = result?.profile;
      if (!profile) throw new Error('Profiler stop returned no profile.');
    } catch (error) {
      record.profilerErrors.push(safeProfilerError(error));
    }
  }
  if (session) {
    const cleanupErrors = await cleanupSession(
      session,
      {
        enableAttempted: state.enableAttempted,
        startAttempted: false,
      },
      operationTimeoutMs,
    );
    record.profilerErrors.push(...cleanupErrors.map(safeProfilerError));
  }

  record.windowCapReached = windowCapReached;
  record.windowCapMs = windowCapReached ? maxWindowMs : null;

  if (profile) {
    try {
      const deliveryOverheadLimitMs = operationTimeoutMs;
      const normalized = normalizeCpuProfile(profile, {
        maxDurationMs:
          (maxWindowMs ?? MAX_PROFILE_WINDOW_MS) + deliveryOverheadLimitMs,
        scope: label,
      });
      const profileWindowMs = normalized.profileWindowMs;
      const stopOverrunMs = Math.max(
        0,
        profileWindowMs - (maxWindowMs ?? MAX_PROFILE_WINDOW_MS),
      );
      const stopOverrun = stopOverrunMs > 0;
      const bytes = Buffer.from(`${JSON.stringify(normalized)}\n`, 'utf8');
      if (bytes.byteLength > MAX_PROFILE_BYTES)
        throw new Error('Normalized CPU profile exceeded the artifact bound.');
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(path.join(artifactDirectory, fileName), bytes, {
        flag: 'wx',
      });
      record.sha256 = createHash('sha256').update(bytes).digest('hex');
      record.byteLength = bytes.byteLength;
      record.profileWindowMs = profileWindowMs;
      record.stopOverrunMs = stopOverrunMs;
      record.status =
        record.profilerErrors.length === 0 && !windowCapReached && !stopOverrun
          ? 'complete'
          : 'incomplete';
    } catch (error) {
      record.profilerErrors.push(safeProfilerError(error));
    }
  }
  try {
    await persistIndex();
  } catch (error) {
    record.profilerErrors.push(
      `index: ${safeProfilerError(error).slice(0, 140)}`,
    );
    record.status = 'incomplete';
  }
  try {
    await onProfile(record);
  } catch {
    // A diagnostic index must never replace the render operation's outcome.
  }
  if (primaryError) {
    try {
      primaryError.renderBoundaryCpuProfile = record;
    } catch {
      // Preserve the original boundary failure even for immutable error objects.
    }
    throw primaryError;
  }
  return { value: operationResult, profile: record };
}
