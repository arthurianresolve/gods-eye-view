#!/usr/bin/env node
/** Exercise Cesium's framebuffer cap with a constrained WebGL fixture. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.setViewport({ width: 2560, height: 1440 });
  await page.evaluateOnNewDocument(() => {
    for (const Context of [
      globalThis.WebGLRenderingContext,
      globalThis.WebGL2RenderingContext,
    ]) {
      if (!Context) continue;
      const original = Context.prototype.getParameter;
      Context.prototype.getParameter = function getConstrainedParameter(
        parameter,
      ) {
        if (parameter === 3379 || parameter === 34024) return 2048;
        return original.call(this, parameter);
      };
    }
  });
  const appUrl = new URL(url);
  appUrl.searchParams.set('welcome', '0');
  await page.goto(appUrl.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60_000 },
  );

  const first = await page.evaluate(async () => {
    const viewer = window.__godsEyeView.viewer;
    await new Promise((resolve, reject) => {
      let remaining = 4;
      const timeout = setTimeout(() => {
        remove();
        reject(new Error('Cesium did not render four constrained frames'));
      }, 15_000);
      const remove = viewer.scene.postRender.addEventListener(() => {
        if (--remaining === 0) {
          remove();
          clearTimeout(timeout);
          resolve();
        } else {
          // Drive this framebuffer fixture explicitly: the parked application
          // may be idle, and a vsync callback alone does not guarantee a draw.
          setTimeout(() => {
            viewer.scene.requestRender();
            viewer.render();
          }, 0);
        }
      });
      viewer.scene.requestRender();
      viewer.render();
    });
    const gl = viewer.scene.context._gl;
    return {
      width: viewer.canvas.width,
      height: viewer.canvas.height,
      textureLimit: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      renderbufferLimit: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      resolutionScale: viewer.resolutionScale,
    };
  });
  assert.equal(first.textureLimit, 2048);
  assert.equal(first.renderbufferLimit, 2048);
  assert.ok(first.width <= first.textureLimit, JSON.stringify(first));
  assert.ok(first.height <= first.renderbufferLimit, JSON.stringify(first));
  assert.ok(first.resolutionScale < 0.8, JSON.stringify(first));

  await page.evaluate(() => {
    window.__godsEyeView.viewer.resolutionScale = 1.5;
  });
  const constrainedScale = await page.evaluate(
    () => window.__godsEyeView.viewer.resolutionScale,
  );
  assert.ok(
    constrainedScale < 0.8,
    `scale escaped framebuffer cap: ${constrainedScale}`,
  );

  await page.setViewport({ width: 1280, height: 720 });
  await page.waitForFunction(
    () => window.__godsEyeView.viewer.resolutionScale >= 1.49,
    { timeout: 10_000 },
  );
  const resized = await page.evaluate(async () => {
    const viewer = window.__godsEyeView.viewer;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        remove();
        reject(new Error('Cesium did not render after viewport resize'));
      }, 15_000);
      const remove = viewer.scene.postRender.addEventListener(() => {
        if (settled) return;
        settled = true;
        remove();
        clearTimeout(timeout);
        resolve();
      });
      viewer.scene.requestRender();
      viewer.render();
    });
    return {
      width: viewer.canvas.width,
      height: viewer.canvas.height,
      scale: viewer.resolutionScale,
    };
  });
  assert.ok(resized.width <= 2048, JSON.stringify(resized));
  assert.ok(resized.height <= 2048, JSON.stringify(resized));
  assert.equal(resized.scale, 1.5);
  const recovery = await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    const event = new Event('webglcontextlost', { cancelable: true });
    viewer.scene.canvas.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      visible: !document.getElementById('webgl-recovery-status').hidden,
      message: document.getElementById('webgl-recovery-message').textContent,
      url: window.__godsEyeView.styleManager.shareLinkManager.createRecoveryUrl(),
    };
  });
  assert.equal(recovery.prevented, true, JSON.stringify(recovery));
  assert.equal(recovery.visible, true, JSON.stringify(recovery));
  assert.match(recovery.message, /Reload to restore this view/);
  assert.ok(new URL(recovery.url).hash.length > 1, JSON.stringify(recovery));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: constrained WebGL cap, quality restoration, and view-preserving context-loss recovery',
  );
} finally {
  await browser.close();
}
