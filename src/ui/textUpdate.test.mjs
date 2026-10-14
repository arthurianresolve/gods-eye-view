import assert from 'node:assert/strict';
import test from 'node:test';
import { setTextIfChanged } from './textUpdate.js';

test('text updates skip unchanged values and normalize bounded status text', () => {
  const node = { textContent: 'READY' };
  assert.equal(setTextIfChanged(node, 'READY'), false);
  assert.equal(node.textContent, 'READY');
  assert.equal(setTextIfChanged(node, 42), true);
  assert.equal(node.textContent, '42');
  assert.equal(setTextIfChanged(node, null), true);
  assert.equal(node.textContent, '');
  assert.equal(setTextIfChanged(null, 'ignored'), false);
});
