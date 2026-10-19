import assert from 'node:assert/strict';
import test from 'node:test';
import { importFixtureGeometry } from './qa-application-fixtures.mjs';

test('import fixture releases the selector ElementHandle it does not retain', async () => {
  const events = [];
  const page = {
    async waitForSelector(selector, options) {
      events.push('selector-wait');
      assert.equal(selector, '.workspace-library [data-geo-file]');
      assert.equal(options.visible, true);
      return {
        async dispose() {
          events.push('handle-dispose');
        },
      };
    },
    async evaluate() {
      events.push('import-stage');
    },
    async waitForFunction() {},
  };

  await importFixtureGeometry(page, 'Persistent fixture', {
    onProgress(phase) {
      if (phase === 'import-control-wait:complete')
        events.push('selector-phase-complete');
    },
  });

  assert.deepEqual(events.slice(0, 4), [
    'selector-wait',
    'handle-dispose',
    'selector-phase-complete',
    'import-stage',
  ]);
});
