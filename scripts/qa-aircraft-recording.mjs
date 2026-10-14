#!/usr/bin/env node
/** Verify durable bounded aircraft recording in a real browser database. */
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
  const target = new URL('/src/recording/index.js', url);
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await page.setContent('<!doctype html><html><body></body></html>');
  const databaseName = `gev-recording-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const completed = await page.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const { createAircraftRecordingService, createSyntheticAircraftFrames } =
      await import('/src/recording/index.js');
    const storage = createWorkspaceStorage({ name });
    let logicalNow = 0;
    const recording = createAircraftRecordingService({
      storage,
      now: () => logicalNow,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    await recording.start({
      id: 'recording-browser-reload',
      region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
    });
    const frames = createSyntheticAircraftFrames();
    for (let index = 0; index < frames.length; index++) {
      logicalNow = index * 60_000;
      if (index === 1) {
        logicalNow = 30_000;
        await recording.noteSourceUnavailable('fixture-outage');
        logicalNow = index * 60_000;
      }
      await recording.ingest(frames[index]);
    }
    logicalNow = 60 * 60_000;
    const state = await recording.check();
    const exported = await recording.exportRecording(
      'recording-browser-reload',
    );
    const saved = await storage.getWorkspace('recording-browser-reload');
    recording.destroy();
    storage.close();
    return {
      status: state.status,
      stopReason: state.stopReason,
      revision: saved.manifest.revision,
      endedAt: exported.document.endedAt,
      observationChunks: Object.keys(exported.chunks).filter((key) =>
        key.startsWith('observations-'),
      ).length,
    };
  }, databaseName);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.stopReason, 'duration-limit');
  assert.ok(completed.revision > 1);
  assert.equal(completed.endedAt, 3_600_000);
  assert.equal(completed.observationChunks, 1);

  const reloaded = await browser.newPage();
  reloaded.setDefaultNavigationTimeout(90_000);
  reloaded.on('pageerror', (error) =>
    pageErrors.push(error.stack || error.message),
  );
  await reloaded.goto(target.href, { waitUntil: 'domcontentloaded' });
  await reloaded.setContent('<!doctype html><html><body></body></html>');
  const durable = await reloaded.evaluate(async (name) => {
    const { createWorkspaceStorage } = await import('/src/storage/index.js');
    const storage = createWorkspaceStorage({ name });
    const saved = await storage.getWorkspace('recording-browser-reload');
    return {
      saved: saved?.saved,
      status: saved?.document.status,
      endedAt: saved?.document.endedAt,
      rowCount: Object.entries(saved?.chunks || {})
        .filter(([key]) => key.startsWith('observations-'))
        .reduce((count, [, rows]) => count + rows.length, 0),
      gapCount: saved?.chunks.gaps?.length,
    };
  }, databaseName);
  assert.equal(durable.saved, true);
  assert.equal(durable.status, 'complete');
  assert.equal(durable.endedAt, 3_600_000);
  assert.ok(durable.rowCount > 0 && durable.rowCount <= 60);
  assert.ok(durable.gapCount > 0);
  assert.deepEqual(pageErrors, []);
  console.log(
    'Aircraft recording browser QA passed: bounded antimeridian capture, 60-minute stop, durable reload and gap metadata.',
  );
} finally {
  await browser.close();
}
