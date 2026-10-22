import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  readVisualPaintSignatureInPage,
  createVisualPaintSnapshotReader,
  assertVisualPaintSignature,
} from './visualPaintSignature.mjs';

function harness({
  broadcasting = false,
  animations = [],
  fonts = 'loaded',
} = {}) {
  const calls = [];
  const element = (tag, id = '') => ({
    tagName: tag,
    id,
    children: [],
    textContent: '',
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 52, height: 35 }),
  });
  const svg = { ...element('svg'), outerHTML: '<svg><path d="M0 0"/></svg>' };
  const logo = { ...element('SPAN'), querySelector: () => svg };
  const title = {
    ...element('DIV', 'title-bar'),
    querySelector: () => logo,
    querySelectorAll: () => [logo, svg],
    classList: { contains: () => broadcasting },
    contains: (target) => [logo, svg].includes(target),
  };
  const scope = {
    document: {
      getElementById: () => title,
      getAnimations: () =>
        animations.map((playState) => ({
          playState,
          effect: { target: logo },
        })),
      fonts: { status: fonts },
    },
    window: { devicePixelRatio: 2 },
    getComputedStyle: (node, pseudo) => {
      calls.push({ node, pseudo });
      return { opacity: '1', filter: 'none', animationName: 'none' };
    },
  };
  return { scope, calls, logo, svg };
}

test('serialized paint observer reads actual logo pseudo-elements and complete SVG', () => {
  const context = harness();
  const signature = vm.runInNewContext(
    `(${readVisualPaintSignatureInPage.toString()})()`,
    context.scope,
  );
  assertVisualPaintSignature(signature);
  assert.equal(signature.svgMarkup, context.svg.outerHTML);
  for (const pseudo of ['::before', '::after'])
    assert.ok(
      context.calls.some(
        (call) => call.node === context.logo && call.pseudo === pseudo,
      ),
    );
});

test('composed atomic reader has no outer Node/module dependencies', () => {
  const callback = createVisualPaintSnapshotReader((args) => ({
    phase: args.phase,
    reason: null,
  }));
  const signature = vm.runInNewContext(
    `(${callback.toString()})({phase:0})`,
    harness().scope,
  );
  assert.equal(signature.phase, 0);
  assertVisualPaintSignature(signature.paint);
});

test('radio activity, active animation, missing fonts and oversized SVG cannot be qualified', () => {
  for (const options of [
    { broadcasting: true },
    { animations: ['running'] },
    { fonts: 'loading' },
  ]) {
    const value = harness(options);
    const signature = vm.runInNewContext(
      `(${readVisualPaintSignatureInPage.toString()})()`,
      value.scope,
    );
    assert.throws(() => assertVisualPaintSignature(signature));
  }
  const value = harness();
  value.svg.outerHTML = 'x'.repeat(65_537);
  const signature = vm.runInNewContext(
    `(${readVisualPaintSignatureInPage.toString()})()`,
    value.scope,
  );
  assert.equal(signature.status, 'unavailable');
  assert.throws(() => assertVisualPaintSignature(signature));
});
