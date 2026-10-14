import {
  MAX_RECORDING_BUNDLE_BYTES,
  createRecordingBundle,
  importRecordingBundle,
} from '../recording/bundle.js';

function epoch(value) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function immutable(state) {
  return Object.freeze({
    ...state,
    recordings: Object.freeze([...state.recordings]),
    ticks: Object.freeze([...state.ticks]),
    gaps: Object.freeze([...state.gaps]),
  });
}

/** Coordinate recorded aircraft and vessel observations on one investigation clock. */
export function createInvestigationTimelineController({
  storage,
  aircraftSource,
  vesselSource,
  investigationTime,
  timelineArbiter,
  dataManager,
  recordingService,
  vesselRecordingService,
  confirmHandoff = async () => false,
} = {}) {
  if (!storage?.listWorkspaces || !aircraftSource?.selectRecording)
    throw new TypeError(
      'Workspace storage and an aircraft source are required',
    );
  if (!investigationTime?.seek || !timelineArbiter?.claim)
    throw new TypeError(
      'Investigation time and timeline ownership are required',
    );

  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let selectionGeneration = 0;
  let refreshController = null;
  let arbiterOwned = false;
  let state = immutable({
    recordings: [],
    recordingId: null,
    recordingType: 'aircraft',
    aircraftRecordingId: null,
    vesselRecordingId: null,
    mode: 'live',
    ticks: [],
    gaps: [],
    coverage: null,
    index: 0,
    requestedTimeMs: null,
    actualSampleTimeMs: null,
    aircraftSampleTimeMs: null,
    vesselSampleTimeMs: null,
    playing: false,
    rate: 1,
    notice:
      'No saved local aircraft or vessel recordings. Live-source recording is disabled until retention and export rights are approved.',
  });

  function publish(patch = {}) {
    if (destroyed) return state;
    state = immutable({ ...state, ...patch });
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Rendering observers cannot change timeline ownership.
      }
    }
    return state;
  }

  function cancelRefresh() {
    generation++;
    refreshController?.abort();
    refreshController = null;
  }

  function selectedSources(ids = state) {
    return [
      {
        type: 'aircraft',
        id: ids.aircraftRecordingId,
        source: aircraftSource,
        layerId: 'flights',
      },
      {
        type: 'vessel',
        id: ids.vesselRecordingId,
        source: vesselSource,
        layerId: 'ais-live-vessels',
      },
    ].filter((entry) => entry.id && entry.source);
  }

  function combinedTimeline(ids = state) {
    const timelines = selectedSources(ids).map((entry) => ({
      type: entry.type,
      ...entry.source.getTimeline(),
    }));
    const ticks = [...new Set(timelines.flatMap((item) => item.ticks || []))]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const coverages = timelines.map((item) => item.coverage).filter(Boolean);
    return {
      ticks,
      gaps: timelines.flatMap((item) =>
        (item.gaps || []).map((gap) => ({ ...gap, sourceType: item.type })),
      ),
      coverage: coverages.length
        ? {
            from: Math.min(...coverages.map((item) => item.from)),
            to: Math.max(...coverages.map((item) => item.to)),
          }
        : null,
      truncated: timelines.some((item) => item.truncated),
    };
  }

  async function updateAircraft(timeMs, index, notice = '') {
    cancelRefresh();
    const requestGeneration = generation;
    refreshController = new AbortController();
    try {
      const selected = selectedSources();
      const loaded = await Promise.all(
        selected.map(async (entry) => {
          try {
            entry.source.setTime(timeMs);
            const snapshot = await entry.source.getSnapshot(undefined, {
              signal: refreshController.signal,
            });
            return { ...entry, snapshot };
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return { ...entry, snapshot: null, error };
          }
        }),
      );
      if (destroyed || requestGeneration !== generation) return state;
      const refreshes = await Promise.allSettled(
        loaded
          .filter(
            (entry) =>
              entry.snapshot && dataManager?.isEnabled?.(entry.layerId),
          )
          .map((entry) =>
            dataManager.refreshLayer(entry.layerId, {
              signal: refreshController.signal,
            }),
          ),
      );
      if (destroyed || requestGeneration !== generation) return state;
      const aircraft = loaded.find(
        (entry) => entry.type === 'aircraft',
      )?.snapshot;
      const vessel = loaded.find((entry) => entry.type === 'vessel')?.snapshot;
      const active = state.recordingType === 'vessel' ? vessel : aircraft;
      const refreshed = refreshes.some(
        (item) => item.status === 'fulfilled' && item.value === true,
      );
      const noSample = !active || active.records.length === 0;
      return publish({
        requestedTimeMs: timeMs,
        actualSampleTimeMs: active?.observedAtMs ?? null,
        aircraftSampleTimeMs: aircraft?.observedAtMs ?? null,
        vesselSampleTimeMs: vessel?.observedAtMs ?? null,
        index,
        playing: investigationTime.getState?.().mode === 'replay',
        notice:
          notice ||
          (noSample
            ? `No ${state.recordingType === 'vessel' ? 'vessel' : 'aircraft'} sample at the requested time. Recorded coverage has a gap here.`
            : refreshed
              ? 'Recorded observations loaded at the same investigation time.'
              : 'Sample selected. Enable the matching layer to show it on the globe.'),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || destroyed) return state;
      if (requestGeneration !== generation) return state;
      return publish({
        requestedTimeMs: timeMs,
        actualSampleTimeMs: null,
        aircraftSampleTimeMs: null,
        vesselSampleTimeMs: null,
        index,
        playing: false,
        notice: 'A recorded movement sample could not be loaded.',
      });
    }
  }

  function clockChanged(clockState) {
    if (destroyed || state.mode !== 'recorded') return;
    if (clockState.mode !== 'replay') {
      publish({ playing: false });
      return;
    }
    const target = epoch(clockState.timeMs);
    if (target === null || !state.ticks.length) return;
    let index = state.ticks.findLastIndex((tick) => tick <= target);
    if (index < 0) index = 0;
    const atEnd =
      (clockState.rate < 0 && target <= state.ticks[0]) ||
      (clockState.rate >= 0 && target >= state.ticks.at(-1));
    if (atEnd) {
      investigationTime.pause();
      index = clockState.rate < 0 ? 0 : state.ticks.length - 1;
    }
    if (index !== state.index) {
      const selected = state.ticks[index];
      void updateAircraft(selected, index, 'Replaying recorded observations.');
    } else {
      publish({ playing: !atEnd });
    }
  }

  const unsubscribeClock =
    investigationTime.subscribe?.(clockChanged) || (() => {});

  async function refreshRecordings() {
    const rows = await storage.listWorkspaces();
    const recordings = rows.filter(
      (row) =>
        ['aircraft-recording', 'vessel-recording'].includes(row.kind) &&
        ['complete', 'interrupted'].includes(row.status),
    );
    return publish({
      recordings,
      notice: recordings.length
        ? state.notice.startsWith('No saved local')
          ? 'Choose a local aircraft or vessel recording to review its coverage.'
          : state.notice
        : 'No saved local aircraft or vessel recordings. Live-source recording is disabled until retention and export rights are approved.',
    });
  }

  async function selectRecording(id, preferredType = null) {
    if (destroyed) return { status: 'destroyed' };
    const row = state.recordings.find((recording) => recording.id === id);
    const type =
      preferredType ||
      (row?.kind === 'vessel-recording' ? 'vessel' : 'aircraft');
    const source = type === 'vessel' ? vesselSource : aircraftSource;
    if (!source?.selectRecording) return { status: 'unsupported-source' };
    const selection = ++selectionGeneration;
    cancelRefresh();
    const claimed = await timelineArbiter.claim('investigation', {
      onConflict: confirmHandoff,
    });
    if (destroyed || selection !== selectionGeneration)
      return { status: 'cancelled' };
    if (!claimed) {
      publish({ notice: 'Another playback owns the scene timeline.' });
      return { status: 'timeline-owned' };
    }
    arbiterOwned = true;
    const result = await source.selectRecording(id);
    if (destroyed || selection !== selectionGeneration)
      return { status: 'cancelled' };
    if (result.status !== 'selected') {
      source.returnLive();
      const ids = {
        aircraftRecordingId:
          type === 'aircraft' ? null : state.aircraftRecordingId,
        vesselRecordingId: type === 'vessel' ? null : state.vesselRecordingId,
      };
      const fallbackType = ids.aircraftRecordingId ? 'aircraft' : 'vessel';
      const fallbackId = ids.aircraftRecordingId || ids.vesselRecordingId;
      const timeline = fallbackId ? combinedTimeline(ids) : null;
      if (timeline?.ticks.length) {
        const first = timeline.ticks[0];
        publish({
          ...ids,
          recordingId: fallbackId,
          recordingType: fallbackType,
          mode: 'recorded',
          ticks: timeline.ticks,
          gaps: timeline.gaps,
          coverage: timeline.coverage,
          index: 0,
          requestedTimeMs: first,
          actualSampleTimeMs: null,
          playing: false,
        });
        investigationTime.seek(first);
        return updateAircraft(
          first,
          0,
          'The other recorded source remains selected.',
        );
      }
      investigationTime.returnLive();
      if (arbiterOwned) timelineArbiter.release('investigation');
      arbiterOwned = false;
      publish({
        ...ids,
        recordingId: null,
        mode: 'live',
        ticks: [],
        gaps: [],
        coverage: null,
        index: 0,
        requestedTimeMs: null,
        actualSampleTimeMs: null,
        aircraftSampleTimeMs: null,
        vesselSampleTimeMs: null,
        playing: false,
      });
      publish({
        notice: 'This local recording has no replayable observations.',
      });
      return result;
    }
    if (destroyed || selection !== selectionGeneration)
      return { status: 'cancelled' };
    const ids = {
      aircraftRecordingId: type === 'aircraft' ? id : state.aircraftRecordingId,
      vesselRecordingId: type === 'vessel' ? id : state.vesselRecordingId,
    };
    const timeline = combinedTimeline(ids);
    if (!timeline.ticks.length) {
      source.returnLive();
      return { status: 'empty-recording' };
    }
    const first = timeline.ticks[0];
    publish({
      recordingId: id,
      recordingType: type,
      ...ids,
      mode: 'recorded',
      ticks: timeline.ticks,
      gaps: timeline.gaps,
      coverage: timeline.coverage,
      index: 0,
      requestedTimeMs: first,
      actualSampleTimeMs: null,
      aircraftSampleTimeMs: null,
      vesselSampleTimeMs: null,
      playing: false,
      notice: timeline.truncated
        ? 'Recording loaded with an observation index limit; see its export for complete data.'
        : 'Local recording selected. Live observations will not be mixed into this timeline.',
    });
    investigationTime.setTemporalSource?.('recording', id);
    investigationTime.seek(first);
    const resultState = await updateAircraft(first, 0);
    return selection === selectionGeneration
      ? resultState
      : { status: 'cancelled' };
  }

  function seek(value) {
    if (destroyed || state.mode !== 'recorded' || !state.ticks.length)
      return Promise.resolve(state);
    const requested = epoch(value);
    if (requested === null)
      throw new TypeError('A valid investigation time is required');
    const index = Math.max(
      0,
      state.ticks.findLastIndex((tick) => tick <= requested),
    );
    const bounded = Math.max(
      state.ticks[0],
      Math.min(state.ticks.at(-1), requested),
    );
    investigationTime.seek(bounded);
    return updateAircraft(bounded, index);
  }

  function step(direction) {
    const next = Math.max(
      0,
      Math.min(state.ticks.length - 1, state.index + Math.sign(direction)),
    );
    if (!state.ticks.length) return Promise.resolve(state);
    return seek(state.ticks[next]);
  }

  function latest() {
    if (!state.ticks.length) return Promise.resolve(state);
    return seek(state.ticks.at(-1));
  }

  function togglePlay() {
    if (state.mode !== 'recorded' || state.ticks.length < 2) return false;
    if (investigationTime.getState?.().mode === 'replay')
      investigationTime.pause();
    else investigationTime.play(state.rate);
    return true;
  }

  function setRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate === 0 || Math.abs(rate) > 16)
      throw new RangeError('Playback rate must be nonzero and at most 16x');
    publish({ rate });
    investigationTime.setRate?.(rate);
    return rate;
  }

  async function returnLive({ reacquire = true } = {}) {
    if (destroyed) return state;
    const selection = ++selectionGeneration;
    cancelRefresh();
    investigationTime.returnLive();
    aircraftSource.returnLive();
    vesselSource?.returnLive();
    const requestGeneration = generation;
    refreshController = new AbortController();
    let refreshed = false;
    try {
      if (!reacquire) {
        refreshed = false;
      } else {
        const layers = [
          ['flights', dataManager?.isEnabled?.('flights')],
          ['ais-live-vessels', dataManager?.isEnabled?.('ais-live-vessels')],
        ].filter(([, enabled]) => enabled);
        const results = await Promise.allSettled(
          layers.map(([layerId]) =>
            dataManager.refreshLayer(layerId, {
              signal: refreshController.signal,
            }),
          ),
        );
        refreshed = results.some(
          (result) => result.status === 'fulfilled' && result.value === true,
        );
      }
    } catch {
      refreshed = false;
    }
    if (
      destroyed ||
      selection !== selectionGeneration ||
      requestGeneration !== generation
    )
      return state;
    refreshController = null;
    if (arbiterOwned) timelineArbiter.release('investigation');
    arbiterOwned = false;
    publish({
      recordingId: null,
      recordingType: 'aircraft',
      aircraftRecordingId: null,
      vesselRecordingId: null,
      mode: 'live',
      ticks: [],
      gaps: [],
      coverage: null,
      index: 0,
      requestedTimeMs: null,
      actualSampleTimeMs: null,
      aircraftSampleTimeMs: null,
      vesselSampleTimeMs: null,
      playing: false,
      notice: refreshed
        ? 'Live movement feeds refreshed.'
        : 'Live sources selected. Enable aircraft or vessels to reacquire current feeds.',
    });
    return state;
  }

  async function exportSelected() {
    if (!state.recordingId) return null;
    const selectedService =
      state.recordingType === 'vessel'
        ? vesselRecordingService
        : recordingService;
    if (selectedService?.exportRecording)
      return selectedService.exportRecording(state.recordingId);
    const workspace = await storage.getWorkspace(state.recordingId);
    return workspace
      ? {
          format:
            state.recordingType === 'vessel'
              ? 'gods-eye-view-vessel-recording'
              : 'gods-eye-view-aircraft-recording',
          schemaVersion: 1,
          document: workspace.document,
          chunks: workspace.chunks,
        }
      : null;
  }

  async function exportSelectedBundle() {
    const recording = await exportSelected();
    return recording ? createRecordingBundle(recording) : null;
  }

  async function importBundle(input) {
    if (input && typeof input === 'object' && 'size' in input) {
      if (
        !Number.isFinite(input.size) ||
        input.size > MAX_RECORDING_BUNDLE_BYTES
      )
        throw Object.assign(
          new Error('Recording bundle exceeds the 120 MiB limit.'),
          { code: 'recording-too-large' },
        );
      input = await input.text();
    }
    const imported = await importRecordingBundle(input, { storage });
    await refreshRecordings();
    const selected = await selectRecording(
      imported.id,
      imported.kind === 'vessel-recording' ? 'vessel' : 'aircraft',
    );
    if (selected?.status === 'empty-recording')
      publish({
        notice:
          'Recording imported, but it contains no replayable observations.',
      });
    else
      publish({
        notice:
          'Recording bundle verified and imported. Its source attribution and coverage are preserved.',
      });
    return imported;
  }

  async function deleteSelected() {
    const id = state.recordingId;
    if (!id) return false;
    const selectedService =
      state.recordingType === 'vessel'
        ? vesselRecordingService
        : recordingService;
    await returnLive();
    const workspace = await storage.getWorkspace(id);
    if (!workspace) return false;
    const deleted = selectedService?.deleteRecording
      ? await selectedService.deleteRecording(id)
      : await storage.deleteWorkspace(id, {
          expectedRevision: workspace.manifest.revision,
        });
    await refreshRecordings();
    return deleted;
  }

  const unregisterTimelineOwner = timelineArbiter.register?.(
    'investigation',
    () => returnLive({ reacquire: false }),
  );

  void refreshRecordings().catch(() =>
    publish({ notice: 'Saved recordings could not be listed.' }),
  );

  return Object.freeze({
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Timeline listener must be a function');
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    refreshRecordings,
    selectRecording,
    seek,
    step,
    latest,
    togglePlay,
    setRate,
    returnLive,
    exportSelected,
    exportSelectedBundle,
    importBundle,
    deleteSelected,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      selectionGeneration++;
      cancelRefresh();
      unsubscribeClock();
      if (arbiterOwned) timelineArbiter.release('investigation');
      unregisterTimelineOwner?.();
      listeners.clear();
    },
  });
}
