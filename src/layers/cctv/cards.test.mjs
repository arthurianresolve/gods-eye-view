import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameSlot } from '../../data/cctvCards.js';
import { createCards } from './cards.js';

function installImageEnvironment(t, { hidden = false } = {}) {
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const images = [];
  const canvases = [];

  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
      this.removeAttributeCalls = [];
      this.handlersWereClearedBeforeEmptySrc = false;
      images.push(this);
    }

    get src() {
      return this._src;
    }

    set src(value) {
      this._src = value;
      if (value === '')
        this.handlersWereClearedBeforeEmptySrc =
          this.onload === null && this.onerror === null;
    }

    removeAttribute(name) {
      this.removeAttributeCalls.push(name);
      if (name === 'src') this._src = '';
    }
  }

  globalThis.Image = MockImage;
  globalThis.document = {
    hidden,
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        drawnImage: null,
        getContext(type) {
          assert.equal(type, '2d');
          return { drawImage: (image) => (canvas.drawnImage = image) };
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  t.after(() => {
    if (previousImage)
      Object.defineProperty(globalThis, 'Image', previousImage);
    else delete globalThis.Image;
    if (previousDocument)
      Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  return { images, canvases };
}

function makeCardHarness() {
  const state = {
    _cardFetchImages: new Set(),
    _cardFetchPendingIds: new Set(),
    _cardFetchInFlightCount: 0,
    _cardFetchMode: 'burst',
    _cardFetchTimer: 123,
    _cardLastFetchAt: 0,
    _cardFetchCount: 0,
    _cardMinFetchSpacingMs: null,
    _viewer: { scene: { requestRender() {} } },
  };
  const cards = createCards({
    state,
    services: {},
    source: {},
    parts: {
      model: { cardFrameTick() {} },
      frames: { frameUrlFor: () => 'https://camera.invalid/frame.jpg' },
    },
  });
  const record = { camera: { id: 'camera-1' } };
  const slot = createFrameSlot();
  return { cards, record, slot, state };
}

test('stopping the CCTV frame loop clears image src and ignores queued stale callbacks', (t) => {
  const { images, canvases } = installImageEnvironment(t);
  const { cards, record, slot, state } = makeCardHarness();
  cards.fetchCardFrame(record, slot, 1_000);
  const retiredImage = images[0];
  const staleLoad = retiredImage.onload;
  const staleError = retiredImage.onerror;

  cards.stopCardFrameLoop();

  assert.equal(retiredImage.onload, null);
  assert.equal(retiredImage.onerror, null);
  assert.equal(retiredImage.src, '');
  assert.equal(retiredImage.handlersWereClearedBeforeEmptySrc, true);
  assert.deepEqual(retiredImage.removeAttributeCalls, []);
  assert.equal(state._cardFetchTimer, 0);
  assert.equal(state._cardFetchImages.size, 0);
  assert.equal(state._cardFetchPendingIds.size, 0);
  assert.equal(state._cardFetchInFlightCount, 0);
  assert.equal(state._cardFetchMode, 'steady');

  staleLoad();
  staleError();
  assert.equal(canvases.length, 0, 'a queued stale callback must not decode');
  assert.equal(slot.frame, null);
  assert.equal(slot.stamp, 0);
  assert.equal(state._cardFetchCount, 1);

  cards.fetchCardFrame(record, slot, 1_000);
  const retryImage = images[1];
  retryImage.onload();
  assert.equal(slot.frame.drawnImage, retryImage);
  assert.ok(slot.stamp > 0, 'a new attempt can still commit its frame');
  assert.equal(state._cardFetchImages.size, 0);
  assert.equal(state._cardFetchPendingIds.size, 0);
  assert.equal(state._cardFetchInFlightCount, 0);
});

test('hiding the page clears image src and makes queued callbacks inert until a fresh attempt', (t) => {
  const { images, canvases } = installImageEnvironment(t);
  const { cards, record, slot, state } = makeCardHarness();
  cards.fetchCardFrame(record, slot, 1_000);
  const retiredImage = images[0];
  const staleLoad = retiredImage.onload;
  const staleError = retiredImage.onerror;

  document.hidden = true;
  cards.handleVisibilityChange();

  assert.equal(retiredImage.onload, null);
  assert.equal(retiredImage.onerror, null);
  assert.equal(retiredImage.src, '');
  assert.equal(retiredImage.handlersWereClearedBeforeEmptySrc, true);
  assert.deepEqual(retiredImage.removeAttributeCalls, []);
  assert.equal(state._cardFetchImages.size, 0);
  assert.equal(state._cardFetchPendingIds.size, 0);
  assert.equal(state._cardFetchInFlightCount, 0);
  assert.equal(state._cardFetchMode, 'burst');
  assert.equal(state._cardFetchCount, 1);

  staleLoad();
  staleError();
  assert.equal(canvases.length, 0);
  assert.equal(slot.frame, null);
  assert.equal(slot.stamp, 0);

  document.hidden = false;
  cards.fetchCardFrame(record, slot, 1_000);
  images[1].onerror();
  assert.equal(
    slot.failCount,
    1,
    'fresh fetch failures still settle for retry',
  );
  assert.equal(state._cardFetchCount, 2);
  assert.equal(state._cardFetchImages.size, 0);
  assert.equal(state._cardFetchPendingIds.size, 0);
  assert.equal(state._cardFetchInFlightCount, 0);
});
