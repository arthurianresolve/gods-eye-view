function validEpoch(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) && Math.abs(result) <= 8.64e15 ? result : null;
}

function rowsFrom(chunks, key) {
  const rows = Array.isArray(chunks?.[key]) ? chunks[key] : [];
  return rows
    .filter((row) => validEpoch(row?.observedAt ?? row?.changedAt) !== null)
    .slice()
    .sort(
      (a, b) => (a.observedAt ?? a.changedAt) - (b.observedAt ?? b.changedAt),
    );
}

function ticksFor(positions, metadata, gaps) {
  const ticks = [
    ...positions.map((row) => row.observedAt),
    ...metadata.map((row) => row.changedAt),
    ...gaps.flatMap((gap) => [gap.startedAt, gap.endedAt]),
  ].filter((value) => validEpoch(value) !== null);
  const unique = [...new Set(ticks)].sort((a, b) => a - b);
  if (unique.length <= 5000) return unique;
  const stride = (unique.length - 1) / 4999;
  return [
    ...new Set(
      Array.from({ length: 5000 }, (_, i) => unique[Math.round(i * stride)]),
    ),
  ];
}

/** Read timestamped AIS positions and receipt-timed metadata without consulting live AIS. */
export function createRecordedVesselSource({
  storage,
  maxSampleAgeMs = 2 * 60 * 1000,
  maxRecords = 20_000,
} = {}) {
  if (!storage?.getWorkspace)
    throw new TypeError('Workspace storage is required for vessel replay');
  if (!Number.isFinite(maxSampleAgeMs) || maxSampleAgeMs < 0)
    throw new RangeError('Maximum vessel sample age must be nonnegative');
  if (!Number.isInteger(maxRecords) || maxRecords < 1)
    throw new RangeError('Maximum vessel record count must be positive');
  let selected = null;
  let targetMs = null;
  let generation = 0;

  const coverage = () =>
    selected?.positions.length
      ? {
          from: selected.positions[0].observedAt,
          to: selected.positions.at(-1).observedAt,
        }
      : null;
  const isGap = (timeMs) =>
    selected?.gaps.some(
      (gap) => timeMs >= gap.startedAt && timeMs < gap.endedAt,
    ) || false;

  function latestFor(timeMs) {
    const interval = coverage();
    if (
      !selected ||
      !interval ||
      timeMs < interval.from ||
      timeMs > interval.to ||
      isGap(timeMs)
    )
      return { interval, records: [], observedAtMs: null, stale: true };
    const byEntity = new Map();
    for (const position of selected.positions) {
      if (position.observedAt > timeMs) break;
      byEntity.set(position.entityId, position);
    }
    const metadataByEntity = new Map();
    for (const event of selected.metadata) {
      if (event.changedAt > timeMs) break;
      metadataByEntity.set(event.entityId, event);
    }
    const positions = [...byEntity.values()].filter(
      (row) => timeMs - row.observedAt <= maxSampleAgeMs,
    );
    positions.sort((a, b) => b.observedAt - a.observedAt);
    const bounded = positions.slice(0, maxRecords);
    const records = bounded.map((row) => {
      const event = metadataByEntity.get(row.entityId);
      return {
        id: row.entityId,
        reference: row.entityId,
        latitude: row.latitude,
        longitude: row.longitude,
        observedAtMs: row.observedAt,
        receivedAtMs: row.receivedAt,
        speedMps: row.speedMps,
        courseDeg: row.courseDeg,
        headingDeg: row.headingDeg,
        altitudeDatum: 'sea-surface',
        metadataChangedAtMs: event?.changedAt ?? null,
        metadataTimeBasis: event?.timeBasis ?? null,
        ...event?.fields,
      };
    });
    const observedAtMs = records.reduce(
      (newest, row) => Math.max(newest ?? -Infinity, row.observedAtMs),
      null,
    );
    return {
      interval,
      records,
      observedAtMs,
      stale: records.length === 0,
    };
  }

  const api = {
    label: 'Local vessel recording',
    async selectRecording(id) {
      const request = ++generation;
      const workspace = await storage.getWorkspace(String(id));
      if (request !== generation) return { status: 'cancelled' };
      if (workspace?.document?.kind !== 'vessel-recording')
        return { status: 'not-a-recording' };
      if (!['complete', 'interrupted'].includes(workspace.document.status))
        return { status: 'recording-incomplete' };
      const allPositions = rowsFrom(workspace.chunks, 'positions');
      const allMetadata = rowsFrom(workspace.chunks, 'metadata');
      const positions = allPositions.slice(-maxRecords);
      const from = positions[0]?.observedAt;
      const to = positions.at(-1)?.observedAt;
      selected = {
        id: workspace.document.id,
        document: workspace.document,
        positions,
        metadata: allMetadata,
        gaps: Array.isArray(workspace.chunks?.gaps)
          ? workspace.chunks.gaps
          : [],
        truncated: allPositions.length > positions.length,
      };
      targetMs = from ?? null;
      return {
        status: positions.length ? 'selected' : 'empty-recording',
        id: selected.id,
        coverage: from == null ? null : { from, to },
        recordCount: positions.length,
        metadataCount: allMetadata.length,
        truncated: selected.truncated,
      };
    },
    clear() {
      generation++;
      selected = null;
      targetMs = null;
    },
    setTime(value) {
      const time = validEpoch(value);
      if (time === null)
        throw new TypeError('A valid vessel replay time is required');
      targetMs = time;
      return time;
    },
    getState() {
      return Object.freeze({
        recordingId: selected?.id || null,
        targetMs,
        coverage: coverage() ? Object.freeze(coverage()) : null,
        recordCount: selected?.positions.length || 0,
        metadataCount: selected?.metadata.length || 0,
        truncated: selected?.truncated || false,
      });
    },
    getTimeline() {
      if (!selected)
        return Object.freeze({ ticks: [], gaps: [], coverage: null });
      const interval = coverage();
      return Object.freeze({
        ticks: Object.freeze(
          ticksFor(selected.positions, selected.metadata, selected.gaps),
        ),
        gaps: Object.freeze(
          selected.gaps.map((gap) => Object.freeze({ ...gap })),
        ),
        coverage: interval ? Object.freeze(interval) : null,
        truncated: selected.truncated,
      });
    },
    async getSnapshot(_query, { signal } = {}) {
      if (signal?.aborted)
        throw new DOMException('Vessel replay aborted', 'AbortError');
      const request = generation;
      if (!selected || targetMs === null) {
        return {
          records: [],
          source: api.label,
          observedAtMs: null,
          stale: true,
          freshness: 'unknown',
          complete: true,
          transportStatus: 'recording-empty',
          rawRowCount: 0,
        };
      }
      const selection = latestFor(targetMs);
      if (signal?.aborted || request !== generation)
        throw new DOMException('Vessel replay selection changed', 'AbortError');
      return {
        records: selection.records,
        source: `Local vessel recording · ${selected.id}`,
        coverage: selection.interval
          ? `Recorded AIS positions · ${new Date(selection.interval.from).toISOString()} to ${new Date(selection.interval.to).toISOString()}`
          : 'No recorded vessel coverage at requested time',
        observedAtMs: selection.observedAtMs,
        ageMs:
          selection.observedAtMs == null
            ? null
            : Math.max(0, targetMs - selection.observedAtMs),
        stale: selection.stale,
        freshness: selection.stale ? 'stale' : 'current',
        complete: true,
        transportStatus: 'recorded',
        rawRowCount: selection.records.length,
        selectedTimeMs: targetMs,
        status: 200,
        truncated: selected.truncated,
      };
    },
    async getTrack(reference, { signal } = {}) {
      if (signal?.aborted)
        throw new DOMException('Vessel track aborted', 'AbortError');
      if (!selected || targetMs === null || isGap(targetMs))
        return { records: [], complete: true };
      const rows = selected.positions.filter(
        (row) =>
          row.entityId === String(reference) && row.observedAt <= targetMs,
      );
      const segment = [];
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        const next = segment.at(-1);
        if (next) {
          const crossesOutage = selected.gaps.some(
            (gap) =>
              gap.startedAt < next.observedAt && gap.endedAt >= row.observedAt,
          );
          if (
            next.observedAt - row.observedAt > maxSampleAgeMs ||
            crossesOutage
          )
            break;
        }
        segment.push(row);
        if (segment.length >= maxRecords) break;
      }
      return {
        records: segment.reverse().map((row) => ({
          latitude: row.latitude,
          longitude: row.longitude,
          observedAtMs: row.observedAt,
          altitudeDatum: 'sea-surface',
        })),
        complete: true,
      };
    },
    attachCapabilities(registry, { layerId = 'vessels' } = {}) {
      if (!registry?.register)
        throw new TypeError('A temporal capability registry is required');
      let remove = null;
      const register = () => {
        remove?.();
        const interval = coverage();
        if (!selected || !interval) return;
        remove = registry.register({
          id: layerId,
          mode: 'recorded',
          label: `Local vessel recording · ${selected.id}`,
          coverage: interval,
          selectAt: async ({ targetMs: requested }) => {
            const sample = latestFor(requested);
            if (!sample.records.length || sample.observedAtMs === null)
              return null;
            return {
              sampleTimeMs: sample.observedAtMs,
              selectedTimeMs: requested,
              recordCount: sample.records.length,
              stale: sample.stale,
              coverage: `Recorded AIS positions · ${new Date(interval.from).toISOString()} to ${new Date(interval.to).toISOString()}`,
            };
          },
        });
      };
      register();
      return Object.freeze({
        refresh: register,
        remove() {
          remove?.();
          remove = null;
        },
      });
    },
  };
  return Object.freeze(api);
}
