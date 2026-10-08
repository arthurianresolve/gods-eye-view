import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceEnvelope,
  normalizeEvidence,
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
