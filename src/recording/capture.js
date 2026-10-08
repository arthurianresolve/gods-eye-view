function sourceIdentity(snapshot) {
  return String(snapshot?.source || '').trim();
}

function positionRows(snapshot, read) {
  return (Array.isArray(snapshot?.records) ? snapshot.records : [])
    .map(read)
    .filter(Boolean);
}

async function captureSnapshot(service, snapshot, observations) {
  const active = service?.getState?.();
  if (active?.status !== 'active') return { status: 'idle' };
  const sourceId = sourceIdentity(snapshot);
  if (!sourceId || sourceId !== active.sourceId) {
    await service.stop('source-changed');
    return { status: 'stopped', reason: 'source-changed' };
  }
  return service.ingest({ sourceId, observations });
}

/** Persist only normalized aircraft observations with their own position time. */
export function captureAircraftSnapshot(service, snapshot) {
  return captureSnapshot(
    service,
    snapshot,
    positionRows(snapshot, (row) => {
      const observedAt = row?.positionTimeMs ?? row?.observedAtMs;
      if (
        !row?.id ||
        !Number.isFinite(observedAt) ||
        !Number.isFinite(row.latitude) ||
        !Number.isFinite(row.longitude)
      )
        return null;
      return {
        id: row.id,
        observedAt,
        latitude: row.latitude,
        longitude: row.longitude,
        callsign: row.callsign,
        altitudeM: row.baroAltitudeM ?? row.altitudeM,
        velocityMps: row.speedMps ?? row.velocityMps,
        headingDeg: row.courseDeg ?? row.headingDeg,
        onGround: row.onGround,
      };
    }),
  );
}

/** Persist AIS positions and metadata without borrowing the feed snapshot time. */
export function captureVesselSnapshot(service, snapshot) {
  return captureSnapshot(
    service,
    snapshot,
    positionRows(snapshot, (row) => {
      if (
        !row?.id ||
        !Number.isFinite(row.observedAtMs) ||
        !Number.isFinite(row.latitude) ||
        !Number.isFinite(row.longitude)
      )
        return null;
      return {
        id: row.id,
        observedAtMs: row.observedAtMs,
        latitude: row.latitude,
        longitude: row.longitude,
        name: row.name,
        imo: row.imo,
        type: row.type,
        destination: row.destination,
        speedMps: row.speedMps,
        courseDeg: row.courseDeg,
        headingDeg: row.headingDeg,
        altitudeDatum: 'sea-surface',
      };
    }),
  );
}

export async function markRecordingSourceUnavailable(service, reason) {
  if (service?.getState?.()?.status !== 'active') return { status: 'idle' };
  return service.noteSourceUnavailable?.(reason || 'provider-unavailable');
}
