import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  assertFramebufferPreservationDiagnostic,
  assertFramebufferPreservationUnchanged,
  installFramebufferPreservationDiagnostic,
  readFramebufferPreservationDiagnostic,
} from './framebufferPreservationDiagnostic.mjs';

test('installs the pre-document diagnostic hook and verifies false preservation', async () => {
  let installed = null;
  let browserRealm = null;
  const page = {
    async evaluateOnNewDocument(callback) {
      installed = callback;
    },
    async evaluate(callback) {
      assert.equal(typeof callback, 'function');
      return vm.runInNewContext(`(${callback.toString()})()`, browserRealm);
    },
  };
  await installFramebufferPreservationDiagnostic(page);
  assert.equal(typeof installed, 'function');
  class FakeCanvas {
    getContext(type, attributes) {
      return {
        type,
        attributes,
        getContextAttributes: () => attributes,
      };
    }
  }
  browserRealm = { HTMLCanvasElement: FakeCanvas };
  vm.runInNewContext(`(${installed.toString()})()`, browserRealm);
  const options = {
    alpha: false,
    preserveDrawingBuffer: true,
  };
  const canvas = new browserRealm.HTMLCanvasElement();
  const context = canvas.getContext('webgl', options);
  assert.equal(context.attributes.alpha, false);
  assert.equal(context.attributes.preserveDrawingBuffer, false);
  assert.equal(options.preserveDrawingBuffer, true);
  assert.equal(canvas.getContext('2d').attributes, undefined);
  context.getContextAttributes = () => ({
    preserveDrawingBuffer: false,
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  });
  context.isContextLost = () => false;
  browserRealm.__godsEyeView = {
    viewer: { scene: { context: { _gl: context } } },
  };
  const result = await readFramebufferPreservationDiagnostic(page);
  assert.equal(result.contextLost, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.actual)), {
    preserveDrawingBuffer: false,
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
    desynchronized: null,
  });
  assert.deepEqual(assertFramebufferPreservationDiagnostic(result), result);
  const replacement = {
    isContextLost: () => false,
    getContextAttributes: () => ({
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    }),
  };
  browserRealm.__godsEyeView.viewer.scene.context._gl = replacement;
  const replaced = await readFramebufferPreservationDiagnostic(page);
  assert.throws(() => assertFramebufferPreservationDiagnostic(replaced));
  replacement.getContextAttributes = () => ({
    preserveDrawingBuffer: false,
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  });
  const changed = await readFramebufferPreservationDiagnostic(page);
  assert.throws(() => assertFramebufferPreservationUnchanged(result, changed));
  replacement.isContextLost = () => true;
  const lost = await readFramebufferPreservationDiagnostic(page);
  assert.equal(lost.contextLost, true);
  assert.equal(lost.actual, null);
  assert.throws(() => assertFramebufferPreservationDiagnostic(lost));
  replacement.isContextLost = () => false;
  replacement.getContextAttributes = () => ({ antialias: true });
  const missingProperty = await readFramebufferPreservationDiagnostic(page);
  assert.equal(missingProperty.actual.preserveDrawingBuffer, null);
  assert.throws(() => assertFramebufferPreservationDiagnostic(missingProperty));
  replacement.getContextAttributes = () => null;
  const nullAttributes = await readFramebufferPreservationDiagnostic(page);
  assert.equal(nullAttributes.actual, null);
  assert.throws(() => assertFramebufferPreservationDiagnostic(nullAttributes));
  delete browserRealm.__godsEyeView.viewer.scene.context._gl;
  const missingContext = await readFramebufferPreservationDiagnostic(page);
  assert.equal(missingContext.contextLost, null);
  assert.equal(missingContext.actual, null);
  assert.throws(() => assertFramebufferPreservationDiagnostic(missingContext));
});

test('fails closed for missing, true, or unobserved WebGL attributes', () => {
  for (const observation of [
    null,
    {
      schema: 'gev-framebuffer-preservation-diagnostic/v1',
      requests: 1,
      webglRequests: 1,
      contextLost: false,
      actual: null,
    },
    {
      schema: 'gev-framebuffer-preservation-diagnostic/v1',
      requests: 1,
      webglRequests: 1,
      contextLost: false,
      actual: { preserveDrawingBuffer: true },
    },
    {
      schema: 'gev-framebuffer-preservation-diagnostic/v1',
      requests: 1,
      webglRequests: 1,
      contextLost: true,
      actual: null,
    },
    {
      schema: 'gev-framebuffer-preservation-diagnostic/v1',
      requests: 0,
      webglRequests: 0,
      actual: { preserveDrawingBuffer: false },
    },
  ])
    assert.throws(() => assertFramebufferPreservationDiagnostic(observation));
});

test('rejects changed or restored context attributes between checkpoints', () => {
  const before = {
    schema: 'gev-framebuffer-preservation-diagnostic/v1',
    requests: 1,
    webglRequests: 1,
    contextLost: false,
    actual: {
      preserveDrawingBuffer: false,
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      desynchronized: null,
    },
  };
  assertFramebufferPreservationUnchanged(before, structuredClone(before));
  assert.throws(() =>
    assertFramebufferPreservationUnchanged(before, {
      ...structuredClone(before),
      actual: { ...before.actual, preserveDrawingBuffer: true },
    }),
  );
  assert.throws(() =>
    assertFramebufferPreservationUnchanged(before, {
      ...structuredClone(before),
      actual: { ...before.actual, preserveDrawingBuffer: null },
    }),
  );
});
