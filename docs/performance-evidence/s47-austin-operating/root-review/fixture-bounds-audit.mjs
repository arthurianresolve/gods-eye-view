import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createAustinOperatingWorkloadFixture,
  createAustinOperatingFixtureDelivery,
} from '../../../../scripts/performance/austinOperatingWorkloadFixture.mjs';

const source = new URL(
  '../../../../scripts/performance/austinOperatingWorkloadFixture.mjs',
  import.meta.url,
);
const hash = () =>
  createHash('sha256').update(readFileSync(source)).digest('hex');
const beforeHash = hash();
const fixture = createAustinOperatingWorkloadFixture();
const baseUrl = 'https://fixture.example.test/';
const delivery = createAustinOperatingFixtureDelivery(fixture, baseUrl);
const checks = [];
const record = (id) => checks.push({ id, pass: true });
const responses = [];
for (let index = 0; index < 33; index++) {
  const url = new URL('api/military-installations', baseUrl);
  url.search = new URLSearchParams({
    south: String(30.25 + index / 100000),
    west: '-97.8',
    north: '30.4',
    east: '-97.5',
  });
  const response = await delivery.respond(url.href, { method: () => 'GET' });
  const acknowledgement = {
    url: url.href,
    method: 'GET',
    status: response.status,
    bodyBase64: response.body.toString('base64'),
  };
  responses.push(acknowledgement);
  if (index < 32) delivery.onFulfilled(acknowledgement);
}
const beforeOverflow = delivery.summarize({
  requiredAssetIds: ['installations'],
});
assert.equal(beforeOverflow.installations.responseVariants.length, 32);
assert.equal(beforeOverflow.installations.responseVariantOverflowCount, 0);
record('thirty-two-distinct-acknowledged-variants-retained');
delivery.onFulfilled(responses[0]);
const afterRepeat = delivery.summarize({ requiredAssetIds: ['installations'] });
assert.equal(afterRepeat.installations.responseVariants.length, 32);
assert.equal(
  afterRepeat.installations.responseVariants.reduce(
    (sum, variant) => sum + variant.responseCount,
    0,
  ),
  33,
);
record('repeat-response-increments-existing-variant-without-new-entry');
assert.throws(
  () => delivery.onFulfilled(responses[32]),
  /response-variant bound exceeded/,
);
assert.throws(
  () => delivery.summarize({ requiredAssetIds: ['installations'] }),
  /malformed or unexpected/,
);
record('thirty-third-variant-rejects-and-invalidates-success-summary');
for (let index = 0; index < 100; index++)
  assert.throws(
    () => delivery.onFulfilled(responses[32]),
    /response-variant bound exceeded/,
  );
assert.equal(delivery.errors.length, 16);
assert.ok(
  delivery.errors.every((item) => !('query' in item) && !('body' in item)),
);
record('repeated-overflow-errors-have-bounded-redacted-history');
const missing = createAustinOperatingFixtureDelivery(fixture, baseUrl);
assert.throws(
  () => missing.summarize({ requiredAssetIds: ['installations'] }),
  /not delivered/,
);
assert.throws(
  () => missing.summarize({ requiredAssetIds: ['unknown'] }),
  /unknown IDs/,
);
assert.throws(
  () =>
    missing.summarize({
      requiredAssetIds: [],
      requiredAlprTiles: [{ z: 10, x: 999, y: 999 }],
    }),
  /unknown route tile/,
);
record('missing-required-source-and-unknown-requirements-fail-closed');
const afterHash = hash();
assert.equal(afterHash, beforeHash);
const report = {
  schema: 'gev-independent-austin-fixture-bounds-audit/v1',
  checkedAt: new Date().toISOString(),
  scope:
    'Local Node contract checks only; not a memory-profile, browser, hardware, or complete capture result.',
  fixtureSha256: fixture.sha256,
  sourceHashBefore: beforeHash,
  sourceHashAfter: afterHash,
  checks,
  acknowledgedDistinctVariantsBeforeOverflow: 32,
  responsesAfterRepeat: 33,
  retainedErrorRowsAfter101Overflows: delivery.errors.length,
};
writeFileSync(
  new URL('fixture-bounds-audit.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    checks: checks.length,
    passed: checks.every((row) => row.pass),
    fixtureSha256: fixture.sha256,
    sourceUnchanged: true,
  }),
);
