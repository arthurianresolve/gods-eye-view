import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceEnvelope,
  normalizeEvidence,
  safePeeringDbFacilityUrl,
  safeReferenceUrl,
  safeEvidenceUrl,
} from './evidence.js';

test('evidence keeps source time unknown instead of using receipt time', () => {
  const evidence = createEvidenceEnvelope({
    entityRef: { layerKey: 'flights', id: 'abc123' },
    receivedAt: 1_700_000_000_000,
    now: 1_700_000_001_000,
  });
  assert.equal(evidence.observedAt, null);
  assert.equal(evidence.receivedAt, 1_700_000_000_000);
  assert.equal(evidence.observationId, 'flights:abc123:time-unknown');
});

test('invalid and future observed/receipt times are rejected; forecast times remain valid', () => {
  const evidence = createEvidenceEnvelope({
    observedAt: 'not-a-time',
    receivedAt: 1_700_000_002_000,
    issuedAt: 1_700_000_002_000,
    validFrom: 1_700_000_003_000,
    now: 1_700_000_001_000,
  });
  assert.equal(evidence.observedAt, null);
  assert.equal(evidence.receivedAt, null);
  assert.equal(evidence.issuedAt, 1_700_000_002_000);
  assert.equal(evidence.validFrom, 1_700_000_003_000);
  assert.match(evidence.limitations.join(' '), /future/);
});

test('orbital element epoch stays separate from direct observation time', () => {
  const elementEpoch = Date.parse('2008-09-20T12:25:40.104Z');
  const displayTime = Date.parse('2026-10-08T00:00:00Z');
  const evidence = createEvidenceEnvelope({
    elementEpoch,
    displayTime,
    method: 'predicted',
    now: displayTime,
  });
  assert.equal(evidence.elementEpoch, elementEpoch);
  assert.equal(evidence.displayTime, displayTime);
  assert.equal(evidence.observedAt, null);
  assert.equal(evidence.method, 'predicted');
});

test('safe source links require HTTPS and strip credentials, query and fragment', () => {
  assert.equal(
    safeEvidenceUrl(
      'https://user:pass@example.test/path?token=secret#fragment',
    ),
    null,
  );
  assert.equal(
    safeEvidenceUrl('https://example.test/path?token=secret#fragment'),
    'https://example.test/path',
  );
  assert.equal(safeEvidenceUrl('http://example.test/path'), null);
  const evidence = normalizeEvidence({ sourceUrl: 'javascript:alert(1)' });
  assert.equal(evidence.sourceUrl, null);
});

test('references preserve public query URLs but reject private or credentialed targets', () => {
  assert.equal(
    safeReferenceUrl('https://www.peeringdb.com/search?q=Munich#results'),
    'https://www.peeringdb.com/search?q=Munich',
  );
  const evidence = createEvidenceEnvelope({
    references: [
      {
        kind: 'peeringdb',
        url: 'https://www.peeringdb.com/search?q=Munich#results',
        title: 'Search PeeringDB',
      },
      { kind: 'archive', url: 'http://127.0.0.1:4173/private' },
      { kind: 'archive', url: 'https://user:pass@example.test/capture' },
    ],
  });
  assert.deepEqual(evidence.references, [
    {
      kind: 'peeringdb',
      url: 'https://www.peeringdb.com/search?q=Munich',
      title: 'Search PeeringDB',
      originalUrl: null,
      archiveAt: null,
      lookedUpAt: null,
    },
  ]);
});

test('references are bounded and normalized as immutable data', () => {
  const evidence = createEvidenceEnvelope({
    references: Array.from({ length: 12 }, (_, index) => ({
      kind: 'user-linked',
      url: `https://example.test/reference/${index}`,
    })),
  });
  assert.equal(evidence.references.length, 8);
  assert.equal(Object.isFrozen(evidence.references), true);
  assert.equal(Object.isFrozen(evidence.references[0]), true);
});

test('PeeringDB facility references require a public /fac/ path', () => {
  assert.equal(
    safePeeringDbFacilityUrl('https://www.peeringdb.com/fac/123?x=1#details'),
    'https://www.peeringdb.com/fac/123?x=1',
  );
  assert.equal(
    safePeeringDbFacilityUrl('https://www.peeringdb.com/search?q=x'),
    null,
  );
  assert.equal(safePeeringDbFacilityUrl('https://evil.example/fac/123'), null);
});

test('envelopes are immutable, bounded, and do not invent confidence values', () => {
  const evidence = createEvidenceEnvelope({
    entityRef: { layerKey: 'flights', id: 'abc123' },
    uncertainty: { value: -1, unit: 'm' },
    limitations: Array(12).fill('gap'),
    derivationRefs: Array(12).fill('fix'),
  });
  assert.equal(evidence.uncertainty.value, null);
  assert.equal(evidence.uncertainty.unit, 'm');
  assert.equal(evidence.limitations.length, 8);
  assert.equal(evidence.derivationRefs.length, 8);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.entityRef), true);
});
