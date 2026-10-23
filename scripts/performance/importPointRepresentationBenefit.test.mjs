import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { makeRun } from './importPointRepresentationTestFixture.mjs';
import {
  buildImportPointRepresentationBenefitReport,
  validateImportPointRepresentationBenefitReport,
} from './importPointRepresentationBenefit.mjs';

function runHash(run) {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

function rendererRun(renderer, ordinal) {
  const run = makeRun(renderer);
  run.commit = 'a'.repeat(40);
  run.captureMatrix.applicationCommit = run.commit;
  run.captureMatrix.harnessCommit = run.commit;
  const fixture = run.importBatches;
  fixture.pointBenefitDiagnosticsRequested = true;
  fixture.performanceAcceptanceEligible = false;
  fixture.coldActivationMs = 100 + ordinal;
  for (let index = 0; index < fixture.samples.length; index++) {
    const sample = fixture.samples[index];
    sample.elapsedMs = 20 + ordinal + (sample.mode === 'cooperative' ? 4 : 0);
    sample.clearCallElapsedMs = 0.2 + ordinal / 100;
    sample.resetDrainElapsedMs = 160;
    sample.clearAndDrainElapsedMs = 160.2 + ordinal / 100;
    sample.captureElapsedMs = 15 + ordinal;
    sample.maxHeartbeatGapMs = 8 + ordinal;
    sample.resources = {
      importedFeatureCount: 5000,
      pointPrimitiveCount: 5000,
    };
    sample.resourcesAfterClear = {
      importedFeatureCount: 0,
      pointPrimitiveCount: renderer === 'entity' ? 5000 : 0,
      ...(renderer === 'entity'
        ? {
            entityPointCensus: {
              available: true,
              activeEntityCount: 0,
              pointCount: 5000,
            },
          }
        : {}),
    };
    sample.cooperativeBatchMetrics =
      sample.mode === 'cooperative'
        ? {
            available: false,
            reason:
              'The production cooperative loader exposes no batch-completion observer; no batch duration or wake values are inferred.',
          }
        : null;
  }
  return run;
}

function validReport() {
  const pairs = [];
  for (let pair = 0; pair < 5; pair++) {
    const entityRun = rendererRun('entity', pair);
    const collectionRun = rendererRun('primitive-collection', pair + 1);
    pairs.push({
      pair,
      executionOrder:
        pair % 2 === 0
          ? ['entity', 'primitive-collection']
          : ['primitive-collection', 'entity'],
      entityRun,
      collectionRun,
      entityReportSha256: runHash(entityRun),
      collectionReportSha256: runHash(collectionRun),
    });
  }
  return buildImportPointRepresentationBenefitReport({
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    packageLockSha256: 'b'.repeat(64),
    nodeVersion: 'v24.14.0',
    pairs,
    createdAt: '2026-10-11T00:00:00.000Z',
  });
}

test('summarizes five alternating fresh-page pairs without treating inner samples as outer runs', () => {
  const report = validReport();
  assert.equal(report.status, 'passed');
  assert.equal(
    report.validation.valid,
    true,
    report.validation.errors.join('; '),
  );
  assert.equal(report.summary.outerPairsCompared, 5);
  assert.equal(report.summary.pairMetrics.length, 5);
  assert.equal(report.summary.synchronousLoadDeltaMedianPercent > 0, true);
  assert.equal(report.summary.cooperativeLoadDeltaMedianPercent > 0, true);
  assert.equal(
    report.summary.pairMetrics[0].entity.cooperative.cooperativeBatch.available,
    false,
  );
  assert.equal(
    report.summary.pairMetrics[0].entity.synchronous.clearCallMs > 0,
    true,
  );
  assert.equal(
    report.summary.pairMetrics[0].entity.synchronous.resetDrainMs,
    160,
  );
  assert.equal(report.summary.performanceAcceptanceEligible, false);
  assert.equal(report.summary.physicalDesktopAcceptance, false);
});

test('rejects wrong order, stale raw hashes, changed parity, and incomplete resource samples', () => {
  const report = validReport();
  report.pairs[1].executionOrder = ['entity', 'primitive-collection'];
  report.pairs[2].entityRun.importBatches.samples[0].pixelSha256 = 'c'.repeat(
    64,
  );
  report.pairs[3].collectionRun.importBatches.samples[0].elapsedMs = -1;
  report.pairs[3].collectionReportSha256 = runHash(
    report.pairs[3].collectionRun,
  );
  report.pairs[4].entityRun.importBatches.samples[0].resourcesAfterClear.importedFeatureCount = 1;
  report.pairs[4].entityReportSha256 = runHash(report.pairs[4].entityRun);
  report.pairs[2].collectionRun.importBatches.samples[0].resourcesAfterClear.pointPrimitiveCount = 1;
  report.pairs[2].collectionReportSha256 = runHash(
    report.pairs[2].collectionRun,
  );
  report.pairs[3].collectionRun.importBatches.samples[1].cooperativeBatchMetrics =
    {
      available: false,
      reason: 'fabricated',
    };
  report.pairs[3].collectionReportSha256 = runHash(
    report.pairs[3].collectionRun,
  );

  const checked = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: 'a'.repeat(40),
  });
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((error) => error.includes('alternating order')),
  );
  assert.ok(
    checked.errors.some((error) => error.includes('hash is missing or stale')),
  );
  assert.ok(
    checked.errors.some((error) => error.includes('pixel output differs')),
  );
  assert.ok(
    checked.errors.some((error) =>
      error.includes('incomplete load/clear/capture timing'),
    ),
  );
  assert.ok(checked.errors.some((error) => error.includes('clear')));
  assert.ok(
    checked.errors.some((error) =>
      error.includes('live-resource observations'),
    ),
  );
});

test('batch attribution is explicitly unavailable instead of inferred from scheduler hooks', () => {
  const report = validReport();
  assert.equal(report.validation.valid, true);
  assert.equal(
    report.summary.pairMetrics[0].entity.cooperative.cooperativeBatch.available,
    false,
  );

  const sample = report.pairs[0].entityRun.importBatches.samples.find(
    (entry) => entry.mode === 'cooperative',
  );
  sample.cooperativeBatchMetrics = {
    available: true,
    totalBatches: 50,
    maxActiveBatchMs: 3.9,
  };
  report.pairs[0].entityReportSha256 = runHash(report.pairs[0].entityRun);

  const checked = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: 'a'.repeat(40),
  });
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((error) =>
      error.includes('incomplete load/clear/capture timing'),
    ),
  );
});

test('rejects incomplete outer-pair counts and mismatched immutable provenance', () => {
  const report = validReport();
  report.pairs.pop();
  report.provenance.harnessCommit = 'c'.repeat(40);
  const checked = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: 'a'.repeat(40),
  });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => error.includes('five outer pairs')));
  assert.ok(
    checked.errors.some((error) =>
      error.includes('requested immutable commit'),
    ),
  );
});

test('rejects internally consistent nested runs from another commit when hashes are recomputed', () => {
  const report = validReport();
  for (const run of [
    report.pairs[0].entityRun,
    report.pairs[0].collectionRun,
  ]) {
    run.commit = 'c'.repeat(40);
    run.captureMatrix.applicationCommit = run.commit;
    run.captureMatrix.harnessCommit = run.commit;
    run.importBatches.applicationCommit = run.commit;
    run.importBatches.harnessCommit = run.commit;
    run.importBatches.environment.appCommit = run.commit;
    run.importBatches.environment.harnessCommit = run.commit;
  }
  report.pairs[0].entityReportSha256 = runHash(report.pairs[0].entityRun);
  report.pairs[0].collectionReportSha256 = runHash(
    report.pairs[0].collectionRun,
  );
  const checked = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: 'a'.repeat(40),
  });
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((error) => error.includes('nested source identities')),
  );
});

test('rejects a missing nested run without throwing during validation', () => {
  const report = validReport();
  report.pairs[0].entityRun = null;
  report.pairs[0].entityReportSha256 = null;
  const checked = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: 'a'.repeat(40),
  });
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((error) => error.includes('Entity report hash')),
  );
  assert.ok(checked.errors.some((error) => error.includes('parity failed')));
});
