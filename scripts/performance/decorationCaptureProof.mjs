import assert from 'node:assert/strict';

export const DECORATION_STYLE_KEYS = Object.freeze([
  'display',
  'visibility',
  'opacity',
  'color',
  'backgroundColor',
  'backgroundImage',
  'backgroundClip',
  'filter',
  'backdropFilter',
  'mixBlendMode',
  'isolation',
  'transform',
  'transformOrigin',
  'rotate',
  'scale',
  'translate',
  'perspective',
  'zoom',
  'position',
  'zIndex',
  'overflow',
  'overflowX',
  'overflowY',
  'clip',
  'clipPath',
  'maskImage',
  'boxShadow',
  'boxSizing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontStretch',
  'fontVariant',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'fontOpticalSizing',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'textShadow',
  'textDecoration',
  'textRendering',
  'whiteSpace',
  'direction',
  'writingMode',
  'animationName',
  'animationDuration',
  'animationPlayState',
  'transitionProperty',
  'transitionDuration',
  'content',
]);

/**
 * Read-only, screenshot-boundary evidence. Line boxes include transparent
 * spaces: this proves text/geometry identity, not exact glyph rasterization.
 * Keep this function self-contained because CDP serializes it into the page.
 */
export function readDecorationCaptureProofInPage() {
  const roots = ['#title-bar', '#cctv-source-badge'];
  const properties = [
    'display',
    'visibility',
    'opacity',
    'color',
    'backgroundColor',
    'backgroundImage',
    'backgroundClip',
    'filter',
    'backdropFilter',
    'mixBlendMode',
    'isolation',
    'transform',
    'transformOrigin',
    'rotate',
    'scale',
    'translate',
    'perspective',
    'zoom',
    'position',
    'zIndex',
    'overflow',
    'overflowX',
    'overflowY',
    'clip',
    'clipPath',
    'maskImage',
    'boxShadow',
    'boxSizing',
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderTopStyle',
    'borderRightStyle',
    'borderBottomStyle',
    'borderLeftStyle',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'fontStretch',
    'fontVariant',
    'fontFeatureSettings',
    'fontVariationSettings',
    'fontKerning',
    'fontOpticalSizing',
    'letterSpacing',
    'wordSpacing',
    'lineHeight',
    'textTransform',
    'textShadow',
    'textDecoration',
    'textRendering',
    'whiteSpace',
    'direction',
    'writingMode',
    'animationName',
    'animationDuration',
    'animationPlayState',
    'transitionProperty',
    'transitionDuration',
    'content',
  ];
  const rectValue = (rect) => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  const styles = (element, pseudo = null) => {
    const computed = getComputedStyle(element, pseudo);
    return Object.fromEntries(
      properties.map((key) => [key, computed[key] || '']),
    );
  };
  let overflow = false;
  const texts = [];
  const surfaces = [];
  const animationTargets = new Set();
  for (const selector of roots) {
    const root = document.querySelector(selector);
    if (!root?.isConnected)
      return { status: 'unavailable', reason: 'missing-root' };
    const ancestors = [];
    for (
      let element = root, depth = 0;
      element;
      element = element.parentElement, depth++
    ) {
      if (depth >= 16) {
        overflow = true;
        break;
      }
      animationTargets.add(element);
      ancestors.push({
        tag: element.tagName,
        id: element.id,
        className: element.className,
        rect: rectValue(element.getBoundingClientRect()),
        style: styles(element),
        before: styles(element, '::before'),
        after: styles(element, '::after'),
      });
    }
    surfaces.push({
      selector,
      attributes: [...root.attributes]
        .map((attribute) => [attribute.name, attribute.value])
        .sort((a, b) => a[0].localeCompare(b[0])),
      ancestors,
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || node.parentElement?.closest('svg,style,script'))
        continue;
      const parent = node.parentElement;
      const computed = getComputedStyle(parent);
      if (computed.display === 'none' || computed.visibility !== 'visible')
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (!rects.length) continue;
      if (texts.length >= 32 || rects.length > 8 || node.data.length > 512) {
        overflow = true;
        continue;
      }
      const segments = [];
      for (
        let element = parent;
        element !== root;
        element = element.parentElement
      ) {
        if (!element?.parentElement || segments.length >= 16) {
          overflow = true;
          break;
        }
        segments.unshift(
          `${element.tagName.toLowerCase()}:nth-child(${[...element.parentElement.children].indexOf(element) + 1})`,
        );
      }
      const parentSelector =
        selector + (segments.length ? ' > ' + segments.join(' > ') : '');
      texts.push({
        root: selector,
        parentSelector,
        textNodeIndex: [...parent.childNodes].indexOf(node),
        text: node.data,
        lang: parent.closest('[lang]')?.lang || '',
        rects: rects.map(rectValue),
        style: styles(parent),
        fontCheck: document.fonts.check(
          `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`,
          node.data,
        ),
      });
    }
  }
  const faces = [...document.fonts];
  if (faces.length > 32) overflow = true;
  const animations = document.getAnimations().filter((animation) => {
    const target = animation.effect?.target;
    return (
      animationTargets.has(target) ||
      roots.some((selector) =>
        document.querySelector(selector)?.contains(target),
      )
    );
  });
  const badge = document.querySelector('#cctv-source-badge');
  const badgeNodes = [...badge.childNodes];
  if (badgeNodes.length > 4) overflow = true;
  return {
    schema: 'gev-decoration-capture-proof/v1',
    status: overflow ? 'unavailable' : 'observed',
    overflow,
    dpr: devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    fontsStatus: document.fonts.status,
    faces: faces
      .slice(0, 32)
      .map((face) => ({
        family: face.family,
        style: face.style,
        weight: face.weight,
        stretch: face.stretch,
        status: face.status,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    activeAnimations: animations.filter((animation) =>
      ['running', 'pending'].includes(animation.playState),
    ).length,
    badgeContent: {
      childElementCount: badge.children.length,
      childNodes: badgeNodes.slice(0, 4).map((node) => ({
        nodeType: node.nodeType,
        text: node.nodeType === 3 ? node.data : null,
      })),
    },
    surfaces,
    texts,
  };
}

export function createDecorationSnapshotReader(reader) {
  return new Function(
    'args',
    `const result = (${reader.toString()})(args);
     return { ...result, decoration: result.phase === 0
       ? (${readDecorationCaptureProofInPage.toString()})() : null };`,
  );
}

/** Preserve failed eligibility inputs without retaining an unbounded payload. */
export function retainDecorationFailureEvidence(evidence) {
  if (!evidence?.before && !evidence?.after) return null;
  const envelope = {
    schema: 'gev-decoration-failure-evidence/v1',
    acceptanceEligible: false,
  };
  try {
    const serialized = JSON.stringify(evidence);
    if (Buffer.byteLength(serialized, 'utf8') > 512 * 1024)
      return { ...envelope, status: 'omitted-size-bound' };
    return {
      ...envelope,
      status: 'retained',
      evidence: JSON.parse(serialized),
    };
  } catch {
    return { ...envelope, status: 'unserializable' };
  }
}

/**
 * A separate owned CDP session queries the fonts actually used by each text
 * parent while the screenshot session is paused. Resolve nodes AFTER navigation
 * and on every read; node IDs are ownership data, never comparison inputs.
 */
export async function createDecorationFontReader(
  page,
  { timeoutMs = 5000 } = {},
) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000);
  const session = await page.createCDPSession();
  let disposed = false;
  const bounded = async (operation, label, limit = timeoutMs) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} deadline exceeded`)),
            limit,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const send = (method, args) => {
    assert.equal(disposed, false, 'Font reader already disposed');
    return bounded(() => session.send(method, args), method);
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const failures = [];
    for (const method of ['CSS.disable', 'DOM.disable']) {
      try {
        await bounded(
          () => session.send(method),
          method,
          Math.min(timeoutMs, 1000),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await bounded(
        () => session.detach(),
        'font-session-detach',
        Math.min(timeoutMs, 1000),
      );
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, 'Font reader cleanup failed');
  };
  try {
    await send('DOM.enable');
    await send('CSS.enable');
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
  return {
    dispose,
    async read(proof) {
      assert.equal(disposed, false, 'Font reader already disposed');
      assert.equal(proof?.status, 'observed');
      const selectors = [
        ...new Set(proof.texts.map((text) => text.parentSelector)),
      ].sort();
      assert.ok(selectors.length > 0 && selectors.length <= 32);
      const { root } = await send('DOM.getDocument', { depth: 0 });
      const result = [];
      for (const selector of selectors) {
        const { nodeId } = await send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector,
        });
        assert.ok(
          Number.isSafeInteger(nodeId) && nodeId > 0,
          'Font node unavailable',
        );
        const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(
          Array.isArray(fonts) && fonts.length > 0 && fonts.length <= 16,
          'Actual platform fonts unavailable',
        );
        const normalized = fonts
          .map((font) => {
            assert.ok(
              typeof font.familyName === 'string' &&
                font.familyName.length > 0 &&
                font.familyName.length <= 200,
            );
            assert.ok(
              typeof font.postScriptName === 'string' &&
                font.postScriptName.length > 0 &&
                font.postScriptName.length <= 200,
            );
            assert.equal(typeof font.isCustomFont, 'boolean');
            assert.ok(
              Number.isSafeInteger(font.glyphCount) && font.glyphCount > 0,
            );
            return {
              familyName: font.familyName,
              postScriptName: font.postScriptName,
              isCustomFont: font.isCustomFont,
              glyphCount: font.glyphCount,
            };
          })
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        result.push({ selector, fonts: normalized });
      }
      assert.equal(disposed, false, 'Font reader was disposed during read');
      return result;
    },
  };
}
