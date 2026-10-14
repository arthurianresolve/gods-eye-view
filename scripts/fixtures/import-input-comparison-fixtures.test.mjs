import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { IMPORT_LIMITS, parseCsv } from '../../src/imports/geojsonCsv.js';
import {
  createImportComparisonPageStateTracker,
  createImportInputComparisonFixtures,
  IMPORT_INPUT_COMPARISON_FIXTURE_SHA256,
  runAndRecordImportComparisonPair,
} from './import-input-comparison-fixtures.mjs';

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

function createFakePageState() {
  const documentRef = new FakeEventTarget();
  const windowRef = new FakeEventTarget();
  documentRef.visibilityState = 'visible';
  documentRef.focused = true;
  documentRef.hasFocus = () => documentRef.focused;
  return { documentRef, windowRef };
}

test('browser input comparison fixtures retain exact attribution inputs', () => {
  const [csv, geojson] = createImportInputComparisonFixtures();
  const rows = parseCsv(csv.text).rows;
  const collection = JSON.parse(geojson.text);
  const fixtureRows = [csv, geojson];
  const bytes = fixtureRows.map((fixture) =>
    new TextEncoder().encode(fixture.text),
  );
  const hashes = bytes.map((input) =>
    createHash('sha256').update(input).digest('hex'),
  );

  assert.deepEqual(
    fixtureRows.map(({ kind, count, firstId, lastId }) => ({
      kind,
      count,
      firstId,
      lastId,
    })),
    [
      { kind: 'csv', count: 50_000, firstId: '0', lastId: '49999' },
      { kind: 'geojson', count: 25_000, firstId: '0', lastId: '24999' },
    ],
  );
  assert.ok(bytes.every((input) => input.byteLength <= IMPORT_LIMITS.bytes));
  assert.equal(csv.text.startsWith('id,latitude,longitude,label\r\n'), true);
  assert.equal(rows.length, csv.count);
  assert.equal(rows[0][0], csv.firstId);
  assert.equal(rows.at(-1)[0], csv.lastId);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, geojson.count);
  assert.equal(collection.features[0].id, geojson.firstId);
  assert.equal(collection.features.at(-1).id, geojson.lastId);
  assert.deepEqual(hashes, [
    '08fd9f3332affc16a600018b7648b0a90c5b8dbcb29758a16e3864200b089e5d',
    '8c2077a1ab3d030c4327558cb66a2bc58bffd01e08642310a9fa480e25a1f756',
  ]);
  assert.deepEqual(IMPORT_INPUT_COMPARISON_FIXTURE_SHA256, {
    csv: hashes[0],
    geojson: hashes[1],
  });
});

test('comparison page-state evidence is valid only while DOM-visible and focused', () => {
  const { documentRef, windowRef } = createFakePageState();
  const tracker = createImportComparisonPageStateTracker(
    documentRef,
    windowRef,
  );
  windowRef.dispatch('focus');
  const evidence = tracker.finish();
  assert.equal(evidence.valid, true);
  assert.deepEqual(evidence.events, { visibilityChange: 0, blur: 0, focus: 1 });
  assert.equal(evidence.start.visibilityState, 'visible');
  assert.equal(evidence.start.hasFocus, true);
  assert.equal(evidence.end.visibilityState, 'visible');
  assert.equal(evidence.end.hasFocus, true);
  assert.equal(evidence.start.osOcclusionChecked, false);
  assert.match(evidence.scope, /OS occlusion is not checked/);
  assert.equal(windowRef.listeners.get('focus')?.size, 0);
  assert.equal(windowRef.listeners.get('blur')?.size, 0);
  assert.equal(documentRef.listeners.get('visibilitychange')?.size, 0);
});

test('comparison page-state evidence rejects hidden or blurred intervals even after recovery', () => {
  const hiddenPage = createFakePageState();
  const hiddenTracker = createImportComparisonPageStateTracker(
    hiddenPage.documentRef,
    hiddenPage.windowRef,
  );
  hiddenPage.documentRef.visibilityState = 'hidden';
  hiddenPage.documentRef.dispatch('visibilitychange');
  hiddenPage.documentRef.visibilityState = 'visible';
  hiddenPage.documentRef.dispatch('visibilitychange');
  const hiddenEvidence = hiddenTracker.finish();
  assert.equal(hiddenEvidence.end.visibilityState, 'visible');
  assert.equal(hiddenEvidence.becameHidden, true);
  assert.equal(hiddenEvidence.valid, false);

  const blurredPage = createFakePageState();
  const blurredTracker = createImportComparisonPageStateTracker(
    blurredPage.documentRef,
    blurredPage.windowRef,
  );
  blurredPage.windowRef.dispatch('blur');
  blurredPage.documentRef.focused = true;
  blurredPage.windowRef.dispatch('focus');
  const blurredEvidence = blurredTracker.finish();
  assert.equal(blurredEvidence.end.hasFocus, true);
  assert.equal(blurredEvidence.lostFocus, true);
  assert.equal(blurredEvidence.valid, false);
});

test('comparison page-state evidence rejects an initially unfocused page', () => {
  const page = createFakePageState();
  page.documentRef.focused = false;
  const tracker = createImportComparisonPageStateTracker(
    page.documentRef,
    page.windowRef,
  );
  const evidence = tracker.finish();
  assert.equal(evidence.start.hasFocus, false);
  assert.equal(evidence.valid, false);
});

test('comparison pair preserves its first completed arm when the second arm fails', async () => {
  const pairs = [];
  const expectedError = new Error('alternate arm failed');
  await assert.rejects(
    runAndRecordImportComparisonPair({
      pairs,
      trial: 2,
      order: ['alternate', 'synchronous'],
      synchronousMode: 'synchronous',
      alternateMode: 'alternate',
      runArm: async (mode) => {
        if (mode === 'synchronous') throw expectedError;
        return { mode, resultSha256: 'a'.repeat(64), elapsedMs: 12 };
      },
    }),
    (error) => error === expectedError,
  );
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], {
    trial: 2,
    order: ['alternate', 'synchronous'],
    status: 'failed',
    alternate: {
      mode: 'alternate',
      resultSha256: 'a'.repeat(64),
      elapsedMs: 12,
    },
  });
});

test('comparison pair records only complete equal pairs as passed', async () => {
  const pairs = [];
  const pair = await runAndRecordImportComparisonPair({
    pairs,
    trial: 1,
    order: ['synchronous', 'alternate'],
    synchronousMode: 'synchronous',
    alternateMode: 'alternate',
    runArm: async (mode) => ({ mode, resultSha256: 'b'.repeat(64) }),
  });
  assert.equal(pair.status, 'passed');
  assert.equal(pair.equal, true);
  assert.equal(pairs[0], pair);
});
