import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveLookup } from './archiveLookup.js';
import { createEvidenceSnapshot } from './comparison.js';
import {
  createWorkspaceDocument,
  parseWorkspaceDocument,
} from '../workspaces/document.js';
import { mapAnalystRecord } from '../sources/infrastructureData.js';
import {
  cameraHealthRank,
  isCameraEligibleForAutoSelection,
} from '../layers/cctv/healthPolicy.js';

test('datacenter evidence can attach an archive and survive workspace export/reopen', async () => {
  const datacenter = mapAnalystRecord(
    {
      id: 'dc-1',
      lat: 52.5,
      lon: 13.4,
      properties: { tags: { name: 'Example DC' } },
    },
    'local-datacenters',
  );
  const lookup = createArchiveLookup({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          state: 'available',
          reference: {
            kind: 'archive',
            url: 'https://web.archive.org/web/20260101000000/https://example.test',
            originalUrl: 'https://example.test',
            archiveAt: 1_767_225_600_000,
            lookedUpAt: 1_767_225_601_000,
            title: 'Internet Archive capture',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  });
  const archive = await lookup.lookup({ url: 'https://example.test' });
  const record = {
    ...datacenter,
    entityRef: datacenter.evidence.entityRef,
    evidence: {
      ...datacenter.evidence,
      references: [...datacenter.evidence.references, archive.reference],
    },
  };
  const snapshot = createEvidenceSnapshot({
    id: 'datacenter-archive',
    capturedAt: 2_000,
    records: [record],
  });
  const workspace = createWorkspaceDocument({
    id: 'archive-journey',
    title: 'Archive journey',
    createdAt: 1_000,
    updatedAt: 2_000,
    view: { camera: { lat: 52.5, lon: 13.4, altitude_m: 100_000 }, layers: [] },
    filters: {},
    pinnedEvidence: [
      {
        id: snapshot.id,
        sourceId: 'local-datacenters',
        capturedAt: 2_000,
        snapshot,
      },
    ],
    annotations: [],
    assetRefs: [],
  });
  const reopened = parseWorkspaceDocument(JSON.stringify(workspace));
  assert.equal(
    reopened.pinnedEvidence[0].snapshot.records[0].record.evidence.references[1]
      .kind,
    'archive',
  );
});

test('camera recovery journey excludes a fresh failed feed and keeps a healthy alternative eligible', () => {
  const now = Date.now();
  const failed = {
    status: 'degraded',
    reasonCode: 'upstream-timeout',
    updatedAt: now,
  };
  const recovered = {
    status: 'ok',
    reasonCode: 'delivery-ok',
    updatedAt: now,
  };
  assert.equal(isCameraEligibleForAutoSelection(failed, now), false);
  assert.equal(isCameraEligibleForAutoSelection(recovered, now), true);
  assert.equal(cameraHealthRank(recovered, now), 0);
});
