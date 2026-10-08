import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareEvidenceSnapshots,
  createEvidenceSnapshot,
  exportEvidenceComparison,
} from './comparison.js';

const record = (id, value = 1) => ({
  layerKey: 'flights',
  id,
  callsign: 'N123',
  value,
});

test('comparison distinguishes added, changed and not-observed records under partial coverage', () => {
  const a = createEvidenceSnapshot({
    id: 'a',
    capturedAt: 1_000,
    scope: { region: 'north' },
    records: [record('one'), record('two')],
  });
  const b = createEvidenceSnapshot({
    id: 'b',
    capturedAt: 2_000,
    scope: { region: 'north' },
    records: [record('one', 2), record('three')],
  });
  const result = compareEvidenceSnapshots(a, b);
  assert.deepEqual(
    result.rows.map(({ key, status }) => [key, status]),
    [
      ['flights:three', 'added'],
      ['flights:one', 'changed'],
      ['flights:two', 'not-observed'],
    ],
  );
  assert.match(
    result.rows[2].explanation,
    /does not establish complete coverage/,
  );
});

test('absence is a disappearance only with complete coverage and matching scope', () => {
  const a = createEvidenceSnapshot({
    id: 'a',
    capturedAt: 1_000,
    scope: { box: [1, 2] },
    records: [record('one')],
  });
  const complete = createEvidenceSnapshot({
    id: 'b',
    capturedAt: 2_000,
    scope: { box: [1, 2] },
    coverage: { layers: { flights: { completeness: 'complete' } } },
    records: [],
  });
  assert.equal(
    compareEvidenceSnapshots(a, complete).rows[0].status,
    'no-longer-observed',
  );
  const otherScope = createEvidenceSnapshot({
    ...complete,
    scope: { box: [3, 4] },
  });
  assert.equal(
    compareEvidenceSnapshots(a, otherScope).rows[0].status,
    'not-observed',
  );
});

test('reports include UTC context, safe source links and spreadsheet-safe CSV cells', () => {
  const a = createEvidenceSnapshot({
    id: 'a',
    capturedAt: 1_000,
    sourceLinks: ['https://example.com/path?token=secret'],
    records: [{ layerKey: '=cmd', id: 'one', value: '=HYPERLINK("bad")' }],
  });
  const b = createEvidenceSnapshot({
    id: 'b',
    capturedAt: 2_000,
    records: [{ layerKey: '=cmd', id: 'one', value: 'safe' }],
  });
  const result = compareEvidenceSnapshots(a, b);
  const csv = exportEvidenceComparison(result, { format: 'csv' });
  const markdown = exportEvidenceComparison(result, { format: 'markdown' });
  assert.match(csv, /'=cmd:one/);
  assert.doesNotMatch(csv, /token=secret/);
  assert.match(markdown, /1970-01-01T00:00:01.000Z/);
  assert.match(markdown, /https:\/\/example.com\/path/);
  assert.throws(
    () => exportEvidenceComparison(result, { format: 'xml' }),
    /Unsupported/,
  );
});

test('comparison snapshots retain reference metadata in exported records', () => {
  const snapshot = createEvidenceSnapshot({
    id: 'archive',
    capturedAt: 2_000,
    records: [
      {
        layerKey: 'local-datacenters',
        id: 'dc-1',
        evidence: {
          references: [
            {
              kind: 'archive',
              url: 'https://web.archive.org/web/20260101000000/https://example.test',
              originalUrl: 'https://example.test',
              title: 'Internet Archive capture',
            },
          ],
        },
      },
    ],
  });
  const exported = JSON.stringify(snapshot);
  assert.match(exported, /Internet Archive capture/);
  assert.match(exported, /web\.archive\.org/);
});

test('comparison snapshots reject unsafe evidence references', () => {
  assert.throws(
    () =>
      createEvidenceSnapshot({
        capturedAt: 1_700_000_000_000,
        records: [
          {
            entityRef: { layerKey: 'cctv', id: 'cam-1' },
            evidence: {
              references: [{ kind: 'archive', url: 'http://127.0.0.1/' }],
            },
          },
        ],
      }),
    /Evidence references are invalid/,
  );
});
