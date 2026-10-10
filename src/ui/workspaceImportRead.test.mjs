import assert from 'node:assert/strict';
import test from 'node:test';

import { previewCSV, previewGeoJSON } from '../imports/index.js';
import {
  createWorkspaceImportReadOwner,
  readOwnedWorkspaceFile,
} from './workspaceImportRead.js';

function deferredFile(name) {
  let resolve;
  let reject;
  const text = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    file: { name, size: 10, text: () => text },
    resolve,
    reject,
  };
}

function file(name, contents) {
  return {
    name,
    size: contents.length,
    async text() {
      return contents;
    },
  };
}

test('a newer file owns the read even when the older read resolves last', async () => {
  const owner = createWorkspaceImportReadOwner();
  const first = deferredFile('first.geojson');
  const second = deferredFile('second.geojson');
  const context = { workspaceId: 'workspace-a', workspaceGeneration: 4 };
  const firstOwner = owner.begin(first.file, context);
  const firstRead = readOwnedWorkspaceFile(first.file, () =>
    owner.isCurrent(firstOwner, context),
  );
  const secondOwner = owner.begin(second.file, context);
  const secondRead = readOwnedWorkspaceFile(second.file, () =>
    owner.isCurrent(secondOwner, context),
  );

  second.resolve('new file');
  assert.deepEqual(await secondRead, { status: 'ready', text: 'new file' });
  first.resolve('old file');
  assert.deepEqual(await firstRead, { status: 'superseded' });
});

test('late read rejection after supersession is suppressed; current errors remain visible', async () => {
  const owner = createWorkspaceImportReadOwner();
  const old = deferredFile('old.geojson');
  const current = deferredFile('current.geojson');
  const oldOwner = owner.begin(old.file);
  const oldRead = readOwnedWorkspaceFile(old.file, () =>
    owner.isCurrent(oldOwner),
  );
  const currentOwner = owner.begin(current.file);
  const currentRead = readOwnedWorkspaceFile(current.file, () =>
    owner.isCurrent(currentOwner),
  );

  old.reject(new Error('old file read failed'));
  assert.deepEqual(await oldRead, { status: 'superseded' });
  current.reject(new Error('current file read failed'));
  const failed = await currentRead;
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /current file/);
});

test('workspace-bound reads stale on replacement while destination-free preview survives selection', () => {
  const owner = createWorkspaceImportReadOwner();
  const pickedFile = file('inside.geojson', '{}');
  const workspaceOwner = owner.begin(pickedFile, {
    workspaceId: 'workspace-a',
    workspaceGeneration: 3,
  });
  assert.equal(
    owner.isCurrent(workspaceOwner, {
      workspaceId: 'workspace-a',
      workspaceGeneration: 3,
    }),
    true,
  );
  assert.equal(
    owner.isCurrent(workspaceOwner, {
      workspaceId: 'workspace-b',
      workspaceGeneration: 4,
    }),
    false,
  );

  const destinationFreeOwner = owner.begin(pickedFile);
  assert.equal(
    owner.isCurrent(destinationFreeOwner, {
      workspaceId: 'workspace-b',
      workspaceGeneration: 4,
    }),
    true,
  );
});

test('cancel and disposal suppress late read completion', async () => {
  const owner = createWorkspaceImportReadOwner();
  const cancelled = deferredFile('cancelled.geojson');
  const cancelledOwner = owner.begin(cancelled.file);
  const cancelledRead = readOwnedWorkspaceFile(cancelled.file, () =>
    owner.isCurrent(cancelledOwner),
  );
  owner.invalidate();
  cancelled.resolve('late data');
  assert.deepEqual(await cancelledRead, { status: 'superseded' });

  const disposed = file('disposed.geojson', 'late data');
  const disposedOwner = owner.begin(disposed);
  assert.deepEqual(
    await readOwnedWorkspaceFile(disposed, () =>
      owner.isCurrent(disposedOwner, { disposed: true }),
    ),
    { status: 'superseded' },
  );
});

test('owned current GeoJSON and CSV text reaches the production preview parsers', async () => {
  const owner = createWorkspaceImportReadOwner();
  const geojson = file(
    'points.geojson',
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'POINT A' },
          geometry: { type: 'Point', coordinates: [2, 48] },
        },
      ],
    }),
  );
  const geojsonOwner = owner.begin(geojson);
  const geojsonRead = await readOwnedWorkspaceFile(geojson, () =>
    owner.isCurrent(geojsonOwner),
  );
  const geojsonPreview = await previewGeoJSON(geojsonRead.text);
  assert.equal(geojsonPreview.accepted, 1);
  assert.equal(geojsonPreview.records[0].properties.name, 'POINT A');

  const csv = file('points.csv', 'lat,lon,name\n48,2,POINT B\n');
  const csvOwner = owner.begin(csv);
  const csvRead = await readOwnedWorkspaceFile(csv, () =>
    owner.isCurrent(csvOwner),
  );
  const csvPreview = await previewCSV(csvRead.text, {
    mapping: { latitude: 'lat', longitude: 'lon' },
  });
  assert.equal(csvPreview.accepted, 1);
  assert.equal(csvPreview.records[0].properties.name, 'POINT B');
});
