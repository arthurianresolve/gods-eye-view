import assert from 'node:assert/strict';

/** Read the actual header/inline-SVG paint inputs without changing the page. */
export function readVisualPaintSignatureInPage() {
  const title = document.getElementById('title-bar');
  const logo = title?.querySelector('[data-logo-gaze]');
  const svg = logo?.querySelector('svg');
  const elements = title ? [title, ...title.querySelectorAll('*')] : [];
  const properties = [
    'color',
    'backgroundColor',
    'backgroundImage',
    'opacity',
    'filter',
    'backdropFilter',
    'mixBlendMode',
    'isolation',
    'transform',
    'transformOrigin',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'textShadow',
    'fill',
    'fillRule',
    'stroke',
    'strokeWidth',
    'strokeLinecap',
    'strokeLinejoin',
    'fillOpacity',
    'strokeOpacity',
    'display',
    'visibility',
    'content',
    'animationName',
    'animationDuration',
    'animationDelay',
    'animationPlayState',
    'transitionProperty',
    'transitionDuration',
    'transitionDelay',
  ];
  const style = (element, pseudo = null) => {
    const computed = getComputedStyle(element, pseudo);
    return Object.fromEntries(
      properties.map((name) => [name, computed[name] || '']),
    );
  };
  const animations = document.getAnimations?.().filter((animation) => {
    const target = animation.effect?.target;
    return target && (target === title || title?.contains(target));
  });
  const markup = svg?.outerHTML ?? null;
  const overflow = elements.length > 64 || (markup?.length ?? 0) > 65_536;
  return {
    schema: 'gev-visual-paint-inputs/v1',
    status:
      title && logo && svg && !overflow && Array.isArray(animations)
        ? 'observed'
        : 'unavailable',
    fontsLoaded: document.fonts?.status === 'loaded',
    dpr: window.devicePixelRatio,
    overflow,
    radioBroadcasting: title?.classList.contains('radio-broadcasting') === true,
    activeAnimations:
      animations?.filter(
        (animation) =>
          animation.playState === 'running' ||
          animation.playState === 'pending',
      ).length ?? null,
    // The radio waves belong to .title-logo, not #title-bar.
    logoPseudo: logo
      ? { before: style(logo, '::before'), after: style(logo, '::after') }
      : null,
    svgMarkup: overflow ? null : markup,
    elements: elements.slice(0, 64).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        id: element.id || '',
        text: element.children.length ? null : element.textContent,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: style(element),
      };
    }),
  };
}

export function createVisualPaintSnapshotReader(phaseReader) {
  return new Function(
    'args',
    `return { ...(${phaseReader.toString()})(args), paint: (${readVisualPaintSignatureInPage.toString()})() };`,
  );
}

export function assertVisualPaintSignature(signature) {
  assert.equal(signature?.schema, 'gev-visual-paint-inputs/v1');
  assert.equal(signature.status, 'observed', 'Paint inputs unavailable');
  assert.equal(signature.overflow, false, 'Paint inputs truncated');
  assert.equal(signature.fontsLoaded, true, 'Fonts not loaded');
  assert.equal(signature.radioBroadcasting, false, 'Radio animation active');
  assert.equal(signature.activeAnimations, 0, 'Header animation active');
  assert.ok(Number.isFinite(signature.dpr) && signature.dpr > 0);
  assert.ok(
    typeof signature.svgMarkup === 'string' && signature.svgMarkup.length > 0,
  );
  assert.ok(signature.svgMarkup.length <= 65_536);
  assert.ok(
    Array.isArray(signature.elements) &&
      signature.elements.length > 0 &&
      signature.elements.length <= 64,
  );
  assert.ok(signature.logoPseudo?.before && signature.logoPseudo?.after);
  assert.ok(
    JSON.stringify(signature).length <= 262_144,
    'Paint signature exceeds bound',
  );
}
