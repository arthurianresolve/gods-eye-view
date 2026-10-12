import assert from 'node:assert/strict';
import test from 'node:test';
import { Linter } from 'eslint';
import { CAPTURE_NO_UNDEF_CONFIG } from './captureNoUndefConfig.mjs';

test('capture no-undef config accepts standard Node and browser globals', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    'window.location.href; document.visibilityState; process.cwd(); Buffer.from("ok");',
    [CAPTURE_NO_UNDEF_CONFIG],
    { filename: 'scripts/capture-scene-performance.mjs' },
  );

  assert.deepEqual(messages, []);
});

test('capture no-undef config rejects an undeclared project identifier', () => {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    'const fixture = austinOpertingFixture;',
    [CAPTURE_NO_UNDEF_CONFIG],
    { filename: 'scripts/capture-scene-performance.mjs' },
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'no-undef');
  assert.equal(messages[0].messageId, 'undef');
  assert.match(messages[0].message, /austinOpertingFixture/);
});
