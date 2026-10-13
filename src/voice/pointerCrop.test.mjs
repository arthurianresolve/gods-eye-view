import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RealtimeViewport,
  capturePointerCrop,
  captureViewportImage,
  pointerCropRect,
  renderFreshPointerFrame,
} from './realtimeViewport.js';

function installCaptureSurface(
  t,
  {
    source = { width: 1200, height: 900, clientWidth: 600, clientHeight: 450 },
    nullContextAt = null,
    sampleContext = true,
    samplePixels = [32, 64, 96, 255],
    sampleReadError = false,
    encoded = 'data:image/jpeg;base64,AA==',
    encodeError = false,
    drawErrorAt = null,
    onEncode = null,
    onRequestRender = null,
  } = {},
) {
  const previous = new Map(
    ['document', 'window'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const doc = new EventTarget();
  doc.hidden = false;
  const listeners = new Set();
  const canvases = [];
  let drawCount = 0;
  doc.createElement = (tagName) => {
    assert.equal(tagName, 'canvas');
    const canvasIndex = canvases.length;
    const canvas = {
      width: 0,
      height: 0,
      draws: [],
      getContext(_kind, options) {
        const isSample = options?.willReadFrequently === true;
        if (isSample && !sampleContext) return null;
        if (!isSample && canvasIndex === nullContextAt) return null;
        const context = {
          canvas,
          drawImage(...args) {
            drawCount++;
            if (drawErrorAt === drawCount) throw new Error('draw failed');
            canvas.draws.push(args);
          },
          getImageData() {
            if (sampleReadError) throw new Error('sample read failed');
            const pixels = new Uint8ClampedArray(
              canvas.width * canvas.height * 4,
            );
            for (let offset = 0; offset < pixels.length; offset += 4)
              pixels.set(samplePixels, offset);
            return { data: pixels };
          },
          beginPath() {},
          arc(...args) {
            canvas.arc = args;
          },
          stroke() {},
        };
        return context;
      },
      toDataURL() {
        if (encodeError) throw new Error('encoder unavailable');
        onEncode?.(canvas.width, canvas.height);
        return encoded;
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  const viewer = {
    isDestroyed: () => false,
    scene: {
      canvas: source,
      postRender: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      requestRender() {
        if (onRequestRender) onRequestRender(source, listeners);
        else for (const listener of [...listeners]) listener();
      },
    },
  };
  globalThis.document = doc;
  globalThis.window = { __godsEyeView: { viewer } };
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { viewer, doc, canvases, listeners, source };
}

function assertCaptureCanvasesReleased(env) {
  for (const [index, canvas] of env.canvases.entries())
    assert.equal(
      canvas.width * canvas.height,
      0,
      `temporary canvas ${index + 1} was released`,
    );
}

const actualCaptureCallers = [
  ['viewport', captureViewportImage],
  ['pointer', () => capturePointerCrop({ x: 150, y: 100 })],
];

for (const [name, capture] of actualCaptureCallers) {
  test(`${name} capture copies a real postRender frame, encodes it and releases its owned canvases`, async (t) => {
    const env = installCaptureSurface(t);
    const result = await capture();
    assert.ok(
      name === 'viewport'
        ? typeof result === 'string'
        : typeof result?.dataUrl === 'string',
    );
    assert.equal(env.listeners.size, 0);
    assert.equal(
      env.canvases.length,
      3,
      'fresh copy, encoded output and black-frame probe',
    );
    assertCaptureCanvasesReleased(env);
  });

  for (const [mode, options] of [
    ['null output context', { nullContextAt: 1 }],
    ['caller draw exception', { drawErrorAt: 2 }],
    ['encoder exception', { encodeError: true }],
    ['black frame', { samplePixels: [0, 0, 0, 255] }],
    [
      'oversized encoding',
      { encoded: `data:image/jpeg;base64,${'A'.repeat(300 * 1024)}` },
    ],
  ]) {
    test(`${name} capture rejects ${mode} and clears copied/output canvases`, async (t) => {
      const env = installCaptureSurface(t, options);
      assert.equal(await capture(), null);
      assert.equal(env.listeners.size, 0);
      assertCaptureCanvasesReleased(env);
    });
  }

  test(`${name} capture preserves the existing non-black result when sample context is unavailable and releases it`, async (t) => {
    const env = installCaptureSurface(t, { sampleContext: false });
    const result = await capture();
    assert.ok(
      name === 'viewport'
        ? typeof result === 'string'
        : typeof result?.dataUrl === 'string',
    );
    assert.equal(env.canvases.length, 3);
    assertCaptureCanvasesReleased(env);
  });

  for (const [mode, options] of [
    ['sample draw exception', { drawErrorAt: 3 }],
    ['sample readback exception', { sampleReadError: true }],
  ]) {
    test(`${name} capture rejects ${mode} and releases the sample canvas`, async (t) => {
      const env = installCaptureSurface(t, options);
      assert.equal(await capture(), null);
      assert.equal(env.canvases.length, 3);
      assertCaptureCanvasesReleased(env);
    });
  }
}

test('viewport capture uses resized completed-frame dimensions before applying its pixel cap', async (t) => {
  let encodedDimensions = null;
  const env = installCaptureSurface(t, {
    source: { width: 600, height: 400, clientWidth: 600, clientHeight: 400 },
    onRequestRender(source, listeners) {
      source.width = 3200;
      source.height = 2400;
      for (const listener of [...listeners]) listener();
    },
    onEncode(width, height) {
      encodedDimensions = { width, height };
    },
  });
  assert.equal(typeof (await captureViewportImage()), 'string');
  assert.ok(encodedDimensions.width * encodedDimensions.height <= 1200 * 900);
  assert.ok(encodedDimensions.width > 600);
  assert.equal(env.canvases[0].width * env.canvases[0].height, 0);
  assert.equal(env.canvases[1].width * env.canvases[1].height, 0);
});

test('pointer capture scales its crop against resized postRender pixels', async (t) => {
  const env = installCaptureSurface(t, {
    source: { width: 600, height: 400, clientWidth: 600, clientHeight: 400 },
    onRequestRender(source, listeners) {
      source.width = 2400;
      source.height = 1600;
      for (const listener of [...listeners]) listener();
    },
  });
  const result = await capturePointerCrop({ x: 150, y: 100 });
  assert.equal(typeof result?.dataUrl, 'string');
  assert.equal(result.rect.w, 400 / 600);
  const cropDraw = env.canvases[1].draws[0];
  assert.equal(cropDraw[3], 1600);
  assert.equal(cropDraw[4], 1600);
  assert.equal(env.canvases[0].width * env.canvases[0].height, 0);
  assert.equal(env.canvases[1].width * env.canvases[1].height, 0);
});

test('crop: a square around the pointer, clamped inside the canvas, in buffer pixels', () => {
  assert.deepEqual(
    pointerCropRect({
      x: 750,
      y: 475,
      cssWidth: 1500,
      cssHeight: 950,
      pixelWidth: 3000,
      pixelHeight: 1900,
    }),
    {
      sx: 988,
      sy: 438,
      sw: 1024,
      sh: 1024,
      output: 512,
      pointX: 256,
      pointY: 256,
    },
  );
  const corner = pointerCropRect({
    x: 20,
    y: 20,
    cssWidth: 1500,
    cssHeight: 950,
    pixelWidth: 1500,
    pixelHeight: 950,
  });
  assert.equal(corner.sx, 0);
  assert.equal(corner.sy, 0);
  assert.equal(
    corner.pointX,
    20,
    'the ring still marks the real spot near an edge',
  );
  assert.equal(
    pointerCropRect({
      x: 1,
      y: 1,
      cssWidth: 0,
      cssHeight: 0,
      pixelWidth: 0,
      pixelHeight: 0,
    }),
    null,
  );
  assert.equal(
    pointerCropRect({
      x: Number.NaN,
      y: 1,
      cssWidth: 100,
      cssHeight: 100,
      pixelWidth: 100,
      pixelHeight: 100,
    }),
    null,
    'non-finite pointer geometry fails closed',
  );
  assert.equal(
    pointerCropRect({
      x: 101,
      y: 1,
      cssWidth: 100,
      cssHeight: 100,
      pixelWidth: 100,
      pixelHeight: 100,
    }),
    null,
    'out-of-canvas pointer geometry fails closed',
  );
  assert.equal(
    pointerCropRect({
      x: 120,
      y: 100,
      cssWidth: 320,
      cssHeight: 240,
      pixelWidth: 320,
      pixelHeight: 240,
    }).output,
    512,
    'the provider image stays 512 px even when the source crop is smaller',
  );
});

test('crop: a slow render gets one bounded fresh-frame recovery request', async () => {
  const originalDocument = globalThis.document;
  let requests = 0;
  let listener = null;
  try {
    globalThis.document = { hidden: false };
    const scene = {
      postRender: {
        addEventListener(next) {
          listener = next;
          return () => {
            if (listener === next) listener = null;
          };
        },
      },
      requestRender() {
        requests += 1;
        if (requests === 2) queueMicrotask(() => listener?.());
      },
    };
    assert.equal(await renderFreshPointerFrame({ scene }), true);
    assert.equal(requests, 2, 'only the pointer path retries once');
    assert.equal(listener, null, 'the successful listener is removed');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('crop: a hidden document never starts the recovery request', async () => {
  const originalDocument = globalThis.document;
  let requests = 0;
  try {
    globalThis.document = { hidden: true };
    const scene = {
      postRender: { addEventListener: () => () => {} },
      requestRender() {
        requests += 1;
      },
    };
    assert.equal(await renderFreshPointerFrame({ scene }), false);
    assert.equal(requests, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});

function viewportFixture({ capturePointer, capture } = {}) {
  const sent = [];
  const captures = [];
  const state = { clock: 10_000, pointer: null, camera: 'pose-A' };
  const channel = { readyState: 'open' };
  const viewport = new RealtimeViewport({
    readChannel: () => channel,
    readPointer: () => state.pointer,
    readCameraKey: () => state.camera,
    capture: capture || (async () => 'data:image/jpeg;base64,FULL'),
    capturePointer:
      capturePointer ||
      (async (px) => {
        captures.push(px);
        return {
          dataUrl: 'data:image/jpeg;base64,CROP',
          rect: { x: 0.25, y: 0.2, w: 0.3, h: 0.5 },
        };
      }),
    now: () => state.clock,
    operations: {
      sendRealtimeEvent: (event, label) => {
        sent.push({ event, label });
        return true;
      },
    },
  });
  return { viewport, sent, captures, state };
}

const ground = {
  fresh: true,
  target: 'ground',
  at: 'keydown',
  screenPx: { x: 400, y: 300 },
  capturedAt: 9_000,
  cameraKey: 'pose-A',
};

test('crop: sent once per snapshot, only at local/city scale, into the one retained slot', async () => {
  const { viewport, sent, captures, state } = viewportFixture();
  assert.equal(
    await viewport.sendPointerCrop(ground, { viewScale: 'regional' }),
    false,
    'the scale guard lives in the shared send path',
  );
  assert.equal(
    await viewport.sendPointerCrop(ground),
    false,
    'no scale, no crop',
  );
  assert.equal(
    await viewport.sendPointerCrop(ground, { viewScale: 'city' }),
    true,
  );
  assert.equal(
    await viewport.sendPointerCrop(ground, { viewScale: 'city' }),
    false,
    'once per snapshot',
  );
  assert.deepEqual(captures, [{ x: 400, y: 300 }]);
  assert.equal(sent[0].label, 'client.pointer_crop');
  assert.match(sent[0].event.item.content[0].text, /ring marks the exact spot/);
  assert.equal(
    sent[0].event.item.content[1].image_url,
    'data:image/jpeg;base64,CROP',
  );
  assert.deepEqual(viewport.retainedFrame, {
    kind: 'crop',
    rect: { x: 0.25, y: 0.2, w: 0.3, h: 0.5 },
    cameraKey: 'pose-A',
  });
  assert.equal(
    await viewport.sendPointerCrop(
      { ...ground, target: 'entity' },
      { viewScale: 'city' },
    ),
    false,
    'entities are named, not cropped',
  );
  state.clock = 60_000;
  assert.equal(
    await viewport.sendPointerCrop({ ...ground }, { viewScale: 'city' }),
    false,
    'too old',
  );

  // Pull: a ground pointer lookup sends the crop, deleting the old image.
  state.clock = 10_000;
  state.pointer = { ...ground, at: 'speech_start' };
  const lookup = {
    action: 'get_entity_context',
    scope: 'pointer',
    selected: null,
    pointer: { latitude: 1, longitude: 2 },
    scene: { basemap: { viewScale: 'city' } },
  };
  assert.equal(await viewport.sendVisualContextIfUseful(lookup), true);
  assert.equal(
    sent.at(-2).event.type,
    'conversation.item.delete',
    'one retained image at most',
  );
  assert.equal(sent.at(-1).label, 'client.pointer_crop');
  assert.equal(
    await viewport.sendVisualContextIfUseful({
      ...lookup,
      selected: { id: 'x' },
    }),
    false,
  );
  assert.equal(
    await viewport.sendVisualContextIfUseful({
      ...lookup,
      scene: { basemap: { viewScale: 'regional' } },
    }),
    false,
  );
  viewport.reset();
  assert.equal(viewport.lastPointerCrop, null);
  assert.equal(viewport.retainedFrame, null);
});

test('crop: a camera move before or during capture drops it; pixels only name their own pose', async () => {
  let release;
  const { viewport, sent, state } = viewportFixture({
    capturePointer: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            dataUrl: 'data:image/jpeg;base64,CROP',
            rect: { x: 0, y: 0, w: 1, h: 1 },
          });
      }),
  });
  state.camera = 'pose-B';
  assert.equal(
    await viewport.sendPointerCrop(ground, { viewScale: 'local' }),
    false,
    'moved before capture',
  );
  state.camera = null;
  assert.equal(
    await viewport.sendPointerCrop(
      { ...ground, cameraKey: null },
      { viewScale: 'local' },
    ),
    false,
    'a missing pose identity fails closed',
  );
  state.camera = 'pose-A';
  const pending = viewport.sendPointerCrop(
    { ...ground },
    { viewScale: 'local' },
  );
  state.camera = 'pose-B';
  release();
  assert.equal(await pending, false, 'moved while capturing');
  assert.equal(sent.length, 0);
});

test('crop: a snapshot that expires during capture is not published', async () => {
  let release;
  const { viewport, sent, state } = viewportFixture({
    capturePointer: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            dataUrl: 'data:image/jpeg;base64,CROP',
            rect: { x: 0, y: 0, w: 1, h: 1 },
          });
      }),
  });
  const pending = viewport.sendPointerCrop(
    { ...ground },
    { viewScale: 'local' },
  );
  state.clock = 40_000;
  release();
  assert.equal(await pending, false);
  assert.equal(sent.length, 0);
});

test('crop: an older capture that finishes last never replaces the newer image', async () => {
  const releases = [];
  const { viewport, sent } = viewportFixture({
    capturePointer: () =>
      new Promise((resolve) =>
        releases.push((url) => resolve({ dataUrl: url, rect: null })),
      ),
  });
  const first = viewport.sendPointerCrop({ ...ground }, { viewScale: 'local' });
  const second = viewport.sendPointerCrop(
    { ...ground },
    { viewScale: 'local' },
  );
  releases[1]('data:image/jpeg;base64,NEW');
  assert.equal(await second, true);
  releases[0]('data:image/jpeg;base64,OLD');
  assert.equal(await first, false, 'superseded request');
  assert.deepEqual(
    sent.map((s) => s.event.item?.content?.[1]?.image_url).filter(Boolean),
    ['data:image/jpeg;base64,NEW'],
  );

  // A new user turn drops a capture still in flight from the previous one.
  const third = viewport.sendPointerCrop({ ...ground }, { viewScale: 'local' });
  viewport.beginTurn();
  releases[2]('data:image/jpeg;base64,LATE');
  assert.equal(await third, false);
});
