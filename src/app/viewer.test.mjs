import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedResolutionScale,
  installResolutionScaleGuard,
} from './viewer.js';

class ResizeObserverFixture {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
  }
  observe(target) {
    this.targets.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  resize() {
    this.callback();
  }
}

function viewerFixture({ width = 2560, height = 1440 } = {}) {
  const listeners = new Map();
  const observerWindow = {
    devicePixelRatio: 2,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    visualViewport: {
      addEventListener: (type, listener) =>
        listeners.set(`visual:${type}`, listener),
      removeEventListener: (type) => listeners.delete(`visual:${type}`),
    },
  };
  const observerDocument = {
    addEventListener: (type, listener) =>
      listeners.set(`document:${type}`, listener),
    removeEventListener: (type) => listeners.delete(`document:${type}`),
  };
  class ViewerFixture {
    constructor() {
      this._scale = 1;
      this.canvas = { clientWidth: width, clientHeight: height };
      this.container = {};
      this.scene = {
        requestRender() {
          this.requests = (this.requests || 0) + 1;
        },
      };
      this.useBrowserRecommendedResolution = true;
    }
    get resolutionScale() {
      return this._scale;
    }
    set resolutionScale(value) {
      assert.ok(value > 0);
      this._scale = value;
    }
  }
  const viewer = new ViewerFixture();
  viewer.destroy = () => {
    viewer.destroyed = true;
  };
  return { viewer, listeners, observerWindow, observerDocument };
}

test('bounded resolution scale respects the stricter framebuffer limit and device ratio', () => {
  assert.equal(
    boundedResolutionScale({
      width: 2560,
      height: 1440,
      maxTextureSize: 2048,
      requestedScale: 1,
      headroom: 1,
    }),
    0.8,
  );
  assert.equal(
    boundedResolutionScale({
      width: 1280,
      height: 720,
      maxTextureSize: 1024,
      requestedScale: 2,
      pixelRatio: 2,
      headroom: 1,
    }),
    0.4,
  );
  assert.equal(
    boundedResolutionScale({
      width: 100,
      height: 100,
      maxTextureSize: 2048,
      requestedScale: 0.5,
    }),
    0.5,
  );
});

test('resolution guard caps requested quality and restores it after resize', () => {
  const f = viewerFixture();
  let observer;
  const guard = installResolutionScaleGuard(f.viewer, {
    maxTextureSize: 2048,
    maxRenderbufferSize: 4096,
    ResizeObserverClass: class extends ResizeObserverFixture {
      constructor(callback) {
        super(callback);
        observer = this;
      }
    },
    windowTarget: f.observerWindow,
    documentTarget: f.observerDocument,
  });
  assert.ok(f.viewer.resolutionScale < 0.8);
  f.viewer.resolutionScale = 1.5;
  assert.ok(f.viewer.resolutionScale < 0.8);
  f.viewer.canvas.clientWidth = 1280;
  f.viewer.canvas.clientHeight = 720;
  observer.resize();
  assert.equal(f.viewer.resolutionScale, 1.5);
  assert.equal(f.viewer.scene.requests, 2);
  assert.equal(observer.targets[0], f.viewer.container);
  guard.destroy();
  assert.equal(observer.disconnected, true);
  assert.equal(f.listeners.size, 0);
});

test('resolution guard applies device-pixel limits when browser resolution is disabled', () => {
  const f = viewerFixture();
  f.viewer.useBrowserRecommendedResolution = false;
  const guard = installResolutionScaleGuard(f.viewer, {
    maxTextureSize: 2048,
    maxRenderbufferSize: 1024,
    ResizeObserverClass: null,
    windowTarget: f.observerWindow,
    documentTarget: f.observerDocument,
  });
  assert.ok(f.viewer.resolutionScale < 0.2);
  guard.destroy();
});
