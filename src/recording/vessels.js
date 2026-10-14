import { isWithinRecordingRegion, validateRecordingRegion } from './regions.js';

export const MAX_VESSEL_RECORDING_MS = 60 * 60 * 1000;
export const MAX_VESSEL_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_APPLICATION_RECORDING_BYTES = 250 * 1024 * 1024;

const SYNTHETIC_POLICY = Object.freeze({
  'synthetic-vessel-fixture': Object.freeze({
    policyId: 'synthetic-vessel-fixture-v1',
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

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalizedPosition(row, sourceId, receivedAt) {
  const id = String(row?.id ?? row?.mmsi ?? '').trim();
  const latitude = Number(row?.latitude ?? row?.lat);
  const longitude = Number(row?.longitude ?? row?.lon);
  const observedAt = epoch(
    row?.observedAtMs ?? row?.observedAt,
    'Position time',
  );
  if (!id || id.length > 32) return null;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  return {
    observationId: `${encodeURIComponent(id)}@${observedAt}`,
    entityId: id,
    sourceId,
    observedAt,
    receivedAt,
    latitude,
    longitude,
    speedMps: finiteOrNull(row?.speedMps),
    courseDeg: finiteOrNull(row?.courseDeg),
    headingDeg: finiteOrNull(row?.headingDeg),
    method: 'observed',
  };
}

function metadataFields(row) {
  return Object.freeze({
    name: String(row?.name || row?.input_name || '').slice(0, 160),
    imo: String(row?.imo || '').slice(0, 32),
    type: String(row?.type || row?.type_specific || '').slice(0, 80),
    destination: String(row?.destination || '').slice(0, 160),
  });
}

function positionSignature(row) {
  return JSON.stringify([
    row.latitude,
    row.longitude,
    row.speedMps,
    row.courseDeg,
    row.headingDeg,
  ]);
}

/** Bounded local AIS history; live AIS is denied until its retention terms are approved. */
export function createVesselRecordingService({
  storage,
  now = () => Date.now(),
  policies = SYNTHETIC_POLICY,
  maxDurationMs = MAX_VESSEL_RECORDING_MS,
  maxRecordingBytes = MAX_VESSEL_RECORDING_BYTES,
  maxTotalBytes = MAX_APPLICATION_RECORDING_BYTES,
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
    throw new TypeError('Recorder dependencies must be functions');
  let active = null;
  let timer = null;
  let destroyed = false;
  let starting = false;
  const listeners = new Set();

  function snapshot(extra = {}) {
    return active
      ? Object.freeze({
          id: active.id,
          status: active.status,
          sourceId: active.sourceId,
          startedAt: active.startedAt,
          endedAt: active.endedAt,
          stopReason: active.stopReason,
          persistenceError: active.persistenceError || null,
          positionCount: active.positions.length,
          metadataCount: active.metadata.length,
          gapCount: active.gaps.length + (active.openGap ? 1 : 0),
          bytes: active.bytes,
          revision: active.revision,
          region: active.region,
          ...extra,
        })
      : null;
  }

  function publish(extra = {}) {
    const state = snapshot(extra);
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Observers cannot block a recording transition.
      }
    }
    return state;
  }

  const bytesFor = (session) => {
    const document = {
      kind: 'vessel-recording',
      schemaVersion: 1,
      id: session.id,
      status: session.status,
      sourceId: session.sourceId,
      sourcePolicy: session.policy,
      region: session.region,
      startedAt: session.startedAt,
      lastReceivedAt: session.lastReceivedAt,
      endedAt: session.endedAt,
      stopReason: session.stopReason,
      bytes: session.bytes,
    };
    const chunks = {
      positions: session.positions,
      metadata: session.metadata,
      gaps: session.gaps,
    };
    return { document, chunks };
  };

  async function persist(session) {
    const { document, chunks } = bytesFor(session);
    let bytes = byteLength(document) + byteLength(chunks);
    document.bytes = bytes;
    bytes = byteLength(document) + byteLength(chunks);
    if (bytes > maxRecordingBytes)
      throw Object.assign(
        new Error('Vessel recording reached its byte limit.'),
        {
          code: 'recording-byte-limit',
        },
      );
    const rows = await storage.listWorkspaces();
    const otherBytes = rows.reduce(
      (sum, row) => sum + (row.id === session.id ? 0 : Number(row.bytes) || 0),
      0,
    );
    if (otherBytes + bytes > maxTotalBytes)
      throw Object.assign(
        new Error('Application recordings reached their storage limit.'),
        {
          code: 'application-byte-limit',
        },
      );
    document.bytes = bytes;
    const saved = await storage.commitWorkspace({
      id: session.id,
      expectedRevision: session.revision,
      document,
      chunks,
    });
    session.revision = saved.revision;
    session.bytes = bytes;
  }

  function closeGap(at) {
    if (!active?.openGap) return;
    active.gaps.push({
      startedAt: active.openGap.startedAt,
      endedAt: Math.max(active.openGap.startedAt, epoch(at, 'Gap end')),
      reason: active.openGap.reason,
      method: 'observed-gap',
    });
    active.openGap = null;
  }

  function openGap(reason, from) {
    if (!active || active.openGap) return;
    active.openGap = {
      startedAt: epoch(from, 'Gap start'),
      reason: String(reason || 'provider-unavailable').slice(0, 80),
    };
  }

  async function stop(reason = 'user') {
    if (!active || active.status !== 'active') return active;
    const session = active;
    closeGap(now());
    session.status = 'complete';
    session.endedAt = epoch(now(), 'End time');
    session.stopReason = String(reason).slice(0, 80);
    try {
      await persist(session);
    } catch (error) {
      session.status = 'interrupted';
      session.stopReason = error.code || 'storage-error';
    }
    if (timer !== null) cancel(timer);
    timer = null;
    return publish();
  }

  async function check() {
    if (!active || active.status !== 'active') return active;
    if (epoch(now(), 'Current time') - active.startedAt >= maxDurationMs)
      return stop('duration-limit');
    if (active.openGap) await persist(active);
    return publish();
  }

  return Object.freeze({
    getState: () => snapshot(),
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Listener must be a function');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    check,
    async start({ id, region, sourceId = 'synthetic-vessel-fixture' } = {}) {
      if (destroyed) throw new Error('Vessel recorder is closed');
      if (!storage.savedByBrowser)
        throw Object.assign(
          new Error('Vessel recording needs persistent browser storage.'),
          {
            code: 'storage-not-persistent',
          },
        );
      if (active?.status === 'active' || starting)
        throw Object.assign(
          new Error('Only one vessel recording can be active.'),
          {
            code: 'recording-active',
          },
        );
      const policy = policies[sourceId];
      if (
        !policy?.policyId ||
        policy.retentionAllowed !== true ||
        policy.exportAllowed !== true
      )
        throw Object.assign(
          new Error(
            `Vessel recording is disabled because ${sourceId} has no approved retention and export policy.`,
          ),
          { code: 'retention-not-approved' },
        );
      const recordingId = String(
        id || `vessel-recording-${Math.trunc(now())}`,
      ).trim();
      if (!/^vessel-recording-[A-Za-z0-9._:-]{1,110}$/.test(recordingId))
        throw new TypeError(
          'Vessel recording id must start with vessel-recording-',
        );
      const session = {
        id: recordingId,
        status: 'active',
        sourceId,
        policy: Object.freeze({
          policyId: policy.policyId,
          retentionAllowed: true,
          exportAllowed: true,
        }),
        region: validateRecordingRegion(region),
        startedAt: epoch(now(), 'Start time'),
        lastReceivedAt: epoch(now(), 'Start time'),
        endedAt: null,
        stopReason: null,
        positions: [],
        metadata: [],
        gaps: [],
        observedByKey: new Map(),
        metadataByEntity: new Map(),
        revision: 0,
        bytes: 0,
        openGap: null,
      };
      starting = true;
      try {
        await persist(session);
        active = session;
        if (timer === null)
          timer = schedule(() => void check().catch(() => {}), 15_000);
        return publish();
      } finally {
        starting = false;
      }
    },
    async noteSourceUnavailable(reason = 'provider-unavailable') {
      if (!active || active.status !== 'active') return active;
      openGap(reason, now());
      await persist(active);
      return publish();
    },
    async ingest({
      sourceId = active?.sourceId,
      observations = [],
      receivedAt = now(),
      status = 'ok',
    } = {}) {
      if (!active || active.status !== 'active')
        throw Object.assign(new Error('No active vessel recording.'), {
          code: 'no-active-recording',
        });
      if (sourceId !== active.sourceId)
        throw Object.assign(
          new Error('Vessel snapshot source does not match the recording.'),
          {
            code: 'source-mismatch',
          },
        );
      const received = epoch(receivedAt, 'Receipt time');
      await check();
      if (!active || active.status !== 'active') return active;
      const session = active;
      const before = {
        positions: session.positions.slice(),
        metadata: session.metadata.slice(),
        gaps: session.gaps.slice(),
        observedByKey: new Map(session.observedByKey),
        metadataByEntity: new Map(session.metadataByEntity),
        openGap: session.openGap ? { ...session.openGap } : null,
        lastReceivedAt: session.lastReceivedAt,
      };
      if (status !== 'ok') {
        openGap(status, received);
        const previousReceivedAt = session.lastReceivedAt;
        session.lastReceivedAt = received;
        try {
          await persist(session);
        } catch (error) {
          session.lastReceivedAt = previousReceivedAt;
          session.openGap = before.openGap;
          throw error;
        }
        return publish({ accepted: 0 });
      }
      closeGap(received);
      const accepted = [];
      for (const item of observations) {
        const row = normalizedPosition(item, session.sourceId, received);
        if (!row || !isWithinRecordingRegion(session.region, row)) continue;
        const key = `${row.entityId}\u0000${row.observedAt}`;
        const prior = session.observedByKey.get(key);
        if (prior && positionSignature(prior) === positionSignature(row))
          continue;
        if (prior) {
          row.correctionOf = prior.observationId;
          row.correction = (prior.correction || 0) + 1;
          row.observationId = `${row.observationId}#${row.correction}`;
        }
        const candidate = [...session.positions, ...accepted, row];
        if (
          byteLength(candidate) + byteLength(session.metadata) >
          maxRecordingBytes
        ) {
          await stop('recording-byte-limit');
          return publish({
            accepted: accepted.length,
            stoppedAtLimit: true,
          });
        }
        accepted.push(row);
        session.observedByKey.set(key, row);

        const fields = metadataFields(item);
        const previous = session.metadataByEntity.get(row.entityId);
        if (
          !previous ||
          JSON.stringify(previous.fields) !== JSON.stringify(fields)
        ) {
          const event = {
            metadataId: `${encodeURIComponent(row.entityId)}@${received}`,
            entityId: row.entityId,
            changedAt: received,
            receivedAt: received,
            effectiveAt: null,
            timeBasis: 'received-at',
            previousMetadataId: previous?.metadataId || null,
            fields,
          };
          session.metadata.push(event);
          session.metadataByEntity.set(row.entityId, event);
        }
      }
      session.positions.push(...accepted);
      session.lastReceivedAt = received;
      try {
        await persist(session);
      } catch (error) {
        session.positions = before.positions;
        session.metadata = before.metadata;
        session.gaps = before.gaps;
        session.observedByKey = before.observedByKey;
        session.metadataByEntity = before.metadataByEntity;
        session.openGap = before.openGap;
        session.lastReceivedAt = before.lastReceivedAt;
        const reason = error.code || 'storage-error';
        if (
          [
            'recording-byte-limit',
            'application-byte-limit',
            'quota-exceeded',
          ].includes(reason)
        ) {
          const stopped = await stop(reason);
          return Object.freeze({ ...stopped, stoppedAtLimit: true });
        }
        session.persistenceError = reason;
        return publish({ persistenceError: reason });
      }
      return publish({ accepted: accepted.length });
    },
    stop,
    async exportRecording(id) {
      const workspace = await storage.getWorkspace(String(id));
      if (workspace?.document?.kind !== 'vessel-recording') return null;
      if (workspace.document.sourcePolicy?.exportAllowed !== true)
        throw Object.assign(
          new Error('This vessel recording policy does not permit export.'),
          {
            code: 'export-not-approved',
          },
        );
      return Object.freeze({
        format: 'gods-eye-view-vessel-recording',
        schemaVersion: 1,
        document: workspace.document,
        chunks: workspace.chunks,
      });
    },
    async deleteRecording(id) {
      const recordingId = String(id);
      let workspace = await storage.getWorkspace(recordingId);
      if (workspace?.document?.kind !== 'vessel-recording') return false;
      if (active?.id === recordingId && active.status === 'active')
        await stop('deleted');
      workspace = await storage.getWorkspace(recordingId);
      return storage.deleteWorkspace(recordingId, {
        expectedRevision: workspace.manifest.revision,
      });
    },
    async recoverInterrupted() {
      const rows = await storage.listWorkspaces();
      const recovered = [];
      for (const row of rows) {
        const workspace = await storage.getWorkspace(row.id);
        if (
          workspace?.document?.kind !== 'vessel-recording' ||
          workspace.document.status !== 'active'
        )
          continue;
        const endedAt = epoch(now(), 'Recovery time');
        const gaps = [
          ...(workspace.chunks.gaps || []),
          {
            startedAt:
              Number(workspace.document.lastReceivedAt) ||
              Number(workspace.document.startedAt) ||
              endedAt,
            endedAt,
            reason: 'page-lifecycle-interrupted',
            method: 'observed-gap',
          },
        ];
        const saved = await storage.commitWorkspace({
          id: row.id,
          expectedRevision: workspace.manifest.revision,
          document: {
            ...workspace.document,
            status: 'interrupted',
            endedAt,
            interrupted: true,
            stopReason: 'page-lifecycle-interrupted',
          },
          chunks: { ...workspace.chunks, gaps },
          assets: workspace.assets,
        });
        recovered.push({ id: row.id, revision: saved.revision });
      }
      return recovered;
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
