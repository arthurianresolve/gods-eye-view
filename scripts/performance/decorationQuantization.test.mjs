import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  DECORATION_QUANTIZATION_POLICY,
  DECORATION_CALIBRATION_SHA256,
  createDecorationQuantizationPlan,
  assertDecorationCaptureProof,
  assertDecorationBoundaryPair,
  createOpaqueLogoInterior,
  createDecorationPixelLimits,
  isBadgeBorderPixel,
  compareDecorationPixels,
  validateDecorationImageControls,
} from './decorationQuantization.mjs';
import { DECORATION_STYLE_KEYS } from './decorationCaptureProof.mjs';
import { createRepeatedVisualPlan } from './repeatedVisualQualification.mjs';

const paint = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/performance-evidence/s69-native-matrix-20261019/decoration-quantization-v1/header-reference.json',
      import.meta.url,
    ),
  ),
);
const style = () =>
  Object.assign(
    Object.fromEntries(DECORATION_STYLE_KEYS.map((key) => [key, ''])),
    {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      fontFamily: 'monospace',
      fontSize: '8px',
      fontWeight: '400',
      color: 'rgb(157, 239, 255)',
      content: 'none',
      transform: 'none',
      zoom: '1',
      rotate: 'none',
      scale: 'none',
      translate: 'none',
      perspective: 'none',
    },
  );
function fixture() {
  const badgeStyle = style();
  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    badgeStyle[`border${edge}Width`] = '1px';
    badgeStyle[`border${edge}Style`] = 'solid';
    badgeStyle[`border${edge}Color`] = 'rgba(0, 212, 255, 0.32)';
  }
  for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'])
    badgeStyle[`border${corner}Radius`] = '999px';
  Object.assign(badgeStyle, {
    backgroundColor: 'rgba(0, 212, 255, 0.09)',
    letterSpacing: '1.3px',
    transform: 'none',
    filter: 'none',
  });
  const surfaces = ['#title-bar', '#cctv-source-badge'].map(
    (selector, index) => ({
      selector,
      attributes: [['id', selector.slice(1)]],
      ancestors: [
        {
          tag: 'DIV',
          id: selector.slice(1),
          className: '',
          rect: index
            ? { x: 1000, y: 500, width: 120, height: 20 }
            : { x: 36, y: 32, width: 400, height: 56 },
          style: index ? badgeStyle : style(),
          before: style(),
          after: style(),
        },
      ],
    }),
  );
  for (const surface of surfaces)
    surface.ancestors.push({
      tag: 'HTML',
      id: '',
      className: '',
      rect: { x: 0, y: 0, width: 1440, height: 900 },
      style: style(),
      before: style(),
      after: style(),
    });
  const texts = [
    [
      "GOD'S EYE ",
      '#title-bar',
      '#title-bar > h1:nth-child(2) > span:nth-child(2)',
    ],
    [
      'VIEW',
      '#title-bar',
      '#title-bar > h1:nth-child(2) > span:nth-child(2) > span:nth-child(1)',
    ],
    ['NO PLACE LEFT BEHIND', '#title-bar', '#title-bar > p:nth-child(3)'],
    ['SYNTHETIC · STALE', '#cctv-source-badge', '#cctv-source-badge'],
  ].map(([text, root, parentSelector]) => ({
    text,
    root,
    parentSelector,
    textNodeIndex: 0,
    lang: 'en',
    rects: [
      {
        x: root === '#title-bar' ? 100 : 1008,
        y: root === '#title-bar' ? 40 : 505,
        width: 90,
        height: 10,
      },
    ],
    style: style(),
    fontCheck: true,
  }));
  const proof = {
    schema: 'gev-decoration-capture-proof/v1',
    status: 'observed',
    overflow: false,
    dpr: 2,
    viewport: { width: 1440, height: 900 },
    fontsStatus: 'loaded',
    faces: [],
    activeAnimations: 0,
    surfaces,
    texts,
    badgeContent: {
      childElementCount: 0,
      childNodes: [{ nodeType: 3, text: 'SYNTHETIC · STALE' }],
    },
  };
  const fonts = [...new Set(texts.map((text) => text.parentSelector))]
    .sort()
    .map((selector) => ({
      selector,
      fonts: [
        {
          familyName: 'Consolas',
          postScriptName: 'Consolas',
          isCustomFont: false,
          glyphCount: 12,
        },
      ],
    }));
  return { proof, fonts };
}

test('prospective plan is explicit, calibrated and cannot silently replace the legacy plan', () => {
  const calibrationBytes = readFileSync(
    new URL(
      '../../docs/performance-evidence/s69-native-matrix-20261019/decoration-quantization-v1/calibration.json',
      import.meta.url,
    ),
  );
  assert.equal(
    createHash('sha256').update(calibrationBytes).digest('hex'),
    DECORATION_CALIBRATION_SHA256,
  );
  const calibration = JSON.parse(calibrationBytes);
  assert.deepEqual(
    createDecorationQuantizationPlan().sourceFiles,
    calibration.sourceFiles,
  );
  assert.deepEqual(
    createDecorationQuantizationPlan().support,
    calibration.support,
  );
  assert.equal(
    createDecorationQuantizationPlan().headerPaintSha256,
    calibration.headerPaintSha256,
  );
  const options = {
    'baseline-app-sha': 'a'.repeat(40),
    'candidate-app-sha': 'b'.repeat(40),
    'visual-harness-sha': 'c'.repeat(40),
  };
  const legacy = createRepeatedVisualPlan(options);
  assert.equal(legacy.policy, 'repeated-full-image-controls-v1');
  assert.equal(legacy.decorationQuantization, undefined);
  assert.equal(legacy.smallVariance.maximumPixels, 10);
  const next = createRepeatedVisualPlan({
    ...options,
    'raster-policy': DECORATION_QUANTIZATION_POLICY,
  });
  assert.equal(next.pngCount, 24);
  assert.deepEqual(
    next.decorationQuantization,
    createDecorationQuantizationPlan(),
  );
  assert.equal(next.smallVariance, undefined);
  assert.ok(next.fullExtentPointerSweep);
  assert.throws(() =>
    createRepeatedVisualPlan(
      { ...options, 'raster-policy': DECORATION_QUANTIZATION_POLICY },
      { legacyAcquisition: true },
    ),
  );
  assert.throws(() =>
    createRepeatedVisualPlan({ ...options, 'raster-policy': 'guessed-policy' }),
  );
});

test('source-bound text, fonts, badge paint and complete boundary proof are mandatory', () => {
  const { proof, fonts } = fixture();
  assertDecorationCaptureProof(proof, fonts, paint);
  const boundary = {
    before: proof,
    after: structuredClone(proof),
    fontsBefore: fonts,
    fontsAfter: structuredClone(fonts),
  };
  assertDecorationBoundaryPair(boundary, { before: paint, after: paint });
  const corruptions = [
    (p) => {
      p.status = 'unavailable';
    },
    (p) => {
      p.overflow = true;
    },
    (p) => {
      p.dpr = 1;
    },
    (p) => {
      p.texts[0].text = 'CHANGED';
    },
    (p) => {
      p.texts.pop();
    },
    (p) => {
      p.texts[0].fontCheck = false;
    },
    (p) => {
      p.activeAnimations = 1;
    },
    (p) => {
      p.badgeContent.childElementCount = 1;
    },
    (p) => {
      p.badgeContent.childNodes.push({ nodeType: 1, text: null });
    },
    (p) => {
      p.surfaces[1].ancestors[0].before.content = '""';
    },
    (p) => {
      p.surfaces[1].ancestors[0].style.opacity = '0.99';
    },
    (p) => {
      p.surfaces[1].ancestors[0].style.color = 'rgb(158, 239, 255)';
    },
    (p) => {
      p.surfaces[1].ancestors[0].style.borderTopLeftRadius = '998px';
    },
    (p) => {
      delete p.surfaces[0].ancestors[0].style.clipPath;
    },
    (p) => {
      p.surfaces[1].ancestors[0].rect.x = NaN;
    },
  ];
  for (const mutate of corruptions) {
    const bad = structuredClone(proof);
    mutate(bad);
    assert.throws(() => assertDecorationCaptureProof(bad, fonts, paint));
  }
  for (const mutate of [
    (p) => {
      p.texts[0].style.fontFamily = 'other';
    },
    (p) => {
      p.texts[0].rects[0].x++;
    },
    (p) => {
      p.surfaces[1].ancestors[0].rect.width++;
    },
    (p) => {
      p.surfaces[1].ancestors[0].style.backdropFilter = 'blur(1px)';
    },
  ]) {
    const bad = structuredClone(boundary);
    mutate(bad.after);
    assert.throws(() =>
      assertDecorationBoundaryPair(bad, { before: paint, after: paint }),
    );
  }
  const badFonts = structuredClone(boundary);
  badFonts.fontsAfter[0].fonts[0].postScriptName = 'Other';
  assert.throws(() =>
    assertDecorationBoundaryPair(badFonts, { before: paint, after: paint }),
  );
  assert.throws(() => assertDecorationCaptureProof(proof, [], paint));
  for (const mutate of [
    (p) => {
      p.svgMarkup = p.svgMarkup.replace('M568,179.985', 'M569,179.985');
    },
    (p) => {
      p.elements[0].style.opacity = '0.99';
    },
    (p) => {
      p.elements[0].style.filter = 'blur(1px)';
    },
    (p) => {
      p.elements[0].rect.x++;
    },
  ]) {
    const bad = structuredClone(paint);
    mutate(bad);
    assert.throws(() => assertDecorationCaptureProof(proof, fonts, bad));
  }
});

test('boxless DOM ancestors retain exact proof while painted surface and text boxes stay nonempty', () => {
  // The unchanged application places this wrapper directly above the badge.
  // CSS display: contents generates no principal box; this is a source-based
  // reproduction, not a recovered snapshot from the failed native attempt.
  const markup = readFileSync(
    new URL('../../src/ui/templates/layer-panels.html', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../../src/ui/styles/controls.css', import.meta.url),
    'utf8',
  );
  assert.match(markup, /class="cyber-panel-body" data-rail-scroller>/);
  assert.match(css, /\.cyber-panel-body\s*\{\s*display: contents;/);
  const { proof, fonts } = fixture();
  const wrapper = {
    tag: 'DIV',
    id: '',
    className: 'cyber-panel-body',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    style: { ...style(), display: 'contents' },
    before: style(),
    after: style(),
  };
  proof.surfaces[1].ancestors.splice(1, 0, wrapper);
  assertDecorationCaptureProof(proof, fonts, paint);
  const boundary = {
    before: proof,
    after: structuredClone(proof),
    fontsBefore: fonts,
    fontsAfter: structuredClone(fonts),
  };
  assertDecorationBoundaryPair(boundary, { before: paint, after: paint });
  boundary.after.surfaces[1].ancestors[1].rect.x = 1;
  assert.throws(
    () =>
      assertDecorationBoundaryPair(boundary, { before: paint, after: paint }),
    /Decoration inputs changed/,
  );
  for (const corrupt of [
    (p) => {
      p.surfaces[1].ancestors[1].rect.width = -1;
    },
    (p) => {
      p.surfaces[1].ancestors[1].rect.height = Infinity;
    },
    (p) => {
      p.surfaces[1].ancestors[0].rect.height = 0;
    },
    (p) => {
      p.surfaces[0].ancestors[0].rect.width = 0;
    },
    (p) => {
      p.texts[0].rects[0].width = 0;
    },
    (p) => {
      p.texts[3].rects[0].height = 0;
    },
    (p) => {
      p.surfaces[1].ancestors[1].style.display = 'none';
    },
    (p) => {
      p.surfaces[1].ancestors[1].style.visibility = 'hidden';
    },
    (p) => {
      p.surfaces[1].ancestors[1].style.opacity = '0';
    },
    (p) => {
      p.surfaces[1].ancestors[1].style.transform = 'scale(2)';
    },
  ]) {
    const invalid = structuredClone(proof);
    corrupt(invalid);
    assert.throws(() => assertDecorationCaptureProof(invalid, fonts, paint));
  }
  const zeroHeight = structuredClone(proof);
  zeroHeight.surfaces[0].ancestors.splice(1, 0, {
    ...structuredClone(wrapper),
    tag: 'BODY',
    className: '',
    rect: { x: 0, y: 0, width: 1440, height: 0 },
    style: style(),
  });
  assertDecorationCaptureProof(zeroHeight, fonts, paint);
});

test('source curve protects 2026 opaque pixels and mathematical badge excludes interior/text/exterior', () => {
  const { proof } = fixture();
  const limits = createDecorationPixelLimits(proof);
  const opaque = createOpaqueLogoInterior();
  let count = 0;
  for (let y = 64; y < 135; y++)
    for (let x = 71; x < 177; x++)
      if (opaque(x, y)) {
        count++;
        assert.equal(limits[y * 2880 + x], 0);
      }
  assert.equal(count, 2026);
  assert.equal(limits[20 * 2880 + 200], 2);
  assert.equal(limits[206 * 2880 + 100], 0);
  assert.equal(limits[100 * 2880 + 248], 0);
  assert.equal(isBadgeBorderPixel(2120, 1000, proof), true);
  assert.equal(isBadgeBorderPixel(2120, 1020, proof), false);
  assert.equal(isBadgeBorderPixel(1990, 1000, proof), false);
  const overBorder = structuredClone(proof);
  overBorder.texts[3].rects = [{ x: 1050, y: 499, width: 30, height: 3 }];
  assert.equal(isBadgeBorderPixel(2120, 1000, overBorder), false);
});

test('the CSS-to-device support rejects ancestor scale, shear, perspective, zoom and individual transforms', () => {
  const { proof, fonts } = fixture();
  for (const surface of [0, 1]) {
    for (const [key, value] of [
      ['zoom', '2'],
      ['perspective', '100px'],
      ['rotate', '1deg'],
      ['scale', '1.01'],
      ['translate', '1px'],
      ['transform', 'matrix(1.01, 0, 0, 1, 0, 0)'],
      ['transform', 'matrix(1, 0.1, 0, 1, 0, 0)'],
      ['transform', 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0.1,0,0,0,1)'],
    ]) {
      const bad = structuredClone(proof);
      bad.surfaces[surface].ancestors[1].style[key] = value;
      assert.throws(() => assertDecorationCaptureProof(bad, fonts, paint));
    }
  }
  for (const transform of [
    'matrix(1, 0, 0, 1, 5.5, -2)',
    'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1)',
  ]) {
    const translated = structuredClone(proof);
    translated.surfaces[1].ancestors[1].style.transform = transform;
    assertDecorationCaptureProof(translated, fonts, paint);
  }
  const truncated = structuredClone(proof);
  truncated.surfaces[1].ancestors.pop();
  assert.throws(() => assertDecorationCaptureProof(truncated, fonts, paint));
});

test('all channels are bounded per region; exterior/opaque/alpha remain exact, no pixel-count budget', () => {
  const left = Buffer.alloc(4 * 300, 100),
    right = Buffer.from(left);
  const limits = new Uint8Array(300).fill(2);
  for (let index = 0; index < 300; index++) right[index * 4] += 2;
  assert.equal(compareDecorationPixels(left, right, limits).changedPixels, 300);
  for (const [limit, delta] of [
    [2, 3],
    [7, 8],
    [0, 1],
  ]) {
    assert.throws(() =>
      compareDecorationPixels(
        Buffer.from([10, 10, 10, 255]),
        Buffer.from([10 + delta, 10, 10, 255]),
        Uint8Array.of(limit),
      ),
    );
  }
  assert.throws(
    () =>
      compareDecorationPixels(
        Buffer.from([10, 10, 10, 255]),
        Buffer.from([10, 10, 10, 254]),
        Uint8Array.of(7),
      ),
    /Alpha/,
  );
  assert.doesNotThrow(() =>
    compareDecorationPixels(
      Buffer.from([10, 10, 10, 255]),
      Buffer.from([17, 10, 10, 255]),
      Uint8Array.of(7),
    ),
  );
});

test('all 15 pairs are checked; a shared-value bridge cannot hide an extreme pair', () => {
  const { proof } = fixture();
  const zero = Buffer.alloc(2880 * 1800 * 4);
  const build = (prefix) =>
    [1, 2, 3].map((index) => ({ id: `${prefix}-${index}`, pixels: zero }));
  const images = { baseline: build('baseline'), candidate: build('candidate') };
  assert.equal(
    validateDecorationImageControls(images, proof).comparisons.length,
    15,
  );
  const variants = [
    zero,
    ...[1, 2, 3].map((value) => {
      const pixels = Buffer.from(zero);
      pixels[(20 * 2880 + 200) * 4] = value;
      return pixels;
    }),
  ];
  images.baseline.forEach((image, index) => {
    image.pixels = variants[index];
  });
  images.candidate.forEach((image, index) => {
    image.pixels = variants[index + 1];
  });
  assert.throws(
    () => validateDecorationImageControls(images, proof),
    /exceeds source-region bound/,
  );
  images.candidate.pop();
  assert.throws(() => validateDecorationImageControls(images, proof));
});
