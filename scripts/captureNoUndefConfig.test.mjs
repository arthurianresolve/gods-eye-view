import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import {
  CAPTURE_NO_UNDEF_CONFIG,
  CAPTURE_NO_UNDEF_FIXTURE_CONFIG,
} from './captureNoUndefConfig.mjs';

test('capture no-undef config accepts standard Node and browser globals', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    'window.location.href; document.visibilityState; process.cwd(); Buffer.from("ok");',
    [CAPTURE_NO_UNDEF_CONFIG],
    { filename: 'scripts/capture-scene-performance.mjs' },
  );

  assert.deepEqual(messages, []);
});

test('Vite commit metadata is allowed only in the declared browser fixtures', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = [CAPTURE_NO_UNDEF_CONFIG, CAPTURE_NO_UNDEF_FIXTURE_CONFIG];
  const fixtureMessages = linter.verify('String(__GEV_APP_COMMIT__);', config, {
    filename: 'scripts/fixtures/cctv-calibration-demand.js',
  });
  const captureMessages = linter.verify('String(__GEV_APP_COMMIT__);', config, {
    filename: 'scripts/qa-hosted-capture.mjs',
  });
  const inputFixtureMessages = linter.verify(
    'String(__GEV_APP_COMMIT__);',
    config,
    { filename: 'scripts/fixtures/import-input-comparison.mjs' },
  );

  assert.deepEqual(fixtureMessages, []);
  assert.deepEqual(
    linter.verify('String(__GEV_APP_COMMIT__);', config, {
      filename: 'scripts/fixtures/infrastructure-runtime-collections.mjs',
    }),
    [],
  );
  assert.deepEqual(inputFixtureMessages, []);
  assert.ok(captureMessages.some((message) => message.ruleId === 'no-undef'));
});

test('capture no-undef config rejects an undeclared project identifier', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    'const fixture = austinOpertingFixture;',
    [CAPTURE_NO_UNDEF_CONFIG, CAPTURE_NO_UNDEF_FIXTURE_CONFIG],
    { filename: 'scripts/capture-scene-performance.mjs' },
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'no-undef');
  assert.equal(messages[0].messageId, 'undef');
  assert.match(messages[0].message, /austinOpertingFixture/);
});

test('capture no-undef config does not allow inline suppression', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    '/* eslint-disable no-undef */ const fixture = austinOpertingFixture;',
    [CAPTURE_NO_UNDEF_CONFIG, CAPTURE_NO_UNDEF_FIXTURE_CONFIG],
    { filename: 'scripts/capture-scene-performance.mjs' },
  );

  const undefinedIdentifier = messages.find(
    (message) => message.ruleId === 'no-undef',
  );
  assert.ok(undefinedIdentifier);
  assert.equal(undefinedIdentifier.messageId, 'undef');
  assert.match(undefinedIdentifier.message, /austinOpertingFixture/);
  assert.ok(
    messages.some((message) => message.message.includes('noInlineConfig')),
  );
});
