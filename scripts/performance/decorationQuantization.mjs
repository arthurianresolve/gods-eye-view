import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DECORATION_STYLE_KEYS } from './decorationCaptureProof.mjs';

export const DECORATION_QUANTIZATION_POLICY =
  'source-bound-decoration-quantization-v1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const DECORATION_CALIBRATION_SHA256 =
  '71a616958532389ee4d1ec32980ed007c07d32370fa13232e352702c6190ead6';
// The documented calibration is pinned by digest; legacy sparse consumers do
// not require the evidence-doc directory merely to import this module.
const calibration = {
  sourceFiles: {
    'public/logo.svg':
      '9984443bf385b0f2eb41401ff0416cf2250db3c176e8ddd8a6d5d91c93a6b880',
    'src/logoGaze.js':
      '61c630088e7b3c0dfdb4734e4adc02a65f1b4e299fc46b1d002243f0ecf68284',
    'src/ui/styles/foundation.css':
      '5a8afb7246a09fc7766b776a13eac5b0f292d775a2b9c9c4da1ef3649faa46c1',
    'src/ui/styles/cctv.css':
      '73362eab2185bf7eca1b206cc9534c98d8578eff458932763e788e4bc8251b2d',
    'src/ui/templates/scene-chrome.html':
      '8142cf9bc94c0478c131e67c0cab887dcaa3e6d261ade32b036b5c6080d51bea',
    'src/ui/cctvFrames.js':
      '8d4b4f06014f3602a7c6ca7a447201b0cd4bb1324f3cceb1103cf16b5a19e110',
    'src/ui/templates/layer-panels.html':
      '65636d124425322f05ef3850d534d4fa60c6d738fcf7c9008cb17ab079df59f7',
    'index.html':
      'e166e40e73e92547317dedf26244121c23904e2f53396db108818e0baf2cf7aa',
  },
  headerPaintSha256:
    '8543d1a4c93f12c60c911a8817a29b9fb5c8631bc292942b797dafa9939534b5',
  support: {
    dpr: 2,
    viewport: {
      width: 1440,
      height: 900,
    },
    svgRect: {
      x: 36,
      y: 32,
      width: 52,
      height: 34.8828125,
    },
    logoHalfOpenDeviceRect: {
      left: 0,
      top: 0,
      right: 248,
      bottom: 206,
    },
    shadowSigmaCssPx: 12,
    shadowSpreadSigma: 3,
    opaquePathDeviceGuard: 1.01,
    curveErrorDevicePx: 0.01,
    protectedOpaquePixels: 2026,
    badgeBorderCssPx: 1,
    badgeAntialiasDevicePx: 1,
  },
};
export const DECORATION_SOURCE_FILES = Object.freeze(calibration.sourceFiles);
export const OPAQUE_INNER_EYE_PATH =
  'M568,179.985c107.678,0,194.968,88.655,194.968,198.015S675.678,576.015,568,576.015,373.032,487.36,373.032,378,460.322,179.985,568,179.985Z';

export function createDecorationQuantizationPlan() {
  return {
    policy: DECORATION_QUANTIZATION_POLICY,
    calibrationSha256: DECORATION_CALIBRATION_SHA256,
    sourceFiles: { ...DECORATION_SOURCE_FILES },
    headerPaintSha256: calibration.headerPaintSha256,
    support: structuredClone(calibration.support),
    comparisonsPerState: 15,
    logoMaximumRgbDelta: 2,
    badgeMaximumRgbDelta: 7,
    alphaAndExteriorExact: true,
    opaqueLogoInteriorExact: true,
    badgeTextAndInteriorExact: true,
    textWithinLogoSupport:
      'bounded-composite-equivalence-with-exact-source-text-font-and-geometry',
    imageSelection: 'all-six-images-all-unordered-pairs-no-fallback',
    historicalResultsSuperseded: false,
  };
}

const finiteRect = (rect) => {
  assert.ok(
    rect &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key])),
    'Finite decoration rectangle required',
  );
  assert.ok(
    rect.width > 0 && rect.height > 0,
    'Nonempty decoration rectangle required',
  );
};
const px = (value) => {
  assert.match(value || '', /^(?:\d+(?:\.\d+)?|\.\d+)px$/);
  return Number.parseFloat(value);
};
const completeStyle = (style) => {
  assert.deepEqual(
    Object.keys(style || {}),
    DECORATION_STYLE_KEYS,
    'Incomplete decoration style proof',
  );
  for (const value of Object.values(style))
    assert.ok(typeof value === 'string' && value.length <= 8192);
};

function assertUnscaledAxisAligned(style) {
  assert.equal(style.zoom, '1', 'Decoration support requires unit CSS zoom');
  assert.equal(
    style.perspective,
    'none',
    'Perspective invalidates decoration support',
  );
  assert.ok(
    ['none', '0deg'].includes(style.rotate),
    'Individual rotation invalidates decoration support',
  );
  assert.ok(
    ['none', '1', '1 1', '1 1 1'].includes(style.scale),
    'Individual scaling invalidates decoration support',
  );
  assert.ok(
    ['none', '0px', '0px 0px', '0px 0px 0px'].includes(style.translate),
    'Individual translation requires the declared identity presentation',
  );
  if (style.transform === 'none') return;
  const match = /^(matrix|matrix3d)\(([^)]+)\)$/.exec(style.transform);
  assert.ok(match, 'Unsupported decoration transform');
  const values = match[2].split(',').map((value) => Number(value.trim()));
  const count = match[1] === 'matrix' ? 6 : 16;
  assert.equal(values.length, count);
  assert.ok(values.every(Number.isFinite));
  const translation = count === 6 ? [4, 5] : [12, 13, 14];
  const diagonal = count === 6 ? [0, 3] : [0, 5, 10, 15];
  for (let index = 0; index < count; index++)
    if (!translation.includes(index))
      assert.equal(
        values[index],
        diagonal.includes(index) ? 1 : 0,
        'Only unscaled translation matrices preserve decoration support',
      );
}

/** Full measured proof is compared, not just the fields used to derive bounds. */
export function assertDecorationCaptureProof(proof, fonts, paint) {
  assert.equal(proof?.schema, 'gev-decoration-capture-proof/v1');
  assert.equal(proof.status, 'observed', 'Decoration proof unavailable');
  assert.equal(proof.overflow, false);
  assert.equal(proof.dpr, 2);
  assert.deepEqual(proof.viewport, { width: 1440, height: 900 });
  assert.equal(proof.fontsStatus, 'loaded');
  assert.equal(proof.activeAnimations, 0);
  assert.deepEqual(
    proof.badgeContent,
    {
      childElementCount: 0,
      childNodes: [{ nodeType: 3, text: 'SYNTHETIC · STALE' }],
    },
    'Badge must retain its original plain-text DOM shape',
  );
  assert.ok(Array.isArray(proof.faces) && proof.faces.length <= 32);
  for (const face of proof.faces) {
    assert.ok(['loaded', 'error', 'unloaded'].includes(face.status));
    for (const field of ['family', 'style', 'weight', 'stretch'])
      assert.ok(typeof face[field] === 'string' && face[field].length <= 512);
  }
  assert.equal(
    digest(JSON.stringify(paint)),
    calibration.headerPaintSha256,
    'Original header paint inputs changed',
  );
  assert.ok(paint.svgMarkup.includes(`d="${OPAQUE_INNER_EYE_PATH}"`));
  assert.deepEqual(
    proof.surfaces?.map((surface) => surface.selector),
    ['#title-bar', '#cctv-source-badge'],
  );
  for (const surface of proof.surfaces) {
    assert.ok(Array.isArray(surface.attributes));
    assert.ok(
      surface.attributes.some(
        ([name, value]) => name === 'id' && `#${value}` === surface.selector,
      ),
    );
    assert.ok(surface.ancestors.length > 0 && surface.ancestors.length <= 16);
    assert.equal(surface.ancestors[0].id, surface.selector.slice(1));
    assert.equal(
      surface.ancestors.at(-1).tag,
      'HTML',
      'Complete ancestor chain required',
    );
    for (const ancestor of surface.ancestors) {
      finiteRect(ancestor.rect);
      for (const style of [ancestor.style, ancestor.before, ancestor.after])
        completeStyle(style);
      assert.equal(ancestor.style.visibility, 'visible');
      assert.notEqual(ancestor.style.display, 'none');
      assert.equal(Number(ancestor.style.opacity), 1);
      assertUnscaledAxisAligned(ancestor.style);
      assert.ok(ancestor.before && ancestor.after);
    }
  }
  assert.ok(
    Array.isArray(proof.texts) &&
      proof.texts.length > 0 &&
      proof.texts.length <= 32,
  );
  for (const text of proof.texts) {
    assert.ok(['#title-bar', '#cctv-source-badge'].includes(text.root));
    assert.ok(
      typeof text.text === 'string' &&
        text.text.trim().length > 0 &&
        text.text.length <= 512,
    );
    assert.ok(text.parentSelector.startsWith(text.root));
    assert.ok(
      Number.isSafeInteger(text.textNodeIndex) && text.textNodeIndex >= 0,
    );
    assert.ok(text.rects.length > 0 && text.rects.length <= 8);
    text.rects.forEach(finiteRect);
    completeStyle(text.style);
    assert.equal(text.fontCheck, true, 'Text font availability failed');
    assert.equal(text.style.visibility, 'visible');
    assert.notEqual(text.style.display, 'none');
    assert.equal(Number(text.style.opacity), 1);
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'color'])
      assert.ok(
        typeof text.style[key] === 'string' && text.style[key].length > 0,
      );
  }
  assert.equal(
    proof.texts
      .filter((text) => text.root === '#title-bar')
      .map((text) => text.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
    "GOD'S EYE VIEWNO PLACE LEFT BEHIND",
    'Header text-node coverage changed',
  );
  assert.equal(
    proof.texts
      .filter((text) => text.root === '#cctv-source-badge')
      .map((text) => text.text)
      .join(''),
    'SYNTHETIC · STALE',
  );
  assert.deepEqual(
    fonts?.map((entry) => entry.selector),
    [...new Set(proof.texts.map((text) => text.parentSelector))].sort(),
    'Actual font usage does not cover every text parent',
  );
  for (const entry of fonts) {
    assert.ok(entry.fonts.length > 0 && entry.fonts.length <= 16);
    for (const font of entry.fonts) {
      for (const key of ['familyName', 'postScriptName'])
        assert.ok(
          typeof font[key] === 'string' &&
            font[key].length > 0 &&
            font[key].length <= 200,
        );
      assert.equal(typeof font.isCustomFont, 'boolean');
      assert.ok(Number.isSafeInteger(font.glyphCount) && font.glyphCount > 0);
    }
  }
  const badge = proof.surfaces[1].ancestors[0];
  const style = badge.style;
  assert.equal(badge.before.content, 'none');
  assert.equal(badge.after.content, 'none');
  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    assert.equal(px(style[`border${edge}Width`]), 1);
    assert.equal(style[`border${edge}Style`], 'solid');
    assert.equal(style[`border${edge}Color`], 'rgba(0, 212, 255, 0.32)');
  }
  for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'])
    assert.equal(px(style[`border${corner}Radius`]), 999);
  assert.equal(style.backgroundColor, 'rgba(0, 212, 255, 0.09)');
  assert.equal(style.color, 'rgb(157, 239, 255)');
  assert.equal(style.fontSize, '8px');
  assert.equal(style.letterSpacing, '1.3px');
  assert.equal(style.transform, 'none');
  assert.equal(style.filter, 'none');
  assert.ok(badge.rect.x >= 248 / 2 && badge.rect.y >= 206 / 2);
  assert.ok(
    badge.rect.x + badge.rect.width <= 1440 &&
      badge.rect.y + badge.rect.height <= 900,
  );
}

export function assertDecorationBoundaryPair(boundary, paint) {
  assert.ok(boundary, 'Screenshot-boundary decoration proof required');
  assertDecorationCaptureProof(
    boundary.before,
    boundary.fontsBefore,
    paint.before,
  );
  assertDecorationCaptureProof(
    boundary.after,
    boundary.fontsAfter,
    paint.after,
  );
  assert.deepEqual(
    boundary.before,
    boundary.after,
    'Decoration inputs changed during screenshot',
  );
  assert.deepEqual(
    boundary.fontsBefore,
    boundary.fontsAfter,
    'Actual font usage changed during screenshot',
  );
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator),
        );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Original opaque fill, not a mask derived from any changed-pixel set. */
export function createOpaqueLogoInterior() {
  const rect = calibration.support.svgRect;
  const scale = Math.min((rect.width * 2) / 775, (rect.height * 2) / 520);
  const offset = {
    x: rect.x * 2 + (rect.width * 2 - 775 * scale) / 2,
    y: rect.y * 2 + (rect.height * 2 - 520 * scale) / 2,
  };
  const map = ([x, y]) => ({
    x: offset.x + (x - 180) * scale,
    y: offset.y + (y - 120) * scale,
  });
  const segments = [
    [
      [568, 179.985],
      [675.678, 179.985],
      [762.968, 268.64],
      [762.968, 378],
    ],
    [
      [762.968, 378],
      [762.968, 487.36],
      [675.678, 576.015],
      [568, 576.015],
    ],
    [
      [568, 576.015],
      [460.322, 576.015],
      [373.032, 487.36],
      [373.032, 378],
    ],
    [
      [373.032, 378],
      [373.032, 268.64],
      [460.322, 179.985],
      [568, 179.985],
    ],
  ].map((segment) => segment.map(map));
  const points = [segments[0][0]];
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function flatten(s, depth = 0) {
    assert.ok(depth < 20, 'Opaque curve subdivision exceeded bound');
    if (
      Math.max(
        pointSegmentDistance(s[1], s[0], s[3]),
        pointSegmentDistance(s[2], s[0], s[3]),
      ) <= 0.01
    ) {
      points.push(s[3]);
      return;
    }
    const a = midpoint(s[0], s[1]),
      b = midpoint(s[1], s[2]),
      c = midpoint(s[2], s[3]);
    const d = midpoint(a, b),
      e = midpoint(b, c),
      f = midpoint(d, e);
    flatten([s[0], a, d, f], depth + 1);
    flatten([f, e, c, s[3]], depth + 1);
  }
  segments.forEach((segment) => flatten(segment));
  return (x, y) => {
    const p = { x: x + 0.5, y: y + 0.5 };
    let inside = false,
      distance = Infinity;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1],
        b = points[index];
      distance = Math.min(distance, pointSegmentDistance(p, a, b));
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside && distance > 1.01;
  };
}

/** A physical-pixel center in the mathematical pill border/one-pixel AA band. */
export function isBadgeBorderPixel(x, y, proof) {
  const rect = proof.surfaces[1].ancestors[0].rect;
  const left = rect.x * 2,
    top = rect.y * 2;
  const width = rect.width * 2,
    height = rect.height * 2;
  const radius = Math.min(width, height) / 2;
  const qx = Math.abs(x + 0.5 - left - width / 2) - width / 2 + radius;
  const qy = Math.abs(y + 0.5 - top - height / 2) - height / 2 + radius;
  const distance =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius;
  if (distance < -3 || distance > 1) return false;
  // Exact text line boxes plus one device pixel, including transparent spaces.
  return !proof.texts
    .filter((text) => text.root === '#cctv-source-badge')
    .some((text) =>
      text.rects.some(
        (box) =>
          x + 0.5 >= box.x * 2 - 1 &&
          x + 0.5 <= (box.x + box.width) * 2 + 1 &&
          y + 0.5 >= box.y * 2 - 1 &&
          y + 0.5 <= (box.y + box.height) * 2 + 1,
      ),
    );
}

export function createDecorationPixelLimits(proof) {
  const width = 2880,
    height = 1800;
  const limits = new Uint8Array(width * height);
  const opaque = createOpaqueLogoInterior();
  let opaquePixels = 0;
  for (let y = 0; y < 206; y++)
    for (let x = 0; x < 248; x++) {
      if (opaque(x, y)) opaquePixels++;
      else limits[y * width + x] = 2;
    }
  assert.equal(opaquePixels, 2026, 'Source-derived opaque core changed');
  const rect = proof.surfaces[1].ancestors[0].rect;
  for (
    let y = Math.max(0, Math.floor(rect.y * 2 - 1));
    y < Math.min(height, Math.ceil((rect.y + rect.height) * 2 + 1));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(rect.x * 2 - 1));
      x < Math.min(width, Math.ceil((rect.x + rect.width) * 2 + 1));
      x++
    )
      if (isBadgeBorderPixel(x, y, proof)) limits[y * width + x] = 7;
  return limits;
}

/** Exported separately for small, non-mirroring negative-control tests. */
export function compareDecorationPixels(left, right, limits) {
  assert.ok(Buffer.isBuffer(left) && Buffer.isBuffer(right));
  assert.equal(left.length, right.length);
  assert.equal(left.length, limits.length * 4);
  let changedPixels = 0;
  const regions = {
    exact: { pixels: 0, maximumRgbDelta: 0 },
    logo: { pixels: 0, maximumRgbDelta: 0 },
    badge: { pixels: 0, maximumRgbDelta: 0 },
  };
  if (left.equals(right)) return { changedPixels, regions };
  for (let offset = 0; offset < left.length; offset += 4) {
    assert.equal(
      left[offset + 3],
      right[offset + 3],
      `Alpha changed at pixel ${offset / 4}`,
    );
    const delta = Math.max(
      Math.abs(left[offset] - right[offset]),
      Math.abs(left[offset + 1] - right[offset + 1]),
      Math.abs(left[offset + 2] - right[offset + 2]),
    );
    if (!delta) continue;
    const limit = limits[offset / 4];
    assert.ok(
      delta <= limit,
      `RGB delta ${delta} exceeds source-region bound ${limit} at pixel ${offset / 4}`,
    );
    changedPixels++;
    const region =
      regions[limit === 2 ? 'logo' : limit === 7 ? 'badge' : 'exact'];
    region.pixels++;
    region.maximumRgbDelta = Math.max(region.maximumRgbDelta, delta);
  }
  return { changedPixels, regions };
}

export function validateDecorationImageControls(
  { baseline, candidate },
  proof,
) {
  assert.equal(baseline.length, 3);
  assert.equal(candidate.length, 3);
  const images = [...baseline, ...candidate];
  assert.equal(new Set(images.map((image) => image.id)).size, 6);
  for (const image of images)
    assert.equal(
      image.pixels.length,
      2880 * 1800 * 4,
      'Decoration profile dimensions changed',
    );
  const limits = createDecorationPixelLimits(proof);
  const comparisons = [];
  for (let left = 0; left < images.length; left++)
    for (let right = left + 1; right < images.length; right++)
      comparisons.push({
        left: images[left].id,
        right: images[right].id,
        ...compareDecorationPixels(
          images[left].pixels,
          images[right].pixels,
          limits,
        ),
      });
  assert.equal(comparisons.length, 15);
  return {
    policy: DECORATION_QUANTIZATION_POLICY,
    totalPixels: limits.length,
    comparisons,
  };
}
