import { createRailTimeline } from './railTimeline.js';
import { createInvestigationTimelineController } from './investigationTimelineController.js';
import { recordingBundleStream } from '../recording/bundle.js';
import { t } from '../i18n/index.js';

function iso(value) {
  if (!Number.isFinite(value)) return t('Unavailable');
  try {
    return new Date(value)
      .toISOString()
      .replace('T', ' ')
      .replace('.000Z', ' UTC');
  } catch {
    return 'Unavailable';
  }
}

function button(document, label, title) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'data-toggle-chip';
  node.textContent = label;
  node.title = title;
  return node;
}

function captureSource(dataManager, layerId) {
  const entry = dataManager?.layers?.get?.(layerId);
  const source = entry?.module?.source;
  return entry?.enabled && typeof source === 'string' && source.trim()
    ? source.trim()
    : null;
}

function cameraCoordinate(dataManager, key) {
  const value = dataManager?.viewer?.camera?.positionCartographic?.[key];
  return Number.isFinite(value) ? (value * 180) / Math.PI : 0;
}

/** Mount an accessible local aircraft and vessel history timeline. */
export function createInvestigationTimeline({
  container,
  storage,
  aircraftSource,
  vesselSource,
  investigationTime,
  timelineArbiter,
  dataManager,
  viewer,
  recordingService,
  vesselRecordingService,
  confirmHandoff,
} = {}) {
  const document = container?.ownerDocument;
  if (
    !container ||
    !document?.createElement ||
    !storage?.listWorkspaces ||
    !aircraftSource?.selectRecording ||
    !investigationTime?.seek ||
    !timelineArbiter?.claim
  )
    return null;

  const root = document.createElement('section');
  root.className = 'investigation-timeline';
  root.setAttribute('aria-label', t('Investigation timeline'));
  const heading = document.createElement('h3');
  heading.className = 'data-layer-group-heading';
  heading.textContent = t('INVESTIGATION TIMELINE');
  const captureGroup = document.createElement('fieldset');
  captureGroup.className = 'investigation-timeline-capture';
  const captureLegend = document.createElement('legend');
  captureLegend.textContent = t('Local region capture');
  const captureHelp = document.createElement('p');
  captureHelp.textContent = t(
    'Starts at the camera position. Radius is limited to 250 km; source retention and export permission is checked before capture.',
  );
  const captureRegion = document.createElement('div');
  captureRegion.className = 'investigation-timeline-capture-region';
  const coordinateInput = (label, name, value, min, max, step) => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = name;
    input.dataset.captureRegion = name;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.setAttribute('aria-label', label);
    wrapper.appendChild(input);
    captureRegion.appendChild(wrapper);
    return input;
  };
  const captureLatitude = coordinateInput(
    'Latitude',
    'latitude',
    cameraCoordinate(viewer ? { viewer } : dataManager, 'latitude'),
    -90,
    90,
    0.0001,
  );
  const captureLongitude = coordinateInput(
    'Longitude',
    'longitude',
    cameraCoordinate(viewer ? { viewer } : dataManager, 'longitude'),
    -180,
    180,
    0.0001,
  );
  const captureRadius = coordinateInput(
    'Radius (km)',
    'radiusKm',
    25,
    0.01,
    250,
    1,
  );
  const captureActions = document.createElement('div');
  captureActions.className = 'investigation-timeline-capture-actions';
  const startAircraftCapture = button(
    document,
    'Start aircraft capture',
    'Record accepted aircraft fixes in this region while the source policy permits it',
  );
  startAircraftCapture.classList.add('investigation-timeline-start-aircraft');
  const stopAircraftCapture = button(
    document,
    'Stop aircraft capture',
    'Stop and save the active aircraft recording',
  );
  stopAircraftCapture.classList.add('investigation-timeline-stop-aircraft');
  const startVesselCapture = button(
    document,
    'Start vessel capture',
    'Record accepted vessel fixes in this region while the source policy permits it',
  );
  startVesselCapture.classList.add('investigation-timeline-start-vessel');
  const stopVesselCapture = button(
    document,
    'Stop vessel capture',
    'Stop and save the active vessel recording',
  );
  stopVesselCapture.classList.add('investigation-timeline-stop-vessel');
  const captureNotice = document.createElement('div');
  captureNotice.className = 'investigation-timeline-capture-notice';
  captureNotice.setAttribute('role', 'status');
  captureNotice.setAttribute('aria-live', 'polite');
  const aircraftCaptureStatus = document.createElement('div');
  aircraftCaptureStatus.className =
    'investigation-timeline-aircraft-capture-status';
  aircraftCaptureStatus.setAttribute('aria-live', 'polite');
  const vesselCaptureStatus = document.createElement('div');
  vesselCaptureStatus.className =
    'investigation-timeline-vessel-capture-status';
  vesselCaptureStatus.setAttribute('aria-live', 'polite');
  captureActions.append(
    startAircraftCapture,
    stopAircraftCapture,
    startVesselCapture,
    stopVesselCapture,
  );
  captureGroup.append(
    captureLegend,
    captureHelp,
    captureRegion,
    captureActions,
    aircraftCaptureStatus,
    vesselCaptureStatus,
    captureNotice,
  );
  const selectionLabel = document.createElement('label');
  selectionLabel.className = 'investigation-timeline-select-label';
  selectionLabel.textContent = t('Saved aircraft recording');
  const selection = document.createElement('select');
  selection.className =
    'investigation-timeline-select investigation-timeline-aircraft-select';
  selection.setAttribute('aria-label', t('Saved aircraft recording'));
  selectionLabel.appendChild(selection);
  const vesselSelectionLabel = document.createElement('label');
  vesselSelectionLabel.className = 'investigation-timeline-select-label';
  vesselSelectionLabel.textContent = t('Saved vessel recording');
  const vesselSelection = document.createElement('select');
  vesselSelection.className =
    'investigation-timeline-select investigation-timeline-vessel-select';
  vesselSelection.setAttribute('aria-label', t('Saved vessel recording'));
  vesselSelectionLabel.appendChild(vesselSelection);
  const coverage = document.createElement('div');
  coverage.className = 'investigation-timeline-coverage';
  const sliderHost = document.createElement('div');
  sliderHost.className = 'investigation-timeline-slider';
  const times = document.createElement('div');
  times.className = 'investigation-timeline-times';
  times.setAttribute('aria-live', 'polite');
  times.setAttribute('aria-atomic', 'true');
  const gaps = document.createElement('ul');
  gaps.className = 'investigation-timeline-gaps';
  gaps.setAttribute('aria-label', t('Recorded coverage gaps'));
  const notice = document.createElement('div');
  notice.className = 'investigation-timeline-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div');
  controls.className = 'investigation-timeline-controls';
  const rateLabel = document.createElement('label');
  rateLabel.textContent = t('Speed');
  const rate = document.createElement('select');
  rate.className = 'investigation-timeline-rate';
  rate.setAttribute('aria-label', t('Replay speed'));
  for (const [value, label] of [
    ['-1', 'Reverse 1×'],
    ['0.5', '0.5×'],
    ['1', '1×'],
    ['2', '2×'],
    ['4', '4×'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(label);
    rate.appendChild(option);
  }
  rate.value = '1';
  rateLabel.appendChild(rate);
  const exportButton = button(
    document,
    t('Export'),
    t('Download the selected local recording'),
  );
  const importButton = button(
    document,
    t('Import bundle'),
    t('Verify and add an aircraft or vessel recording bundle'),
  );
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.gev-recording-bundle.json,application/json';
  importInput.hidden = true;
  importInput.setAttribute('aria-label', t('Select a recording bundle'));
  const deleteButton = button(
    document,
    'Delete',
    'Delete the selected local recording',
  );
  const liveButton = button(
    document,
    'Return live',
    'Return to live aircraft and vessel feeds',
  );
  controls.append(
    rateLabel,
    exportButton,
    importButton,
    deleteButton,
    liveButton,
  );
  root.append(
    heading,
    captureGroup,
    selectionLabel,
    vesselSelectionLabel,
    coverage,
    sliderHost,
    times,
    gaps,
    controls,
    importInput,
    notice,
  );
  container.appendChild(root);

  const controller = createInvestigationTimelineController({
    storage,
    aircraftSource,
    vesselSource,
    investigationTime,
    timelineArbiter,
    dataManager,
    recordingService,
    vesselRecordingService,
    confirmHandoff:
      confirmHandoff ||
      (({ from, to }) =>
        document.defaultView?.confirm?.(
          `${from} owns the scene timeline. Hand it to ${to}?`,
        ) === true),
  });
  const timeline = createRailTimeline({
    container: sliderHost,
    document,
    sliderClassName: 'investigation-timeline-slider-control',
    heading: false,
    onCommit: (tick) => void controller.seek(tick),
    onPreview: (tick) => `Requested ${iso(Date.parse(tick))}`,
    onStep: (direction) => void controller.step(direction),
    onLatest: () => void controller.latest(),
    onPlay: () => controller.togglePlay(),
  });

  let destroyed = false;
  let optionSignature = '';
  let aircraftCapture = null;
  let vesselCapture = null;
  let aircraftCaptureStarting = false;
  let vesselCaptureStarting = false;
  const renderCaptureState = () => {
    if (destroyed) return;
    const aircraftSourceId = captureSource(dataManager, 'flights');
    const vesselSourceId = captureSource(dataManager, 'ais-live-vessels');
    const aircraftActive = aircraftCapture?.status === 'active';
    const vesselActive = vesselCapture?.status === 'active';
    startAircraftCapture.disabled =
      !recordingService ||
      !aircraftSourceId ||
      aircraftActive ||
      aircraftCaptureStarting;
    stopAircraftCapture.disabled = !aircraftActive;
    startVesselCapture.disabled =
      !vesselRecordingService ||
      !vesselSourceId ||
      vesselActive ||
      vesselCaptureStarting;
    stopVesselCapture.disabled = !vesselActive;
    aircraftCaptureStatus.textContent = aircraftActive
      ? t('Aircraft capture: {source} · {fixes} fix(es) · {gaps} gap(s).', {
          source: aircraftCapture.sourceId,
          fixes: aircraftCapture.observationCount,
          gaps: aircraftCapture.gapCount,
        })
      : aircraftSourceId
        ? t('Aircraft source: {source}.', { source: aircraftSourceId })
        : t(
            'Aircraft capture unavailable: enable the Flights layer to select its current source.',
          );
    vesselCaptureStatus.textContent = vesselActive
      ? t('Vessel capture: {source} · {fixes} fix(es) · {gaps} gap(s).', {
          source: vesselCapture.sourceId,
          fixes: vesselCapture.positionCount,
          gaps: vesselCapture.gapCount,
        })
      : vesselSourceId
        ? t('Vessel source: {source}.', { source: vesselSourceId })
        : t(
            'Vessel capture unavailable: enable the AIS live-vessels layer to select its current source.',
          );
  };
  function render(state) {
    if (destroyed) return;
    const nextSignature = state.recordings
      .map(
        (record) =>
          `${record.id}\u0000${record.title}\u0000${record.updatedAt}`,
      )
      .join('\u0001');
    if (nextSignature !== optionSignature) {
      optionSignature = nextSignature;
      for (const [control, kind, label] of [
        [selection, 'aircraft-recording', 'aircraft'],
        [vesselSelection, 'vessel-recording', 'vessel'],
      ]) {
        const records = state.recordings.filter(
          (record) => record.kind === kind,
        );
        control.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = records.length
          ? t('Choose a {type} recording…', { type: label })
          : t('No saved {type} recordings', { type: label });
        control.appendChild(placeholder);
        for (const record of records) {
          const option = document.createElement('option');
          option.value = record.id;
          option.textContent = record.title || record.id;
          control.appendChild(option);
        }
      }
    }
    selection.value = state.aircraftRecordingId || '';
    vesselSelection.value = state.vesselRecordingId || '';
    const hasRecording = state.mode === 'recorded' && state.recordingId;
    const tickStrings = state.ticks.map((tick) => {
      try {
        return new Date(tick).toISOString();
      } catch {
        return '';
      }
    });
    timeline?.update({
      ticks: tickStrings,
      index: state.index,
      mode: hasRecording ? 'history' : 'latest',
      playing: state.playing,
      disabled: !hasRecording || state.ticks.length < 2,
      readout: hasRecording
        ? t('Replay · {time}', { time: iso(state.requestedTimeMs) })
        : t('Live'),
    });
    coverage.textContent = state.coverage
      ? t('Coverage {from} — {to}{gaps}', {
          from: iso(state.coverage.from),
          to: iso(state.coverage.to),
          gaps: state.gaps.length
            ? t(' · {count} gap(s)', { count: state.gaps.length })
            : '',
        })
      : t('Coverage appears after a recording is selected.');
    times.textContent = hasRecording
      ? t(
          'Requested: {requested} · Aircraft sample: {aircraft} · Vessel sample: {vessel}',
          {
            requested: iso(state.requestedTimeMs),
            aircraft: iso(state.aircraftSampleTimeMs),
            vessel: iso(state.vesselSampleTimeMs),
          },
        )
      : t('Requested time and actual sample time will be shown separately.');
    gaps.replaceChildren();
    for (const gap of state.gaps) {
      const item = document.createElement('li');
      item.textContent = `${iso(gap.startedAt)} – ${iso(gap.endedAt)} · ${gap.reason}`;
      gaps.appendChild(item);
    }
    gaps.hidden = state.gaps.length === 0;
    rate.disabled = !hasRecording;
    if (rate.value !== String(state.rate)) rate.value = String(state.rate);
    exportButton.disabled = !hasRecording;
    deleteButton.disabled = !hasRecording;
    liveButton.disabled = state.mode !== 'recorded';
    notice.textContent = state.notice;
    root.dataset.mode = state.mode;
    renderCaptureState();
  }

  const unsubscribe = controller.subscribe(render);
  const unsubscribeAircraftCapture = recordingService?.subscribe?.((state) => {
    aircraftCapture = state;
    renderCaptureState();
  });
  const unsubscribeVesselCapture = vesselRecordingService?.subscribe?.(
    (state) => {
      vesselCapture = state;
      renderCaptureState();
    },
  );
  const onSelection = (kind) => (event) => {
    if (event.currentTarget.value)
      void controller.selectRecording(event.currentTarget.value, kind);
  };
  const onAircraftSelection = onSelection('aircraft');
  const onVesselSelection = onSelection('vessel');
  const onRate = () => controller.setRate(rate.value);
  const onReturnLive = () => void controller.returnLive();
  const startCapture = (kind) => async () => {
    const service =
      kind === 'aircraft' ? recordingService : vesselRecordingService;
    const sourceId = captureSource(
      dataManager,
      kind === 'aircraft' ? 'flights' : 'ais-live-vessels',
    );
    if (!service || !sourceId) return;
    if (kind === 'aircraft' ? aircraftCaptureStarting : vesselCaptureStarting)
      return;
    if (kind === 'aircraft') aircraftCaptureStarting = true;
    else vesselCaptureStarting = true;
    renderCaptureState();
    const idPrefix = kind === 'aircraft' ? 'recording-' : 'vessel-recording-';
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const region = {
      center: {
        latitude: Number(captureLatitude.value),
        longitude: Number(captureLongitude.value),
      },
      radiusKm: Number(captureRadius.value),
    };
    try {
      await service.start({ id: `${idPrefix}${suffix}`, sourceId, region });
      captureNotice.textContent = t('{kind} recording started for {source}.', {
        kind: t(kind === 'aircraft' ? 'Aircraft' : 'Vessel'),
        source: sourceId,
      });
      await controller.refreshRecordings();
    } catch (error) {
      captureNotice.textContent = t('Recording was not started: {reason}', {
        reason:
          error?.message || t('the source or region could not be validated.'),
      });
    } finally {
      if (kind === 'aircraft') aircraftCaptureStarting = false;
      else vesselCaptureStarting = false;
      renderCaptureState();
    }
  };
  const onStartAircraftCapture = startCapture('aircraft');
  const onStartVesselCapture = startCapture('vessel');
  const onStopAircraftCapture = async () => {
    try {
      await recordingService?.stop?.('user');
      await controller.refreshRecordings();
      captureNotice.textContent = t('Aircraft recording stopped and saved.');
    } catch (error) {
      captureNotice.textContent = t(
        'Aircraft recording could not be saved: {error}',
        { error: error?.message || t('storage error.') },
      );
    }
  };
  const onStopVesselCapture = async () => {
    try {
      await vesselRecordingService?.stop?.('user');
      await controller.refreshRecordings();
      captureNotice.textContent = t('Vessel recording stopped and saved.');
    } catch (error) {
      captureNotice.textContent = t(
        'Vessel recording could not be saved: {error}',
        { error: error?.message || t('storage error.') },
      );
    }
  };
  const onExport = async () => {
    try {
      const data = await controller.exportSelectedBundle();
      if (!data || typeof Blob === 'undefined') return;
      const blob = await new Response(recordingBundleStream(data)).blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${controller.getState().recordingId}.gev-recording-bundle.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      notice.textContent = t('The selected recording could not be exported.');
    }
  };
  const onImport = () => importInput.click();
  const onImportFile = async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      await controller.importBundle(file);
    } catch (error) {
      notice.textContent =
        error?.code === 'recording-too-large'
          ? t('That recording bundle exceeds the 120 MiB import limit.')
          : t('The recording bundle failed validation and was not imported.');
    }
  };
  const onDelete = async () => {
    const id = controller.getState().recordingId;
    if (!id) return;
    if (
      !document.defaultView?.confirm?.(
        t('Delete local recording {id}?', { id }),
      )
    )
      return;
    try {
      await controller.deleteSelected();
    } catch {
      notice.textContent = t('The selected recording could not be deleted.');
    }
  };
  selection.addEventListener('change', onAircraftSelection);
  vesselSelection.addEventListener('change', onVesselSelection);
  rate.addEventListener('change', onRate);
  liveButton.addEventListener('click', onReturnLive);
  exportButton.addEventListener('click', onExport);
  importButton.addEventListener('click', onImport);
  importInput.addEventListener('change', onImportFile);
  deleteButton.addEventListener('click', onDelete);
  startAircraftCapture.addEventListener('click', onStartAircraftCapture);
  stopAircraftCapture.addEventListener('click', onStopAircraftCapture);
  startVesselCapture.addEventListener('click', onStartVesselCapture);
  stopVesselCapture.addEventListener('click', onStopVesselCapture);

  return Object.freeze({
    controller,
    refresh: () => controller.refreshRecordings(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      unsubscribeAircraftCapture?.();
      unsubscribeVesselCapture?.();
      selection.removeEventListener('change', onAircraftSelection);
      vesselSelection.removeEventListener('change', onVesselSelection);
      rate.removeEventListener('change', onRate);
      liveButton.removeEventListener('click', onReturnLive);
      exportButton.removeEventListener('click', onExport);
      importButton.removeEventListener('click', onImport);
      importInput.removeEventListener('change', onImportFile);
      deleteButton.removeEventListener('click', onDelete);
      startAircraftCapture.removeEventListener('click', onStartAircraftCapture);
      stopAircraftCapture.removeEventListener('click', onStopAircraftCapture);
      startVesselCapture.removeEventListener('click', onStartVesselCapture);
      stopVesselCapture.removeEventListener('click', onStopVesselCapture);
      timeline?.destroy();
      controller.destroy();
      root.remove();
    },
  });
}
