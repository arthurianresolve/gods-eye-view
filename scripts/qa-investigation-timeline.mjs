#!/usr/bin/env node
/** Exercise the saved aircraft timeline and replay source in real Chrome. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) =>
    pageErrors.push(error.stack || error.message),
  );
  page.setDefaultNavigationTimeout(90_000);
  await page.goto(new URL('/src/ui/investigationTimeline.js', url).href, {
    waitUntil: 'domcontentloaded',
  });
  await page.setContent('<!doctype html><html><body></body></html>');
  const databaseName = `gev-timeline-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await page.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const {
      createAircraftRecordingService,
      createRecordedAircraftSource,
      createSyntheticAircraftFrames,
      recordingBundleStream,
      createAircraftSourceRouter,
      createRecordedVesselSource,
      createVesselRecordingService,
      createVesselSourceRouter,
    } = await import('/src/recording/index.js');
    const { createInvestigationClock, createTimelineArbiter } =
      await import('/src/time/index.js');
    const { createInvestigationTimeline } =
      await import('/src/ui/investigationTimeline.js');
    const storage = createWorkspaceStorage({ name });
    const startAt = 1_700_000_000_000;
    let logicalNow = startAt;
    const clock = createInvestigationClock({ now: () => logicalNow });
    const recorder = createAircraftRecordingService({
      storage,
      investigationTime: clock,
      now: () => logicalNow,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const recordingId = 'recording-browser-timeline';
    await recorder.start({
      id: recordingId,
      region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
    });
    const frames = createSyntheticAircraftFrames({
      startAt,
      sampleCount: 4,
      intervalMs: 60_000,
    });
    await recorder.ingest(frames[0]);
    logicalNow = startAt + 90_000;
    await recorder.noteSourceUnavailable('fixture-outage');
    await recorder.ingest(frames[2]);
    logicalNow = startAt + 180_000;
    await recorder.ingest(frames[3]);
    await recorder.stop('qa-complete');

    logicalNow = startAt;
    const vesselRecorder = createVesselRecordingService({
      storage,
      now: () => logicalNow,
      setInterval: () => 2,
      clearInterval: () => {},
    });
    const vesselRecordingId = 'vessel-recording-browser-timeline';
    await vesselRecorder.start({
      id: vesselRecordingId,
      region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
    });
    await vesselRecorder.ingest({
      receivedAt: startAt,
      observations: [
        {
          id: 'VESSEL-QA',
          latitude: 0.01,
          longitude: 179.8,
          observedAtMs: startAt,
          name: 'Synthetic Vessel',
        },
      ],
    });
    logicalNow = startAt + 120_000;
    await vesselRecorder.ingest({
      receivedAt: logicalNow,
      observations: [
        {
          id: 'VESSEL-QA',
          latitude: 0.02,
          longitude: 179.82,
          observedAtMs: logicalNow,
          name: 'Synthetic Vessel',
        },
      ],
    });
    logicalNow = startAt + 180_000;
    await vesselRecorder.stop('qa-complete');

    const captureRecorder = createAircraftRecordingService({
      storage,
      investigationTime: clock,
      now: () => logicalNow,
      setInterval: () => 3,
      clearInterval: () => {},
    });
    const captureVesselRecorder = createVesselRecordingService({
      storage,
      now: () => logicalNow,
      setInterval: () => 4,
      clearInterval: () => {},
    });

    const live = {
      label: 'Synthetic live feed',
      async getSnapshot() {
        return { records: [], observedAtMs: logicalNow };
      },
    };
    const aircraftSource = createAircraftSourceRouter({
      live,
      recorded: createRecordedAircraftSource({ storage }),
    });
    const vesselSource = createVesselSourceRouter({
      live: {
        label: 'Synthetic live AIS',
        async getSnapshot() {
          return { records: [], observedAtMs: logicalNow };
        },
        async getTrack() {
          return { records: [] };
        },
      },
      recorded: createRecordedVesselSource({ storage }),
    });
    const timelineArbiter = createTimelineArbiter();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dataManager = {
      viewer: {
        camera: {
          positionCartographic: {
            latitude: 0,
            longitude: (179.7 * Math.PI) / 180,
          },
        },
      },
      layers: new Map([
        ['flights', { enabled: true, module: { source: 'OpenSky Network' } }],
        [
          'ais-live-vessels',
          { enabled: true, module: { source: 'AIS Stream' } },
        ],
      ]),
    };
    const timeline = createInvestigationTimeline({
      container: host,
      storage,
      aircraftSource,
      vesselSource,
      investigationTime: clock,
      timelineArbiter,
      dataManager,
      recordingService: captureRecorder,
      vesselRecordingService: captureVesselRecorder,
    });
    await timeline.refresh();
    const select = host.querySelector(
      '.investigation-timeline-aircraft-select',
    );
    const vesselSelect = host.querySelector(
      '.investigation-timeline-vessel-select',
    );
    const slider = host.querySelector('.investigation-timeline-slider-control');
    const optionCount = select.options.length;
    select.value = recordingId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (timeline.controller.getState().aircraftRecordingId === recordingId)
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const aircraftBundle = await timeline.controller.exportSelectedBundle();
    const aircraftBundleText = await new Response(
      recordingBundleStream(aircraftBundle),
    ).text();
    vesselSelect.value = vesselRecordingId;
    vesselSelect.dispatchEvent(new Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        timeline.controller.getState().vesselRecordingId === vesselRecordingId
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const selectedMode = host.querySelector('.investigation-timeline').dataset
      .mode;
    const requestedText = host.querySelector(
      '.investigation-timeline-times',
    ).textContent;
    const gapCount = host.querySelectorAll(
      '.investigation-timeline-gaps li',
    ).length;
    const replaySourceMode = aircraftSource.getState().mode;
    const selectedSampleCount = (await aircraftSource.getSnapshot()).records
      .length;
    const replayVesselMode = vesselSource.getState().mode;
    const selectedVesselCount = (await vesselSource.getSnapshot()).records
      .length;
    host
      .querySelector('.investigation-timeline-controls button:last-child')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const liveMode = host.querySelector('.investigation-timeline').dataset.mode;
    const liveSourceMode = aircraftSource.getState().mode;
    const liveVesselMode = vesselSource.getState().mode;

    const captureNotice = host.querySelector(
      '.investigation-timeline-capture-notice',
    );
    host.querySelector('.investigation-timeline-start-aircraft').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureNotice.textContent.includes('no approved retention')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const aircraftPolicyDenied = captureNotice.textContent.includes(
      'OpenSky Network has no approved retention and export policy',
    );
    const aircraftNotStarted = captureRecorder.getState()?.status !== 'active';
    dataManager.layers.get('flights').module.source = 'synthetic-fixture';
    host.querySelector('.investigation-timeline-start-aircraft').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureRecorder.getState()?.status === 'active') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await captureRecorder.ingest({
      sourceId: 'synthetic-fixture',
      observations: [
        {
          id: 'CAPTURE-QA',
          observedAt: startAt + 190_000,
          latitude: 0,
          longitude: 179.7,
        },
      ],
    });
    const aircraftCaptureCount = host.querySelector(
      '.investigation-timeline-aircraft-capture-status',
    ).textContent;
    host.querySelector('.investigation-timeline-stop-aircraft').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureRecorder.getState()?.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureNotice.textContent.includes('stopped and saved')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    captureNotice.textContent = '';
    const vesselStartDisabled = host.querySelector(
      '.investigation-timeline-start-vessel',
    ).disabled;
    const vesselStatusBeforeStart = host.querySelector(
      '.investigation-timeline-vessel-capture-status',
    ).textContent;
    host.querySelector('.investigation-timeline-start-vessel').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureNotice.textContent.includes('no approved retention')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const vesselPolicyNotice = captureNotice.textContent;
    const vesselPolicyDenied = captureNotice.textContent.includes(
      'AIS Stream has no approved retention and export policy',
    );
    const vesselNotStarted =
      captureVesselRecorder.getState()?.status !== 'active';
    dataManager.layers.get('ais-live-vessels').module.source =
      'synthetic-vessel-fixture';
    host.querySelector('.investigation-timeline-start-vessel').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureVesselRecorder.getState()?.status === 'active') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const vesselCaptureIngest = await captureVesselRecorder.ingest({
      sourceId: 'synthetic-vessel-fixture',
      observations: [
        {
          id: '123456789',
          observedAtMs: startAt + 190_000,
          latitude: 0,
          longitude: 179.7,
          name: 'Capture QA Vessel',
        },
      ],
    });
    const vesselCaptureCount = host.querySelector(
      '.investigation-timeline-vessel-capture-status',
    ).textContent;
    host.querySelector('.investigation-timeline-stop-vessel').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (captureVesselRecorder.getState()?.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const captureRegionDefaults = {
      latitude: host.querySelector('[data-capture-region="latitude"]')?.value,
      longitude: host.querySelector('[data-capture-region="longitude"]')?.value,
      radiusKm: host.querySelector('[data-capture-region="radiusKm"]')?.value,
    };
    timeline.destroy();
    aircraftSource.destroy();
    vesselSource.destroy();
    timelineArbiter.destroy();
    recorder.destroy();
    vesselRecorder.destroy();
    captureRecorder.destroy();
    captureVesselRecorder.destroy();
    clock.destroy();
    storage.close();
    return {
      optionCount,
      aircraftBundleText,
      sliderPresent: Boolean(slider),
      selectedMode,
      requestedText,
      gapCount,
      replaySourceMode,
      selectedSampleCount,
      replayVesselMode,
      selectedVesselCount,
      liveMode,
      liveSourceMode,
      liveVesselMode,
      captureRegionDefaults,
      aircraftPolicyDenied,
      aircraftNotStarted,
      aircraftCaptureCount,
      aircraftStopped: captureRecorder.getState()?.status === 'complete',
      vesselPolicyDenied,
      vesselPolicyNotice,
      vesselStartDisabled,
      vesselStatusBeforeStart,
      vesselNotStarted,
      vesselCaptureCount,
      vesselCaptureIngestAccepted: vesselCaptureIngest.accepted,
      vesselStopped: captureVesselRecorder.getState()?.status === 'complete',
    };
  }, databaseName);

  assert.ok(
    result.optionCount >= 2,
    'saved aircraft recording appears in selector',
  );
  assert.equal(result.sliderPresent, true);
  assert.equal(result.selectedMode, 'recorded');
  assert.match(
    result.requestedText,
    /Requested:.*Aircraft sample:.*Vessel sample:/,
  );
  assert.ok(result.gapCount > 0, 'provider outage is visible on the timeline');
  assert.equal(result.replaySourceMode, 'recorded');
  assert.equal(result.selectedSampleCount, 1);
  assert.equal(result.replayVesselMode, 'recorded');
  assert.equal(result.selectedVesselCount, 1);
  assert.equal(result.liveMode, 'live');
  assert.equal(result.liveSourceMode, 'live');
  assert.equal(result.liveVesselMode, 'live');
  assert.deepEqual(result.captureRegionDefaults, {
    latitude: '0',
    longitude: '179.7',
    radiusKm: '25',
  });
  assert.equal(result.aircraftPolicyDenied, true);
  assert.equal(result.aircraftNotStarted, true);
  assert.match(result.aircraftCaptureCount, /1 fix\(es\)/);
  assert.equal(result.aircraftStopped, true);
  assert.equal(result.vesselStartDisabled, false);
  assert.match(result.vesselStatusBeforeStart, /Vessel source: AIS Stream/);
  assert.equal(result.vesselPolicyDenied, true, result.vesselPolicyNotice);
  assert.equal(result.vesselNotStarted, true);
  assert.equal(result.vesselCaptureIngestAccepted, 1);
  assert.match(result.vesselCaptureCount, /1 fix\(es\)/);
  assert.equal(result.vesselStopped, true);

  const transferContext = await browser.createBrowserContext();
  try {
    const transferPage = await transferContext.newPage();
    await transferPage.goto(new URL('/src/storage/index.js', url).href, {
      waitUntil: 'domcontentloaded',
    });
    await transferPage.setContent('<!doctype html><html><body></body></html>');
    const transferDatabaseName = `gev-timeline-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const transfer = await transferPage.evaluate(
      async ({ bundleText, name }) => {
        const { createWorkspaceStorage } =
          await import('/src/storage/index.js');
        const { createRecordedAircraftSource, importRecordingBundle } =
          await import('/src/recording/index.js');
        const storage = createWorkspaceStorage({ name });
        const before = await storage.listWorkspaces();
        const imported = await importRecordingBundle(bundleText, {
          storage,
          idFactory: () => 'transferred-aircraft-recording',
          now: () => 1_700_000_500_000,
        });
        const source = createRecordedAircraftSource({ storage });
        const selected = await source.selectRecording(imported.id);
        const snapshot = await source.getSnapshot();
        const workspace = await storage.getWorkspace(imported.id);
        const after = await storage.listWorkspaces();
        const coverage = source.getState().coverage;
        storage.close();
        return {
          beforeCount: before.length,
          afterCount: after.length,
          importedId: imported.id,
          newIdentity: imported.id !== 'recording-browser-timeline',
          policy: workspace.document.sourcePolicy,
          selectedStatus: selected.status,
          recordCount: selected.recordCount,
          snapshotCount: snapshot.records.length,
          entityId: snapshot.records[0]?.id,
          coverage,
        };
      },
      { bundleText: result.aircraftBundleText, name: transferDatabaseName },
    );
    assert.equal(transfer.beforeCount, 0, 'fresh browser profile starts empty');
    assert.equal(transfer.afterCount, 1);
    assert.equal(transfer.importedId, 'transferred-aircraft-recording');
    assert.equal(transfer.newIdentity, true);
    assert.equal(transfer.policy.policyId, 'synthetic-fixture-v1');
    assert.equal(transfer.selectedStatus, 'selected');
    assert.ok(transfer.recordCount >= 1);
    assert.equal(transfer.snapshotCount, 1);
    assert.equal(transfer.entityId, 'SYNTH-001');
    assert.ok(transfer.coverage.from <= transfer.coverage.to);
  } finally {
    await transferContext.close();
  }
  assert.deepEqual(pageErrors, []);
  console.log(
    'Investigation timeline browser QA passed: aligned replay, visible gaps, source-policy denials, bounded capture controls, return to live and recording transfer into a fresh browser profile.',
  );
} finally {
  await browser.close();
}
