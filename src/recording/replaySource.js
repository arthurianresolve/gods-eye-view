function toEpoch(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function observationsFrom(chunks = {}) {
  return Object.entries(chunks)
    .filter(([name]) => name.startsWith('observations-'))
    .flatMap(([, rows]) => rows)
    .sort((first, second) => first.observedAt - second.observedAt);
}

function timelineTicks(rows, gaps) {
  const all = [...new Set(rows.map((row) => row.observedAt))];
  for (const gap of gaps) all.push(gap.startedAt, gap.endedAt);
  all.sort((first, second) => first - second);
  const unique = [...new Set(all)];
  if (unique.length <= 5000) return unique;
  const stride = (unique.length - 1) / 4999;
  return [
    ...new Set(
      Array.from(
        { length: 5000 },
        (_, index) => unique[Math.round(index * stride)],
      ),
    ),
  ];
}

function toFlightRecord(row) {
  return {
    id: row.entityId,
    reference: row.entityId,
    latitude: row.latitude,
    longitude: row.longitude,
    positionTimeMs: row.observedAt,
    contactTimeMs: row.receivedAt,
    callsign: row.callsign || '',
    baroAltitudeM: row.altitudeM ?? null,
    speedMps: row.velocityMps ?? null,
    courseDeg: row.headingDeg ?? null,
    onGround: row.onGround ?? false,
    sourceRecordId: row.observationId,
    method: row.method || 'observed',
  };
}

/** Read a selected local recording as an aircraft source; it never consults live data. */
export function createRecordedAircraftSource({
  storage,
  maxSampleAgeMs = 2 * 60 * 1000,
  maxRecords = 20_000,
} = {}) {
  if (!storage?.getWorkspace)
    throw new TypeError('Workspace storage is required for aircraft replay');
  if (!Number.isFinite(maxSampleAgeMs) || maxSampleAgeMs < 0)
    throw new RangeError('Maximum replay sample age must be nonnegative');
  if (!Number.isInteger(maxRecords) || maxRecords < 1)
    throw new RangeError('Maximum replay record count must be positive');
  let selected = null;
  let targetMs = null;
  let generation = 0;

  function coverage() {
    if (!selected || !selected.rows.length) return null;
    return {
      from: selected.rows[0].observedAt,
      to: selected.rows.at(-1).observedAt,
    };
  }

  function gapAt(timeMs) {
    return selected?.gaps.some(
      (gap) => timeMs >= gap.startedAt && timeMs <= gap.endedAt,
    );
  }

  function selectAt(timeMs) {
    const interval = coverage();
    if (
      !selected ||
      !interval ||
      timeMs < interval.from ||
      timeMs > interval.to
    )
      return null;
    const rowsByEntity = new Map();
    for (const row of selected.rows) {
      if (row.observedAt > timeMs) break;
      rowsByEntity.set(row.entityId, row);
    }
    const eligible = [...rowsByEntity.values()].filter(
      (row) => timeMs - row.observedAt <= maxSampleAgeMs,
    );
    const newest = eligible.reduce(
      (latest, row) => Math.max(latest, row.observedAt),
      null,
    );
    return {
      interval,
      eligible,
      newest,
      stale: gapAt(timeMs) || eligible.length === 0,
    };
  }

  const api = {
    label: 'Local aircraft recording',
    async selectRecording(id) {
      const requestGeneration = ++generation;
      const workspace = await storage.getWorkspace(String(id));
      if (requestGeneration !== generation) return { status: 'cancelled' };
      if (workspace?.document?.kind !== 'aircraft-recording')
        return { status: 'not-a-recording' };
      if (!['complete', 'interrupted'].includes(workspace.document.status))
        return { status: 'recording-incomplete' };
      const allRows = observationsFrom(workspace.chunks);
      const rows = allRows.slice(-maxRecords);
      const first = rows[0]?.observedAt;
      const last = rows.at(-1)?.observedAt;
      selected = {
        id: workspace.document.id,
        document: workspace.document,
        rows,
        gaps: workspace.chunks.gaps || [],
        truncated: allRows.length > rows.length,
      };
      targetMs = first ?? null;
      return {
        status: rows.length ? 'selected' : 'empty-recording',
        id: selected.id,
        coverage: first == null ? null : { from: first, to: last },
        recordCount: rows.length,
        truncated: selected.truncated,
      };
    },
    clear() {
      generation++;
      selected = null;
      targetMs = null;
    },
    setTime(value) {
      const time = toEpoch(value);
      if (time === null) throw new TypeError('A valid replay time is required');
      targetMs = time;
      return time;
    },
    getState() {
      return Object.freeze({
        recordingId: selected?.id || null,
        targetMs,
        coverage: coverage() ? Object.freeze(coverage()) : null,
        recordCount: selected?.rows.length || 0,
        truncated: selected?.truncated || false,
      });
    },
    getTimeline() {
      if (!selected)
        return Object.freeze({ ticks: [], gaps: [], coverage: null });
      const interval = coverage();
      return Object.freeze({
        ticks: Object.freeze(timelineTicks(selected.rows, selected.gaps)),
        gaps: Object.freeze(
          selected.gaps.map((gap) => Object.freeze({ ...gap })),
        ),
        coverage: interval ? Object.freeze(interval) : null,
        truncated: selected.truncated,
      });
    },
    async getSnapshot(_query, { signal } = {}) {
      if (signal?.aborted)
        throw new DOMException('Replay snapshot aborted', 'AbortError');
      const requestGeneration = generation;
      const interval = coverage();
      if (!selected || targetMs === null || !interval)
        return {
          records: [],
          source: 'Local aircraft recording',
          coverage: 'No local aircraft recording selected',
          observedAtMs: null,
          ageMs: null,
          stale: true,
          freshness: 'unknown',
          complete: true,
        };
      if (signal?.aborted)
        throw new DOMException('Replay snapshot aborted', 'AbortError');
      if (requestGeneration !== generation)
        throw new DOMException('Replay selection changed', 'AbortError');
      const selection = selectAt(targetMs);
      if (!selection)
        return {
          records: [],
          source: `Local recording · ${selected.id}`,
          coverage: `No recorded aircraft coverage at ${new Date(targetMs).toISOString()}`,
          observedAtMs: null,
          ageMs: null,
          stale: true,
          freshness: 'unknown',
          complete: true,
          status: 200,
          selectedTimeMs: targetMs,
        };
      const { eligible, newest, stale } = selection;
      return {
        records: eligible.map(toFlightRecord),
        source: `Local recording · ${selected.id}`,
        coverage: `Recorded region · ${new Date(selection.interval.from).toISOString()} to ${new Date(selection.interval.to).toISOString()}${selected.truncated ? ' · truncated' : ''}`,
        observedAtMs: newest,
        ageMs: newest === null ? null : Math.max(0, targetMs - newest),
        stale,
        freshness: stale ? 'stale' : 'current',
        complete: true,
        status: 200,
        selectedTimeMs: targetMs,
      };
    },
    attachCapabilities(registry, { layerId = 'flights' } = {}) {
      if (!registry?.register)
        throw new TypeError('A temporal capability registry is required');
      let remove = null;
      const registerCurrent = () => {
        remove?.();
        const interval = coverage();
        if (!selected || !interval) return;
        remove = registry.register({
          id: layerId,
          mode: 'recorded',
          label: `Local recording · ${selected.id}`,
          coverage: interval,
          selectAt: async ({ targetMs: requested }) => {
            const selection = selectAt(requested);
            if (!selection?.eligible.length || selection.newest === null)
              return null;
            return {
              sampleTimeMs: selection.newest,
              selectedTimeMs: requested,
              recordCount: selection.eligible.length,
              stale: selection.stale,
              coverage: `Recorded region · ${new Date(selection.interval.from).toISOString()} to ${new Date(selection.interval.to).toISOString()}`,
            };
          },
        });
      };
      registerCurrent();
      return Object.freeze({
        refresh: registerCurrent,
        remove() {
          remove?.();
          remove = null;
        },
      });
    },
  };

  return Object.freeze(api);
}
