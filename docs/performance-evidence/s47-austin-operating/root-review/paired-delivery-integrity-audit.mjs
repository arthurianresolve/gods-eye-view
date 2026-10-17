import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const sourcePaths = [
  'scripts/performance/austinOperatingComparisonContract.test.mjs',
  'scripts/performance/captureComparisonContract.mjs',
  'scripts/performance/pairedReport.mjs',
  'scripts/performance/austinOperatingWorkloadFixture.mjs',
  'scripts/performance/pairedReportTestFixtures.mjs',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () =>
  Object.fromEntries(
    sourcePaths.map((relative) => [
      relative,
      hash(fs.readFileSync(path.join(root, relative))),
    ]),
  );
const beforeHashes = sourceHashes();
const helperPath = path.join(root, sourcePaths[0]);
// Reuse the actual fixture-delivery producer, with synthetic browser observations.
// Suppress test registration: this audit is not another execution of that suite.
let helperSource = fs
  .readFileSync(helperPath, 'utf8')
  .replace(/import test from 'node:test';/, 'const test = () => {};')
  .replace(
    /from '(\.\.?\/[^']+)'/g,
    (_, specifier) =>
      `from '${pathToFileURL(path.resolve(path.dirname(helperPath), specifier)).href}'`,
  );
helperSource +=
  '\nexport { makeObservedPairInput, asPairedReport, baselineCommit, candidateCommit };\n';
const helper = await import(
  `data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`
);
const { validatePairedPerformanceReports } = await import(
  pathToFileURL(path.join(root, 'scripts/performance/pairedReport.mjs')).href
);
const baseline = helper.asPairedReport(
  await helper.makeObservedPairInput(),
  helper.baselineCommit,
);
const candidate = helper.asPairedReport(
  await helper.makeObservedPairInput(),
  helper.candidateCommit,
  -3,
);
const validate = (changed) =>
  validatePairedPerformanceReports({
    baseline,
    candidate: changed,
    expectedAppCommits: {
      baseline: helper.baselineCommit,
      candidate: helper.candidateCommit,
    },
  });
const control = validate(candidate);
const mutations = [
  [
    'corrupt-delivered-asset-hash',
    (changed) => {
      for (const document of changed.fixtureDelivery.sampleDocuments)
        document.delivery.deliveredAssets[0].sha256 = 'f'.repeat(64);
    },
  ],
  [
    'remove-acknowledged-alpr-tiles',
    (changed) => {
      for (const document of changed.fixtureDelivery.sampleDocuments)
        document.delivery.alprTileCoverage.requested = [];
    },
  ],
  [
    'remove-acknowledged-installation-identities',
    (changed) => {
      for (const document of changed.fixtureDelivery.sampleDocuments)
        for (const variant of document.delivery.installations
          .responseVariants) {
          variant.elementIds = [];
          variant.elementCount = 0;
        }
    },
  ],
];
const controls = mutations.map(([id, mutate]) => {
  const changed = structuredClone(candidate);
  mutate(changed);
  // Alter every raw copy so rejection must validate the fixture contract,
  // rather than merely finding that two copies disagree.
  for (let index = 0; index < changed.captures.length; index++) {
    const delivery = changed.fixtureDelivery.sampleDocuments[index].delivery;
    changed.captures[index].fixtureDelivery = structuredClone(delivery);
    if (changed.captures[index].austinOperatingClock.fixtureDelivery)
      changed.captures[index].austinOperatingClock.fixtureDelivery =
        structuredClone(delivery);
  }
  try {
    return {
      id,
      expected: 'reject',
      rejected: false,
      actual: validate(changed).status,
    };
  } catch (error) {
    return {
      id,
      expected: 'reject',
      rejected: true,
      actual: 'rejected',
      reason: String(error.message).split('\n')[0].slice(0, 300),
      reasonSha256: hash(String(error.message)),
    };
  }
});
const afterHashes = sourceHashes();
const sourceStable =
  JSON.stringify(beforeHashes) === JSON.stringify(afterHashes);
const result = {
  schema: 'gev-root-austin-paired-integrity-audit/v1',
  recordedAt: new Date().toISOString(),
  scope:
    'Node report-validator audit using real fixture delivery and synthetic browser/build observations; no browser, hardware, or performance acceptance',
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceState:
    'working-tree integration under development; exact file hashes recorded',
  sourceSha256: beforeHashes,
  sourceStable,
  mutationScope:
    'top-level delivery and every matching captured delivery copy; copied identities remain mutually consistent',
  positiveControl: {
    status: control.status,
    workloadObjective: control.workloadObjective,
  },
  controls,
  status:
    sourceStable && controls.every((row) => row.rejected) ? 'passed' : 'failed',
};
const outputName = process.argv[2];
if (!outputName || !/^[a-z0-9-]+\.json$/.test(outputName))
  throw new Error('Specify a new adjacent JSON evidence filename.');
const output = path.join(directory, outputName);
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    status: result.status,
    sourceStable,
    controls,
    artifact: output,
  }),
);
if (result.status !== 'passed') process.exitCode = 1;
