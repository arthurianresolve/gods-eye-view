import { validateRecordingRegion, isWithinRecordingRegion } from './regions.js';

export const MAX_AIRCRAFT_RECORDING_MS = 60 * 60 * 1000;
export const MAX_AIRCRAFT_RECORDING_BYTES = 100 * 1024 * 1024;
export const MAX_APPLICATION_RECORDING_BYTES = 250 * 1024 * 1024;
const DEFAULT_CHUNK_RECORDS = 128;
const DEFAULT_SILENCE_MS = 2 * 60 * 1000;

const BUILTIN_POLICIES = Object.freeze({
  'synthetic-fixture': Object.freeze({
    policyId: 'synthetic-fixture-v1',
    retentionAllowed: true,
    exportAllowed: true,
  }),
});

function epoch(value, label) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result))
    throw new TypeError(`${label} must be a valid time`);
  return result;
}

function nonempty(value, label) {
  const result = String(value ?? '').trim();
  if (!result || result.length > 128)
    throw new TypeError(`${label} is required`);
  return result;
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeObservation(record, sourceId, receivedAt) {
  const id = nonempty(
    record.id ?? record.icao24 ?? record.entityId,
    'Aircraft identity',
  );
  const observedAt = epoch(
    record.observedAt ?? record.timeMs,
    'Observation time',
  );
  const latitude = Number(record.latitude ?? record.lat);
  const longitude = Number(record.longitude ?? record.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    throw new RangeError('Aircraft latitude is invalid');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    throw new RangeError('Aircraft longitude is invalid');
  const normalized = {
    observationId: `${encodeURIComponent(id)}@${observedAt}`,
    entityId: id,
    sourceId,
    observedAt,
    receivedAt,
    latitude,
    longitude,
    method: 'observed',
  };
  const fields = [
    ['callsign', (value) => String(value).trim().slice(0, 32)],
    ['altitudeM', Number],
    ['velocityMps', Number],
    ['headingDeg', Number],
    ['onGround', Boolean],
  ];
  for (const [key, convert] of fields) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      const converted = convert(value);
      if (typeof converted !== 'number' || Number.isFinite(converted))
        normalized[key] = converted;
    }
  }
  return normalized;
}

function signature(record) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(record)
        .filter(
          ([key]) =>
            ![
              'observationId',
              'receivedAt',
              'correction',
              'correctionOf',
            ].includes(key),
        )
        .sort(([first], [second]) => first.localeCompare(second)),
    ),
  );
}

function splitIntoChunks(rows, chunkSize) {
  const chunks = {};
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = String(Math.floor(offset / chunkSize)).padStart(6, '0');
    chunks[`observations-${chunk}`] = rows.slice(offset, offset + chunkSize);
  }
  return chunks;
}

/** Local, bounded recorder. Only explicitly registered retention policies can record. */
export function createAircraftRecordingService({
  storage,
  investigationTime,
  now = () => investigationTime?.wallNow?.() ?? Date.now(),
  policies = BUILTIN_POLICIES,
  maxDurationMs = MAX_AIRCRAFT_RECORDING_MS,
  maxRecordingBytes = MAX_AIRCRAFT_RECORDING_BYTES,
  maxTotalBytes = MAX_APPLICATION_RECORDING_BYTES,
  chunkRecordLimit = DEFAULT_CHUNK_RECORDS,
  silenceMs = DEFAULT_SILENCE_MS,
  checkIntervalMs = 15_000,
  setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval,
} = {}) {
  if (!storage?.commitWorkspace || !storage?.getWorkspace)
    throw new TypeError('Durable workspace storage is required');
  if (
    typeof now !== 'function' ||
    typeof schedule !== 'function' ||
    typeof cancel !== 'function'
  )
    throw new TypeError('Recording clock dependencies must be functions');
  if (
    !Number.isInteger(chunkRecordLimit) ||
    chunkRecordLimit < 1 ||
    chunkRecordLimit > 4096
  )
    throw new RangeError('Recording chunk size must be between 1 and 4096');

  const listeners = new Set();
  let active = null;
  let timer = null;
  let destroyed = false;
  let starting = false;
  let recordingSequence = 0;

  const snapshot = () =>
    active
      ? Object.freeze({
          id: active.id,
          status: active.status,
          startedAt: active.startedAt,
          endedAt: active.endedAt,
          stopReason: active.stopReason,
          persistenceError: active.persistenceError || null,
          observationCount: active.observations.length,
          gapCount: active.gaps.length + (active.openGap ? 1 : 0),
          bytes: active.bytes,
          revision: active.revision,
          region: active.region,
          sourceId: active.sourceId,
        })
      : null;
  const publish = () => {
    const state = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Observers cannot block a recording transition.
      }
    }
    return state;
  };

  function ensureAvailable() {
    if (destroyed) throw new Error('Aircraft recording service is closed');
    if (!storage.savedByBrowser)
      throw Object.assign(
        new Error(
          'Recording needs persistent browser storage; current changes are unsaved.',
        ),
        { code: 'storage-not-persistent' },
      );
  }

  function resolvePolicy(sourceId) {
    const policy = policies[sourceId];
    if (
      !policy?.policyId ||
      policy.retentionAllowed !== true ||
      policy.exportAllowed !== true
    )
      throw Object.assign(
        new Error(
          `Recording is disabled because ${sourceId} has no approved retention and export policy.`,
        ),
        { code: 'retention-not-approved' },
      );
    return Object.freeze({
      policyId: String(policy.policyId),
      retentionAllowed: true,
      exportAllowed: true,
    });
  }

  function documentFor(session) {
    return {
      kind: 'aircraft-recording',
      schemaVersion: 1,
      id: session.id,
      status: session.status,
      sourceId: session.sourceId,
      sourcePolicy: session.policy,
      region: session.region,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      lastReceivedAt: session.lastReceivedAt,
      stopReason: session.stopReason,
      bytes: session.bytes,
      interrupted: session.status === 'interrupted',
    };
  }

  function chunksFor(session) {
    return {
      ...splitIntoChunks(session.observations, chunkRecordLimit),
      gaps: session.gaps,
    };
  }

  function measure(session) {
    let doc;
    let chunks;
    let total;
    for (let pass = 0; pass < 3; pass++) {
      doc = documentFor(session);
      chunks = chunksFor(session);
      total =
        byteLength(doc) +
        Object.values(chunks).reduce(
          (sum, chunk) => sum + byteLength(chunk),
          0,
        );
      if (session.bytes === total) break;
      session.bytes = total;
    }
    return {
      doc: documentFor(session),
      chunks: chunksFor(session),
      total: session.bytes,
    };
  }

  async function globalBytesExcept(id) {
    const rows = await storage.listWorkspaces();
    return rows.reduce(
      (sum, row) => sum + (row.id === id ? 0 : Number(row.bytes) || 0),
      0,
    );
  }

  async function persist(session) {
    const { doc, chunks, total } = measure(session);
    session.bytes = total;
    if (total > maxRecordingBytes)
      throw Object.assign(new Error('Recording reached its byte limit.'), {
        code: 'recording-byte-limit',
      });
    if ((await globalBytesExcept(session.id)) + total > maxTotalBytes)
      throw Object.assign(
        new Error('Application recordings reached their storage limit.'),
        { code: 'application-byte-limit' },
      );
    const saved = await storage.commitWorkspace({
      id: session.id,
      expectedRevision: session.revision,
      document: doc,
      chunks,
    });
    session.revision = saved.revision;
    return saved;
  }

  function createSession({ id, region, sourceId, policy }) {
    const startedAt = epoch(now(), 'Start time');
    return {
      id,
      region: validateRecordingRegion(region),
      sourceId,
      policy,
      startedAt,
      endedAt: null,
      lastReceivedAt: startedAt,
      status: 'active',
      stopReason: null,
      observations: [],
      gaps: [],
      observedByKey: new Map(),
      revision: 0,
      bytes: 0,
      openGap: null,
    };
  }

  async function start({ id, region, sourceId = 'synthetic-fixture' } = {}) {
    ensureAvailable();
    if (active?.status === 'active' || starting)
      throw Object.assign(
        new Error('Only one aircraft recording can be active.'),
        { code: 'recording-active' },
      );
    const recordingId = nonempty(
      id || `recording-${Math.trunc(now())}-${++recordingSequence}`,
      'Recording id',
    );
    if (!/^recording-[A-Za-z0-9._:-]{1,110}$/.test(recordingId))
      throw new TypeError(
        'Recording id must start with recording- and contain only safe characters',
      );
    const source = nonempty(sourceId, 'Source id');
    const session = createSession({
      id: recordingId,
      region,
      sourceId: source,
      policy: resolvePolicy(source),
    });
    starting = true;
    try {
      await persist(session);
      active = session;
      if (timer === null)
        timer = schedule(() => {
          void check().catch(() => {});
        }, checkIntervalMs);
      return publish();
    } finally {
      starting = false;
    }
  }

  function openGap(reason, from = now()) {
    if (!active || active.status !== 'active' || active.openGap) return;
    active.openGap = {
      startedAt: epoch(from, 'Gap start'),
      reason: String(reason || 'provider-unavailable').slice(0, 80),
    };
  }

  function closeGap(at = now()) {
    if (!active?.openGap) return;
    active.gaps.push({
      startedAt: active.openGap.startedAt,
      endedAt: Math.max(active.openGap.startedAt, epoch(at, 'Gap end')),
      reason: active.openGap.reason,
      method: 'observed-gap',
    });
    active.openGap = null;
  }

  async function stop(reason = 'user') {
    if (!active || active.status !== 'active') return publish();
    const session = active;
    closeGap(now());
    session.endedAt = epoch(now(), 'End time');
    session.status = reason === 'interrupted' ? 'interrupted' : 'complete';
    session.stopReason = String(reason).slice(0, 80);
    try {
      await persist(session);
    } catch (error) {
      session.persistenceError = error.code || 'storage-error';
      session.status = 'interrupted';
      session.stopReason = error.code || 'storage-error';
      session.endedAt = epoch(now(), 'End time');
    }
    if (timer !== null) cancel(timer);
    timer = null;
    publish();
    return publish();
  }

  async function check() {
    if (!active || active.status !== 'active') return publish();
    const current = epoch(now(), 'Current time');
    if (current - active.startedAt >= maxDurationMs)
      return stop('duration-limit');
    if (current - active.lastReceivedAt >= silenceMs)
      openGap('provider-silent', active.lastReceivedAt + silenceMs);
    if (active.openGap) {
      try {
        await persist(active);
      } catch (error) {
        return stop(error.code || 'storage-error');
      }
    }
    return publish();
  }

  async function noteSourceUnavailable(reason = 'provider-unavailable') {
    if (!active || active.status !== 'active') return publish();
    openGap(reason, now());
    try {
      await persist(active);
    } catch (error) {
      return stop(error.code || 'storage-error');
    }
    return publish();
  }

  function rebuildIdentityIndex(session) {
    session.observedByKey.clear();
    for (const row of session.observations) {
      const key = `${row.entityId}\u0000${row.observedAt}`;
      session.observedByKey.set(key, row);
    }
  }

  async function ingest({
    sourceId = active?.sourceId,
    observations = [],
    receivedAt = now(),
    status = 'ok',
  } = {}) {
    if (!active || active.status !== 'active')
      throw Object.assign(new Error('No active aircraft recording.'), {
        code: 'no-active-recording',
      });
    if (sourceId !== active.sourceId)
      throw Object.assign(
        new Error('Snapshot source does not match the active recording.'),
        { code: 'source-mismatch' },
      );
    const receipt = epoch(receivedAt, 'Receipt time');
    await check();
    if (!active || active.status !== 'active') return publish();
    const session = active;
    const priorState = {
      observations: session.observations.slice(),
      gaps: session.gaps.slice(),
      observedByKey: new Map(session.observedByKey),
      lastReceivedAt: session.lastReceivedAt,
      bytes: session.bytes,
      openGap: session.openGap ? { ...session.openGap } : null,
    };
    if (status !== 'ok') {
      openGap(status, receipt);
      session.lastReceivedAt = receipt;
      try {
        await persist(session);
      } catch (error) {
        return stop(error.code || 'storage-error');
      }
      return publish();
    }
    closeGap(receipt);
    session.lastReceivedAt = receipt;
    const accepted = [];
    let duplicates = 0;
    let outsideRegion = 0;
    for (const item of observations) {
      let record;
      try {
        record = normalizeObservation(item, session.sourceId, receipt);
      } catch {
        continue;
      }
      if (!isWithinRecordingRegion(session.region, record)) {
        outsideRegion++;
        continue;
      }
      const key = `${record.entityId}\u0000${record.observedAt}`;
      const prior = session.observedByKey.get(key);
      if (prior && signature(prior) === signature(record)) {
        duplicates++;
        continue;
      }
      if (prior) {
        record.correctionOf = prior.observationId;
        record.correction = (prior.correction || 0) + 1;
        record.observationId = `${record.observationId}#${record.correction}`;
      }
      const candidate = {
        ...session,
        observations: [...session.observations, ...accepted, record],
      };
      const { total } = measure(candidate);
      const appBytes = await globalBytesExcept(session.id);
      if (total > maxRecordingBytes || appBytes + total > maxTotalBytes) {
        const stopReason =
          total > maxRecordingBytes
            ? 'recording-byte-limit'
            : 'application-byte-limit';
        if (accepted.length) {
          session.observations.push(...accepted);
          rebuildIdentityIndex(session);
        }
        await stop(stopReason);
        return {
          ...publish(),
          duplicates,
          outsideRegion,
          stoppedAtLimit: true,
        };
      }
      accepted.push(record);
      session.observedByKey.set(key, record);
    }
    session.observations.push(...accepted);
    try {
      await persist(session);
    } catch (error) {
      session.observations = priorState.observations;
      session.gaps = priorState.gaps;
      session.observedByKey = priorState.observedByKey;
      session.lastReceivedAt = priorState.lastReceivedAt;
      session.bytes = priorState.bytes;
      session.openGap = priorState.openGap;
      const stopped = await stop(error.code || 'storage-error');
      return { ...stopped, persistenceError: error.code || 'storage-error' };
    }
    return {
      ...publish(),
      duplicates,
      outsideRegion,
      accepted: accepted.length,
    };
  }

  async function exportRecording(id) {
    const workspace = await storage.getWorkspace(nonempty(id, 'Recording id'));
    if (!workspace || workspace.document.kind !== 'aircraft-recording')
      return null;
    if (workspace.document.sourcePolicy?.exportAllowed !== true)
      throw Object.assign(
        new Error('This recording policy does not permit export.'),
        { code: 'export-not-approved' },
      );
    return Object.freeze({
      format: 'gods-eye-view-aircraft-recording',
      schemaVersion: 1,
      document: workspace.document,
      chunks: workspace.chunks,
    });
  }

  async function deleteRecording(id) {
    const workspace = await storage.getWorkspace(nonempty(id, 'Recording id'));
    if (!workspace || workspace.document.kind !== 'aircraft-recording')
      return false;
    if (active?.id === id && active.status === 'active') await stop('deleted');
    const latest = await storage.getWorkspace(id);
    return storage.deleteWorkspace(id, {
      expectedRevision: latest.manifest.revision,
    });
  }

  async function recoverInterrupted() {
    ensureAvailable();
    const rows = await storage.listWorkspaces();
    const recovered = [];
    for (const row of rows) {
      const workspace = await storage.getWorkspace(row.id);
      const doc = workspace?.document;
      if (doc?.kind !== 'aircraft-recording' || doc.status !== 'active')
        continue;
      const endedAt = epoch(now(), 'Recovery time');
      const gaps = workspace.chunks.gaps || [];
      gaps.push({
        startedAt:
          Number(doc.lastReceivedAt) || Number(doc.startedAt) || endedAt,
        endedAt,
        reason: 'page-lifecycle-interrupted',
        method: 'observed-gap',
      });
      const saved = await storage.commitWorkspace({
        id: row.id,
        expectedRevision: workspace.manifest.revision,
        document: {
          ...doc,
          status: 'interrupted',
          interrupted: true,
          endedAt,
          stopReason: 'page-lifecycle-interrupted',
        },
        chunks: { ...workspace.chunks, gaps },
        assets: workspace.assets,
      });
      recovered.push({ id: row.id, revision: saved.revision });
    }
    return recovered;
  }

  return Object.freeze({
    getState: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Listener must be a function');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    start,
    stop,
    check,
    ingest,
    noteSourceUnavailable,
    exportRecording,
    deleteRecording,
    recoverInterrupted,
    async interrupt() {
      return stop('interrupted');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      if (timer !== null) cancel(timer);
      timer = null;
    },
  });
}
