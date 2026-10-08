import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installWebGlRecovery } from './webglRecovery.js';

function harness(getRecoveryUrl = () => 'https://example.test/#v=2&lat=12') {
  const canvas = new EventTarget();
  const reloadButton = new EventTarget();
  const status = { hidden: true, dataset: {} };
  const message = { textContent: '' };
  const elements = new Map([
    ['webgl-recovery-status', status],
    ['webgl-recovery-message', message],
    ['webgl-recovery-reload', reloadButton],
  ]);
  const documentTarget = { getElementById: (id) => elements.get(id) };
  const navigations = [];
  const locationTarget = {
    href: 'https://example.test/',
    assign: (url) => navigations.push(url),
    reload: () => navigations.push('reload'),
  };
  const dispose = installWebGlRecovery(
    { scene: { canvas } },
    { documentTarget, locationTarget, getRecoveryUrl },
  );
  return { canvas, reloadButton, status, message, navigations, dispose };
}

test('lost WebGL context exposes an accessible reload that preserves the live view', () => {
  const h = harness();
  const event = new Event('webglcontextlost', { cancelable: true });
  h.canvas.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(h.status.hidden, false);
  assert.equal(h.status.dataset.state, 'lost');
  assert.match(h.message.textContent, /Reload to restore this view/);

  h.reloadButton.dispatchEvent(new Event('click'));
  assert.deepEqual(h.navigations, ['https://example.test/#v=2&lat=12']);

  h.dispose();
  assert.equal(h.status.hidden, true);
  assert.equal(h.status.dataset.state, undefined);
  h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(h.status.hidden, true);
});

test('recovery falls back to a normal reload if view serialization fails', () => {
  const h = harness(() => null);
  h.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  h.reloadButton.dispatchEvent(new Event('click'));
  assert.deepEqual(h.navigations, ['reload']);
  h.dispose();
});
