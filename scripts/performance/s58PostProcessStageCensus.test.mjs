import assert from 'node:assert/strict';
import test from 'node:test';
import { STYLES } from '../../src/ui/visualPresets.js';
import {
  captureS58PostProcessStageCensus,
  validateS58PostProcessStageCensus,
} from './s58PostProcessStageCensus.mjs';

test('VisualSettings selection drives real Cesium stages through crossfade and disposal', () => {
  const report = captureS58PostProcessStageCensus();

  assert.deepEqual(validateS58PostProcessStageCensus(report), {
    valid: true,
    timelineEntries: 5,
  });
  assert.equal(report.fixture.transitionDurationMs, 500);
  assert.equal(report.fixture.sha256.length, 64);
  assert.equal(report.identity.cesiumVersion, '1.138.0');
  assert.equal(Object.keys(report.identity.source.files).length, 5);
  assert.deepEqual(
    report.timeline.map((entry) => entry.enabledStyles),
    [[], ['noir'], ['noir'], ['noir', 'thermal'], ['thermal']],
  );
  for (const entry of report.timeline) {
    assert.equal(entry.styleStageCount, Object.keys(STYLES).length);
    assert.ok(
      entry.styleStages.every(
        (stage) => stage.nativeStage && stage.inCollection,
      ),
    );
  }
  assert.equal(report.timeline[3].transitionCount, 2);
  assert.equal(
    report.timeline[4].styleStages.find((stage) => stage.name === 'thermal')
      .animated,
    true,
  );
  assert.deepEqual(report.ownership.beforeDestroy.renderHolds, ['style-anim']);
  assert.deepEqual(report.ownership.afterDestroy, {
    collectionLength: 0,
    pendingAnimationFrames: 0,
    renderHolds: [],
    bloomRestored: true,
  });
  assert.equal(report.renderedFrames, null);
  assert.equal(report.gpuPassCount, null);
  assert.equal(report.shaderCompilation, null);
});

test('a second enabled style fails the selected-stage contribution contract', () => {
  const report = captureS58PostProcessStageCensus({
    injectDuplicateEnabledStyle: true,
  });
  const final = report.timeline.at(-1);

  assert.deepEqual(final.expectedEnabledStyles, ['thermal']);
  assert.deepEqual(final.enabledStyles, ['retro', 'thermal']);
  assert.throws(
    () => validateS58PostProcessStageCensus(report),
    /Unexpected enabled style contribution at settled-thermal-with-effects/,
  );
  assert.deepEqual(report.ownership.afterDestroy.renderHolds, []);
});

test('stage census validation rejects altered fixture identity and missing ownership', () => {
  const digestMismatch = captureS58PostProcessStageCensus();
  digestMismatch.fixture.transitionDurationMs += 1;
  assert.throws(
    () => validateS58PostProcessStageCensus(digestMismatch),
    /fixture settings mismatch/,
  );

  const retainedStage = captureS58PostProcessStageCensus();
  retainedStage.ownership.afterDestroy.collectionLength = 1;
  assert.throws(
    () => validateS58PostProcessStageCensus(retainedStage),
    /did not retire or restore cleanly/,
  );

  const wrongSource = captureS58PostProcessStageCensus();
  wrongSource.identity.source.files['src/ui/visualEffects.js'] = '0'.repeat(64);
  assert.throws(
    () => validateS58PostProcessStageCensus(wrongSource),
    /source hashes do not match this checkout/,
  );
});
