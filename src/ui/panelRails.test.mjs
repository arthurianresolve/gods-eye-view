import { readStylesheet } from '../testSupport/readStylesheet.mjs';
import { displayPanelScroller } from './displayPanelScroll.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layoutLeftPanelRail,
  layoutRightPanelRail,
  layoutPanelRails,
  measurePanelNaturalHeight,
} from './panelRails.js';

test('Display uses an inner scroll body only in Cyber', () => {
  const body = { scrollTop: 95 };
  const panel = {
    ownerDocument: { documentElement: { dataset: { uiTheme: 'cyber' } } },
    querySelector: () => body,
  };
  assert.equal(displayPanelScroller(panel), body);
  panel.ownerDocument.documentElement.dataset.uiTheme = 'tactical';
  assert.equal(displayPanelScroller(panel), panel);
  assert.equal(displayPanelScroller(null), null);
});

test('Cyber restores one expanded owner, keeps launchers, and restores other theme preferences', () => {
  for (const mobile of [false, true]) {
    const f = fixture('right', {
      mobile,
      hud: { visible: true, variant: 'cyber' },
    });
    f.expand(f.first, 250);
    f.expand(f.second, 250);
    f.options.preferredPanelId = f.second.id;
    f.run();
    assert.equal(f.first.classList.contains('cyber-accordion-collapsed'), true);
    assert.equal(f.second.classList.contains('collapsed'), false);
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
    f.run();
    assert.equal(
      f.first.classList.contains('collapsed'),
      true,
      'layout does not reopen a peer',
    );
    f.options.hud.variant = 'operator';
    f.run();
    assert.equal(f.first.classList.contains('collapsed'), false);
    assert.equal(
      f.first.classList.contains('cyber-accordion-collapsed'),
      false,
    );
    assert.equal(f.second.classList.contains('collapsed'), false);
  }
});

test('Cyber restored accordion prefers keyboard focus when no explicit owner exists', () => {
  const f = fixture('right', { hud: { visible: true, variant: 'cyber' } });
  f.expand(f.first, 250);
  f.expand(f.second, 250);
  f.options.documentRef.activeElement = f.second;
  f.run();
  assert.equal(f.first.classList.contains('collapsed'), true);
  assert.equal(f.second.classList.contains('collapsed'), false);
});

function element(
  id,
  { height = 42, top = 234, left = 20, width = 272, collapsed = false } = {},
) {
  const classes = new Set(collapsed ? ['collapsed'] : []);
  const properties = new Map();
  const attributes = new Map();
  const writes = [];
  const datasetWrites = [];
  const attributeWrites = [];
  const node = {
    id,
    children: [],
    dataset: new Proxy(
      {},
      {
        set(target, key, value) {
          datasetWrites.push([key, value]);
          return Reflect.set(target, key, value);
        },
      },
    ),
    parentElement: null,
    scrollHeight: height,
    clientHeight: height,
    scrollTop: 0,
    computed: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      rowGap: '12px',
    },
    rect: {
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
    },
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, value) {
        if (value) classes.add(name);
        else classes.delete(name);
      },
    },
    style: {
      setProperty(name, value) {
        writes.push(['set', name, value]);
        properties.set(name, value);
      },
      getPropertyValue: (name) => properties.get(name) || '',
      removeProperty(name) {
        writes.push(['remove', name]);
        properties.delete(name);
      },
    },
    getBoundingClientRect() {
      return this.rect;
    },
    matches: (selector) => selector === '[data-panel-id]',
    contains(target) {
      return (
        target === this || this.children.some((child) => child.contains(target))
      );
    },
    querySelectorAll() {
      return this.children;
    },
    setAttribute(name, value) {
      attributeWrites.push(['set', name, value]);
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributeWrites.push(['remove', name]);
      attributes.delete(name);
    },
    getAttribute: (name) =>
      name === 'style'
        ? JSON.stringify([...properties])
        : name === 'class'
          ? [...classes].join(' ')
          : attributes.get(name),
    writes,
    datasetWrites,
    attributeWrites,
  };
  return node;
}
function fixture(
  side,
  { mobile = false, hud = { visible: true, variant: 'tactical' } } = {},
) {
  const first = element('first', { height: 42, collapsed: true });
  const second = element('second', { height: 42, collapsed: true });
  const stack = element('rail', {
    height: 96,
    left: side === 'left' ? 20 : 1100,
  });
  stack.children = [first, second];
  first.parentElement = second.parentElement = stack;
  const documentRef = { activeElement: null };
  stack.ownerDocument = documentRef;
  const collapsed = [];
  let retries = 0,
    aligned = 0;
  const options = {
    stack,
    hud,
    documentRef,
    obstacles: [],
    collapsedHeights: new Map(),
    windowRef: {
      innerHeight: 900,
      matchMedia: () => ({ matches: mobile }),
      getComputedStyle: (node) => node.computed,
    },
    onCollapse: (panel) => collapsed.push(panel.id),
    onRetry: () => {
      retries += 1;
    },
    onAligned: () => {
      aligned += 1;
    },
    displayPanel: null,
    readDisplayScrollTop: () => 0,
    leftStack: element('left'),
  };
  const run = () =>
    (side === 'left' ? layoutLeftPanelRail : layoutRightPanelRail)(options);
  const expand = (panel, height) => {
    panel.classList.remove('collapsed');
    panel.scrollHeight = height;
    panel.rect.height = height;
    panel.rect.bottom = panel.rect.top + height;
  };
  return {
    options,
    first,
    second,
    stack,
    run,
    expand,
    collapsed,
    retries: () => retries,
    aligned: () => aligned,
  };
}

function pairedFixture() {
  const left = fixture('left');
  const right = fixture('right');
  left.expand(left.first, 200);
  right.expand(right.first, 220);
  right.options.leftStack = left.stack;
  left.run();
  right.run();
  // The controller already owns the pending right pass; no caller callback is
  // needed for alignment. A custom callback is separately tested as invalid.
  left.options.onAligned = undefined;
  return {
    left,
    right,
    run: () =>
      layoutPanelRails({
        left: left.options,
        readRight: () => right.options,
      }),
  };
}

function railSnapshot(f) {
  return [f.stack, f.first, f.second].map((node) => ({
    dataset: { ...node.dataset },
    style: node.getAttribute('style'),
    classes: node.getAttribute('class'),
    ariaHidden: node.getAttribute('aria-hidden'),
    scrollTop: node.scrollTop,
  }));
}

test('paired intrinsic reads match sequential allocation even when the left corridor changes', () => {
  const paired = pairedFixture();
  const sequential = pairedFixture();
  for (const f of [paired, sequential]) {
    f.left.expand(f.left.first, 350);
    f.left.stack.style.setProperty('--left-stack-safe-top', '0vh');
  }
  const phases = [];
  for (const [name, f] of [
    ['left', paired.left],
    ['right', paired.right],
  ]) {
    const set = f.stack.setAttribute;
    const remove = f.stack.removeAttribute;
    f.stack.setAttribute = (key, value) => {
      if (key === 'data-rail-measuring') phases.push(`${name}:enter`);
      return set(key, value);
    };
    f.stack.removeAttribute = (key) => {
      if (key === 'data-rail-measuring') phases.push(`${name}:leave`);
      return remove(key);
    };
  }
  Object.defineProperty(paired.left.first, 'scrollHeight', {
    get() {
      assert.equal(paired.left.stack.getAttribute('data-rail-measuring'), '');
      assert.equal(paired.right.stack.getAttribute('data-rail-measuring'), '');
      phases.push('left:read');
      return 350;
    },
  });
  const read = paired.right.first.getBoundingClientRect.bind(
    paired.right.first,
  );
  paired.right.first.getBoundingClientRect = () => {
    if (paired.right.stack.getAttribute('data-rail-measuring') === '') {
      assert.equal(paired.left.stack.getAttribute('data-rail-measuring'), '');
      phases.push('right:read');
    }
    return read();
  };
  paired.run();
  sequential.left.options.onAligned = () => {};
  sequential.left.run();
  sequential.right.run();
  assert.deepEqual(railSnapshot(paired.left), railSnapshot(sequential.left));
  assert.deepEqual(railSnapshot(paired.right), railSnapshot(sequential.right));
  assert.deepEqual(
    phases,
    [
      'left:enter',
      'right:enter',
      'left:read',
      'right:read',
      'left:leave',
      'right:leave',
    ],
    'one shared override/read phase; this is not a browser flush count',
  );
});

for (const callback of ['onAligned', 'onCollapse', 'onRetry']) {
  test(`paired pass falls back after left ${callback} mutates right width/content`, () => {
    const f = pairedFixture();
    let calls = 0;
    let reads = 0;
    const read = f.right.first.getBoundingClientRect.bind(f.right.first);
    f.right.first.getBoundingClientRect = () => {
      if (f.right.stack.getAttribute('data-rail-measuring') === '') reads++;
      return read();
    };
    f.left.options[callback] = () => {
      calls++;
      f.right.stack.style.setProperty('width', '310px');
      f.right.expand(f.right.first, 310);
    };
    if (callback === 'onAligned')
      f.left.stack.style.setProperty('--left-stack-safe-top', '0vh');
    else {
      f.left.expand(f.left.first, 800);
      f.left.expand(f.left.second, 800);
    }
    f.run();
    assert.equal(calls, 1);
    assert.equal(reads, 2);
    assert.equal(
      f.right.first.style.getPropertyValue('--right-panel-allocated-height'),
      '310.0px',
    );
  });
}

test('changed placement and replacement participants use the original right measurement', () => {
  const f = pairedFixture();
  const replacement = element('replacement', { height: 310 });
  layoutPanelRails({
    left: f.left.options,
    readRight: () => f.right.options,
    syncRightPlacement() {
      f.right.first.hidden = true;
      replacement.parentElement = f.right.stack;
      f.right.stack.children.push(replacement);
      return false;
    },
  });
  assert.equal(
    replacement.style.getPropertyValue('--right-panel-allocated-height'),
    '310.0px',
  );
  assert.equal(f.right.stack.dataset.expandedCount, '1');
});

for (const change of ['width-style', 'participant', 'viewport']) {
  test(`late right ${change} input change discards the single-use snapshot`, () => {
    const f = pairedFixture();
    let preparations = 0;
    let rightLifts = 0;
    const set = f.right.stack.setAttribute;
    f.right.stack.setAttribute = (key, value) => {
      if (key === 'data-rail-measuring') rightLifts++;
      return set(key, value);
    };
    layoutPanelRails({
      left: f.left.options,
      readRight() {
        if (++preparations === 2) {
          if (change === 'width-style')
            f.right.stack.style.setProperty('width', '300px');
          if (change === 'participant') f.right.first.hidden = true;
          if (change === 'viewport')
            f.right.options.windowRef.innerHeight = 850;
        }
        return f.right.options;
      },
    });
    assert.equal(rightLifts, 2);
  });
}

for (const kind of [
  'mobile',
  'cyber',
  'auto-collapse',
  'exclusive-change',
  'expanded-aria',
  'collapsed-aria',
]) {
  test(`paired pass does not premeasure right ${kind} reconciliation`, () => {
    const f = pairedFixture();
    if (kind === 'mobile')
      f.right.options.windowRef.matchMedia = () => ({ matches: true });
    if (kind === 'cyber')
      f.right.options.hud = { visible: true, variant: 'cyber' };
    if (kind === 'auto-collapse')
      f.right.first.classList.add('collapsed', 'layout-auto-collapsed');
    if (kind === 'exclusive-change')
      f.right.stack.classList.remove('layout-exclusive');
    if (kind === 'expanded-aria') {
      f.right.first.setAttribute('aria-hidden', 'true');
      // Model a restored ARIA-dependent hide: measuring before normalization
      // would incorrectly retain a zero intrinsic height.
      const rect = f.right.first.getBoundingClientRect.bind(f.right.first);
      f.right.first.getBoundingClientRect = () =>
        f.right.first.getAttribute('aria-hidden') === 'true'
          ? { ...rect(), height: 0 }
          : rect();
      Object.defineProperty(f.right.first, 'scrollHeight', {
        get: () =>
          f.right.first.getAttribute('aria-hidden') === 'true' ? 0 : 220,
      });
    }
    if (kind === 'collapsed-aria')
      f.right.second.removeAttribute('aria-hidden');
    const set = f.right.stack.setAttribute;
    f.right.stack.setAttribute = (key, value) => {
      if (key === 'data-rail-measuring')
        assert.equal(
          f.left.stack.getAttribute('data-rail-measuring'),
          undefined,
        );
      return set(key, value);
    };
    f.run();
    if (kind === 'expanded-aria') {
      assert.equal(f.right.first.getAttribute('aria-hidden'), undefined);
      assert.equal(
        f.right.first.style.getPropertyValue('--right-panel-allocated-height'),
        '220.0px',
      );
    }
    if (kind === 'collapsed-aria')
      assert.equal(f.right.second.getAttribute('aria-hidden'), 'true');
  });
}

for (const side of ['left', 'right']) {
  test(`paired ${side} measurement failure restores both overrides and right scroll`, () => {
    const f = pairedFixture();
    f.right.first.scrollTop = 31;
    const set = f.right.stack.setAttribute;
    f.right.stack.setAttribute = (key, value) => {
      const result = set(key, value);
      if (key === 'data-rail-measuring') f.right.first.scrollTop = 0;
      return result;
    };
    if (side === 'left') {
      Object.defineProperty(f.left.first, 'scrollHeight', {
        get() {
          throw new Error('intrinsic failed');
        },
      });
    } else {
      f.right.first.getBoundingClientRect = () => {
        throw new Error('intrinsic failed');
      };
    }
    assert.throws(f.run, /intrinsic failed/);
    assert.equal(f.left.stack.getAttribute('data-rail-measuring'), undefined);
    assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
    assert.equal(f.right.first.scrollTop, 31);
  });
}

test('paired restoration releases right override even if left removal throws', () => {
  const f = pairedFixture();
  const remove = f.left.stack.removeAttribute;
  f.left.stack.removeAttribute = (key) => {
    remove(key);
    if (key === 'data-rail-measuring') throw new Error('release failed');
  };
  assert.throws(f.run, /release failed/);
  assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
});

test('failed right override entry restores both markers and every remaining scroll owner', () => {
  const f = pairedFixture();
  f.right.first.scrollTop = 31;
  f.right.second.scrollTop = 47;
  const set = f.right.stack.setAttribute;
  f.right.stack.setAttribute = (key, value) => {
    const result = set(key, value);
    if (key === 'data-rail-measuring') {
      f.right.first.scrollTop = f.right.second.scrollTop = 0;
      throw new Error('entry failed');
    }
    return result;
  };
  assert.throws(f.run, /entry failed/);
  assert.equal(f.left.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(f.right.first.scrollTop, 31);
  assert.equal(f.right.second.scrollTop, 47);
});

test('one throwing scroll restore does not strand another scroll owner', () => {
  const f = pairedFixture();
  let top = 31;
  Object.defineProperty(f.right.first, 'scrollTop', {
    get: () => top,
    set(value) {
      if (value === 31) throw new Error('scroll restore failed');
      top = value;
    },
  });
  f.right.second.scrollTop = 47;
  const set = f.right.stack.setAttribute;
  f.right.stack.setAttribute = (key, value) => {
    const result = set(key, value);
    if (key === 'data-rail-measuring')
      f.right.first.scrollTop = f.right.second.scrollTop = 0;
    return result;
  };
  assert.throws(f.run, /scroll restore failed/);
  assert.equal(f.left.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(f.right.second.scrollTop, 47);
});

test('right geometry, scroll getter and final constrained clamp remain after left apply', () => {
  const f = pairedFixture();
  f.right.options.displayPanel = f.right.first;
  f.right.first.scrollHeight = 400;
  f.right.first.clientHeight = 350;
  let applied = false;
  const toggle = f.left.stack.classList.toggle;
  f.left.stack.classList.toggle = (...args) => {
    applied = true;
    return toggle(...args);
  };
  const rightRect = f.right.stack.getBoundingClientRect.bind(f.right.stack);
  f.right.stack.getBoundingClientRect = () => {
    assert.equal(applied, true);
    assert.equal(f.left.stack.getAttribute('data-rail-measuring'), undefined);
    assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
    return rightRect();
  };
  f.right.options.readDisplayScrollTop = () => {
    assert.equal(applied, true);
    return 80;
  };
  f.run();
  assert.equal(f.right.first.scrollTop, 50);
});

test('throwing right scroll getter leaves the completed shared transaction restored', () => {
  const f = pairedFixture();
  f.right.options.readDisplayScrollTop = () => {
    throw new Error('scroll reader failed');
  };
  assert.throws(f.run, /scroll reader failed/);
  assert.equal(f.left.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(f.right.stack.getAttribute('data-rail-measuring'), undefined);
});

test('missing rails are inert without browser globals', () => {
  layoutLeftPanelRail({});
  layoutRightPanelRail({});
});

test('left layout records collapsed heights and aligns the right rail without changing disclosure', () => {
  const f = fixture('left');
  f.run();
  assert.equal(f.options.collapsedHeights.get('first'), 42);
  assert.equal(f.first.classList.contains('collapsed'), true);
  assert.equal(f.aligned(), 1);
  assert.equal(f.retries(), 0);
  assert.equal(f.stack.dataset.layoutMode, 'normal');
});

test('left alignment initializes restored coordinates and only wakes the right rail after corridor changes', () => {
  const f = fixture('left');
  f.stack.style.setProperty('--left-stack-safe-top', '26.000vh');
  f.stack.style.setProperty('--left-stack-safe-bottom', '26.000vh');
  f.stack.writes.length = 0;
  f.run();
  assert.equal(f.aligned(), 1, 'initialization still aligns the other rail');
  assert.deepEqual(f.stack.writes, []);
  f.run();
  assert.equal(
    f.aligned(),
    1,
    'equivalent content must not enqueue another right pass',
  );
  f.options.obstacles = [element('lower', { top: 600, height: 80 })];
  f.run();
  assert.equal(f.aligned(), 2);
  assert.equal(
    f.stack.style.getPropertyValue('--left-stack-safe-top'),
    '34.533vh',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--left-stack-safe-bottom'),
    '34.533vh',
  );
});

test('left intrinsic measurement preserves stored allocations and always releases its CSS override', () => {
  const f = fixture('left');
  f.expand(f.first, 200);
  f.first.style.setProperty('--left-panel-allocated-height', '60px');
  let measured = 0;
  Object.defineProperty(f.first, 'scrollHeight', {
    get() {
      assert.equal(f.stack.getAttribute('data-rail-measuring'), '');
      assert.equal(
        f.first.style.getPropertyValue('--left-panel-allocated-height'),
        '60px',
      );
      measured++;
      return 200;
    },
  });
  f.first.writes.length = 0;
  f.run();
  assert.equal(measured, 1);
  assert.equal(f.stack.getAttribute('data-rail-measuring'), undefined);
  assert.deepEqual(f.first.writes, [
    ['set', '--left-panel-allocated-height', '200.0px'],
  ]);

  const failed = fixture('left');
  failed.expand(failed.first, 200);
  failed.first.style.setProperty('--left-panel-allocated-height', '60px');
  Object.defineProperty(failed.first, 'scrollHeight', {
    get() {
      throw new Error('intrinsic measurement failed');
    },
  });
  assert.throws(() => failed.run(), /intrinsic measurement failed/);
  assert.equal(failed.stack.getAttribute('data-rail-measuring'), undefined);
  assert.equal(
    failed.first.style.getPropertyValue('--left-panel-allocated-height'),
    '60px',
  );
});

for (const side of ['left', 'right']) {
  test(`${side} intrinsic pass snapshots invariant geometry before lifting allocations`, () => {
    const f = fixture(side, { hud: { visible: true, variant: 'operator' } });
    f.expand(f.first, 200);
    let phase = 'constrained';
    const reads = [];
    const setAttribute = f.stack.setAttribute;
    const removeAttribute = f.stack.removeAttribute;
    f.stack.setAttribute = (name, value) => {
      if (name === 'data-rail-measuring') phase = 'measuring';
      setAttribute(name, value);
    };
    f.stack.removeAttribute = (name) => {
      removeAttribute(name);
      if (name === 'data-rail-measuring') phase = 'restored';
    };
    Object.defineProperty(f.stack.computed, 'rowGap', {
      get() {
        reads.push(['gap', phase]);
        assert.equal(
          phase,
          'constrained',
          'gap read would flush restored layout',
        );
        return '12px';
      },
    });
    const collapsedRect = f.second.getBoundingClientRect.bind(f.second);
    f.second.getBoundingClientRect = () => {
      reads.push(['collapsed', phase]);
      assert.notEqual(
        phase,
        'restored',
        'collapsed read would flush restored layout',
      );
      return collapsedRect();
    };
    if (side === 'left') {
      // Exercise the original rect fallback as well as the first cache read.
      f.options.collapsedHeights.get = () => undefined;
    }
    f.run();
    assert.equal(phase, 'restored');
    assert.equal(reads.filter(([kind]) => kind === 'gap').length, 1);
    assert.equal(f.first.classList.contains('collapsed'), false);
    assert.equal(f.second.classList.contains('collapsed'), true);
    assert.equal(
      f.first.style.getPropertyValue(`--${side}-panel-allocated-height`),
      '200.0px',
    );
    if (side === 'left') {
      assert.equal(f.stack.dataset.layoutMode, 'tail');
      assert.equal(
        f.stack.style.getPropertyValue('--left-stack-safe-top'),
        '26.000vh',
      );
      assert.equal(
        f.stack.style.getPropertyValue('--left-stack-safe-bottom'),
        '45.778vh',
      );
      assert.equal(f.stack.dataset.requiredHeightPct, '28.22');
      assert.equal(reads.filter(([kind]) => kind === 'collapsed').length, 2);
    } else {
      assert.equal(f.stack.dataset.layoutMode, 'normal');
      assert.equal(
        f.stack.style.getPropertyValue('--right-stack-safe-top'),
        '234.0px',
      );
      assert.equal(
        f.stack.style.getPropertyValue('--right-stack-max-height'),
        '630.0px',
      );
      assert.equal(f.stack.dataset.requiredHeight, '254.0');
    }
  });
}

test('left premeasurement sibling snapshot preserves hidden cache and zero fallbacks', () => {
  for (const cached of [undefined, 0, 37]) {
    const f = fixture('left', { hud: { visible: true, variant: 'operator' } });
    f.expand(f.first, 200);
    f.second.rect.height = 0;
    if (cached !== undefined)
      f.options.collapsedHeights.set(f.second.id, cached);
    f.run();
    assert.equal(f.options.collapsedHeights.get(f.second.id), cached);
    assert.equal(
      f.first.style.getPropertyValue('--left-panel-allocated-height'),
      '200.0px',
    );
    assert.equal(
      f.stack.dataset.requiredHeightPct,
      (((200 + (cached || 0) + 12) / 900) * 100).toFixed(2),
    );
    assert.equal(
      f.stack.style.getPropertyValue('--left-stack-safe-bottom'),
      (((900 - 234 - 200 - (cached || 0) - 12) / 900) * 100).toFixed(3) + 'vh',
    );
    assert.equal(f.second.classList.contains('collapsed'), true);
  }
});

test('intrinsic CSS overrides preserve row gaps and left collapsed sibling geometry', () => {
  const css = readStylesheet(
    new URL('../../style.css', import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, selector]) => selector.includes('[data-rail-measuring]'),
  );
  assert.ok(rules.length > 0);
  for (const [, selector, declarations] of rules) {
    const properties = declarations
      .split(';')
      .map((declaration) => declaration.split(':')[0].trim())
      .filter(Boolean);
    const allowed = selector.includes('#left-panel-stack')
      ? ['--left-panel-allocated-height']
      : [
          'height',
          'max-height',
          'transition',
          '--right-panel-allocated-height',
          'flex',
          'display',
        ];
    for (const property of properties)
      assert.ok(
        allowed.includes(property),
        `measurement can change snapshotted geometry: ${property}`,
      );
    if (selector.includes('#left-panel-stack'))
      assert.match(selector, /\[data-panel-id\]:not\(\.collapsed\)/);
  }
});

test('left content growth recomputes allocations inside an unchanged corridor and preserves disclosure geometry', () => {
  const f = fixture('left', { hud: { visible: true, variant: 'operator' } });
  const positions = [];
  const record = () => {
    f.run();
    positions.push({
      mode: f.stack.dataset.layoutMode,
      top: f.stack.style.getPropertyValue('--left-stack-safe-top'),
      bottom: f.stack.style.getPropertyValue('--left-stack-safe-bottom'),
      first: f.first.style.getPropertyValue('--left-panel-allocated-height'),
      second: f.second.style.getPropertyValue('--left-panel-allocated-height'),
    });
  };
  record();
  f.expand(f.first, 200);
  record();
  f.expand(f.first, 600);
  f.expand(f.second, 400);
  record();
  const alignedBeforeGrowth = f.aligned();
  f.expand(f.first, 700);
  record();
  assert.equal(f.aligned(), alignedBeforeGrowth);
  f.options.obstacles = [element('lower', { top: 600, height: 80 })];
  record();
  assert.equal(f.aligned(), alignedBeforeGrowth + 1);
  f.first.classList.add('collapsed');
  f.second.classList.add('collapsed');
  f.first.rect.height = f.first.scrollHeight = 42;
  f.second.rect.height = f.second.scrollHeight = 42;
  record();
  // These coordinates and allocations are the original layout's six states.
  assert.deepEqual(positions, [
    {
      mode: 'normal',
      top: '26.000vh',
      bottom: '26.000vh',
      first: '',
      second: '',
    },
    {
      mode: 'tail',
      top: '26.000vh',
      bottom: '45.778vh',
      first: '200.0px',
      second: '',
    },
    {
      mode: 'focus',
      top: '4.000vh',
      bottom: '4.000vh',
      first: '485.2px',
      second: '330.8px',
    },
    {
      mode: 'focus',
      top: '4.000vh',
      bottom: '4.000vh',
      first: '511.1px',
      second: '304.9px',
    },
    {
      mode: 'focus',
      top: '4.000vh',
      bottom: '34.533vh',
      first: '328.3px',
      second: '212.9px',
    },
    {
      mode: 'normal',
      top: '34.533vh',
      bottom: '34.533vh',
      first: '',
      second: '',
    },
  ]);
});

for (const side of ['left', 'right']) {
  for (const mobile of [false, true]) {
    test(`${side} equivalent ${mobile ? 'mobile' : 'desktop'} passes retain allocations and metadata without redundant writes`, () => {
      const f = fixture(side, { mobile });
      f.expand(f.first, 200);
      f.run();
      const nodes = [f.stack, f.first, f.second];
      const allocation = f.first.style.getPropertyValue(
        `--${side}-panel-allocated-height`,
      );
      for (const node of nodes) {
        node.writes.length = 0;
        node.datasetWrites.length = 0;
        node.attributeWrites.length = 0;
      }
      const aligned = f.aligned();
      for (let pass = 0; pass < 4; pass++) f.run();
      assert.deepEqual(
        nodes.flatMap((node) => node.writes),
        [],
      );
      assert.deepEqual(f.stack.datasetWrites, []);
      assert.deepEqual(
        nodes.flatMap((node) =>
          node.attributeWrites.filter(([, name]) => name === 'aria-hidden'),
        ),
        [],
      );
      assert.equal(
        f.first.style.getPropertyValue(`--${side}-panel-allocated-height`),
        allocation,
      );
      assert.equal(f.aligned(), aligned);
    });
  }

  test(`${side} metadata repairs live DOM corruption and follows disclosure and mobile changes`, () => {
    const f = fixture(side);
    f.expand(f.first, 200);
    f.run();
    const expected = { ...f.stack.dataset };
    assert.equal(Object.keys(expected).length, side === 'left' ? 7 : 6);
    for (const key of Object.keys(expected)) f.stack.dataset[key] = 'external';
    delete f.stack.dataset.expandedCount;
    f.stack.datasetWrites.length = 0;
    f.run();
    assert.deepEqual({ ...f.stack.dataset }, expected);
    assert.equal(f.stack.datasetWrites.length, Object.keys(expected).length);
    f.stack.datasetWrites.length = 0;
    f.run();
    assert.deepEqual(f.stack.datasetWrites, []);

    f.first.classList.add('collapsed');
    f.first.rect.height = f.first.scrollHeight = 42;
    f.run();
    assert.equal(f.stack.dataset.expandedCount, '0');
    assert.equal(f.stack.dataset.layoutMode, 'normal');
    assert.ok(f.stack.datasetWrites.length > 0);
    f.options.windowRef.matchMedia = () => ({ matches: true });
    f.run();
    assert.equal(f.stack.dataset.layoutMode, 'mobile');
    f.stack.dataset.layoutMode = 'external';
    f.stack.datasetWrites.length = 0;
    f.run();
    assert.deepEqual(f.stack.datasetWrites, [['layoutMode', 'mobile']]);
    f.stack.datasetWrites.length = 0;
    f.run();
    assert.deepEqual(f.stack.datasetWrites, []);
    f.options.windowRef.matchMedia = () => ({ matches: false });
    f.run();
    assert.equal(f.stack.dataset.layoutMode, 'normal');
  });

  test(`${side} aria-hidden repairs external values and changes with the live layout`, () => {
    const f = fixture(side);
    f.expand(f.first, side === 'left' ? 900 : 200);
    f.run();
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
    assert.equal(f.second.getAttribute('aria-hidden'), 'true');
    f.first.setAttribute('aria-hidden', 'true');
    f.second.setAttribute('aria-hidden', 'false');
    for (const panel of [f.first, f.second]) panel.attributeWrites.length = 0;
    f.run();
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
    assert.equal(f.second.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(f.first.attributeWrites, [['remove', 'aria-hidden']]);
    assert.deepEqual(f.second.attributeWrites, [
      ['set', 'aria-hidden', 'true'],
    ]);
    for (const panel of [f.first, f.second]) panel.attributeWrites.length = 0;
    f.run();
    assert.deepEqual(f.first.attributeWrites, []);
    assert.deepEqual(f.second.attributeWrites, []);

    f.first.classList.add('collapsed');
    f.first.rect.height = f.first.scrollHeight = 42;
    f.run();
    assert.equal(f.second.getAttribute('aria-hidden'), undefined);
    assert.deepEqual(f.second.attributeWrites, [['remove', 'aria-hidden']]);
  });
}

test('left corridor respects a lower obstacle but ignores an obstacle hidden by its parent', () => {
  const f = fixture('left');
  const blocker = element('blocker', { top: 600, height: 80 });
  const hidden = element('hidden', { top: 300, height: 80 });
  hidden.parentElement = element('hidden-parent');
  hidden.parentElement.computed.opacity = '0';
  f.options.obstacles = [blocker, hidden];
  f.run();
  assert.equal(Number(f.stack.dataset.safeBottomPct), 65.47);
});

for (const side of ['left', 'right']) {
  test(`${side} mobile layout releases desktop height/position styles and labels`, () => {
    const f = fixture(side, { mobile: true });
    f.stack.classList.add('layout-focus');
    f.stack.style.setProperty(`--${side}-stack-safe-top`, '300px');
    f.first.style.setProperty(`--${side}-panel-allocated-height`, '99px');
    f.first.setAttribute('aria-hidden', 'true');
    f.run();
    assert.equal(f.stack.dataset.layoutMode, 'mobile');
    assert.equal(
      f.stack.style.getPropertyValue(`--${side}-stack-safe-top`),
      '',
    );
    assert.equal(
      f.first.style.getPropertyValue(`--${side}-panel-allocated-height`),
      '',
    );
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
  });
  test(`${side} constrained layout preserves the preferred panel and requests another pass`, () => {
    const f = fixture(side);
    f.expand(f.first, 900);
    f.expand(f.second, 900);
    f.options.preferredPanelId = 'second';
    f.run();
    assert.equal(f.second.classList.contains('collapsed'), false);
    assert.equal(f.first.classList.contains('layout-auto-collapsed'), true);
    assert.deepEqual(f.collapsed, ['first']);
    assert.equal(f.retries(), 1);
  });
  test(`${side} hidden HUD restores automatic collapse without altering manual collapse`, () => {
    const f = fixture(side, { hud: { visible: false, variant: 'tactical' } });
    f.first.classList.add('layout-auto-collapsed');
    f.run();
    assert.equal(f.first.classList.contains('collapsed'), false);
    assert.equal(f.second.classList.contains('collapsed'), true);
    assert.deepEqual(f.collapsed, ['first']);
  });
}

test('right layout uses keyboard focus when there is no preferred panel', () => {
  const f = fixture('right');
  f.expand(f.first, 900);
  f.expand(f.second, 900);
  f.options.documentRef.activeElement = f.second;
  f.run();
  assert.equal(f.first.classList.contains('layout-auto-collapsed'), true);
  assert.equal(f.second.classList.contains('collapsed'), false);
});

for (const collapsed of [true, false]) {
  test(`right layout ignores a hidden ${collapsed ? 'collapsed' : 'expanded'} panel`, () => {
    const baseline = fixture('right');
    baseline.stack.children = [baseline.first];
    baseline.expand(baseline.first, 600);
    baseline.run();

    const f = fixture('right');
    f.expand(f.first, 600);
    f.second.id = 'weather-panel';
    f.second.hidden = true;
    if (!collapsed) f.expand(f.second, 900);
    f.options.preferredPanelId = 'weather-panel';
    f.run();

    assert.deepEqual(f.stack.dataset, baseline.stack.dataset);
    assert.equal(
      f.first.style.getPropertyValue('--right-panel-allocated-height'),
      baseline.first.style.getPropertyValue('--right-panel-allocated-height'),
    );
    assert.equal(f.second.classList.contains('collapsed'), collapsed);
    assert.deepEqual(f.second.writes, []);
    assert.deepEqual(f.collapsed, []);
    assert.equal(f.retries(), 0);
    assert.equal(f.stack.classList.contains('layout-focus'), false);
  });
}

test('right layout retains Display allocation during measurement and caps restored scroll', () => {
  const f = fixture('right');
  f.first.id = 'pp-toggles';
  f.expand(f.first, 900);
  f.first.clientHeight = 400;
  f.options.displayPanel = f.first;
  f.options.readDisplayScrollTop = () => 800;
  f.first.style.setProperty('--right-panel-allocated-height', '600px');
  f.first.writes.length = 0;
  f.run();
  assert.equal(f.first.scrollTop, 500);
  assert.equal(
    f.first.writes.some(
      ([op, name]) =>
        op === 'remove' && name === '--right-panel-allocated-height',
    ),
    false,
  );
  f.first.writes.length = 0;
  f.run();
  assert.equal(
    f.first.writes.some(
      ([, name]) => name === '--right-panel-allocated-height',
    ),
    false,
    'stable allocation must not churn the style attribute',
  );
});

test('right rail aligns to the current left rail and excludes hidden obstacles', () => {
  const f = fixture('right');
  f.options.leftStack.rect.top = 200;
  const hidden = element('hidden', { left: 1100, top: 100, height: 200 });
  hidden.computed.display = 'none';
  f.options.obstacles = [hidden];
  f.run();
  assert.equal(f.stack.dataset.safeTop, '200.0');
});

// The left rail's `top` animates after the right pass runs, and nothing
// re-runs it when the transition lands: the right rail must read the end value.
function animatingLeftRail({ keyframes = true } = {}) {
  const f = fixture('right');
  const left = f.options.leftStack;
  left.rect.top = 250;
  left.computed.top = '250px';
  left.dataset.safeTopPct = '29.60';
  left.getAnimations = () => [
    { transitionProperty: 'bottom', effect: null },
    {
      transitionProperty: 'top',
      effect: {
        getKeyframes: () =>
          keyframes ? [{ top: '234px' }, { top: '266.4px' }] : [],
      },
    },
  ];
  return f;
}

test('right rail aligns to where a mid-transition left rail settles', () => {
  const f = animatingLeftRail();
  f.run();
  assert.equal(f.stack.dataset.safeTop, '266.4');
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-safe-top'),
    '266.4px',
  );
});

test('right allocation stays stable when a fractional transition target settles to layout units', () => {
  const f = fixture('right');
  f.options.windowRef.innerHeight = 537;
  const left = f.options.leftStack;
  left.rect.top = 100;
  left.computed.top = '100px';
  left.getAnimations = () => [
    {
      transitionProperty: 'top',
      effect: { getKeyframes: () => [{ top: '100px' }, { top: '21.48px' }] },
    },
  ];
  f.run();
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-safe-top'),
    '21.5px',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-max-height'),
    '494.0px',
  );
  const styleWrites = f.stack.writes.length;
  const metadataWrites = f.stack.datasetWrites.length;

  left.rect.top = 21.46875;
  left.computed.top = '21.46875px';
  left.getAnimations = () => [];
  f.run();
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-max-height'),
    '494.0px',
  );
  assert.equal(f.stack.dataset.availableHeight, '494.0');
  assert.equal(
    f.stack.writes.length,
    styleWrites,
    'no allocation rewrite after settling',
  );
  assert.equal(
    f.stack.datasetWrites.length,
    metadataWrites,
    'no metadata churn after settling',
  );

  left.rect.top = 22.46875;
  f.run();
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-safe-top'),
    '22.5px',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-max-height'),
    '493.0px',
  );
  assert.ok(
    f.stack.writes.length > styleWrites,
    'real movement still updates allocation',
  );
});

test('right rail falls back to the committed left target when the transition end is unreadable', () => {
  const f = animatingLeftRail({ keyframes: false });
  f.run();
  assert.equal(f.stack.dataset.safeTop, '266.4');
});

test('right rail follows a settled left rail whose CSS overrides the committed target', () => {
  // Cyber pins the left rail with `top: ... !important`, so the committed
  // percentage is not where it renders and no `top` transition runs.
  const f = fixture('right', { hud: { visible: true, variant: 'cyber' } });
  f.options.leftStack.rect.top = 220;
  f.options.leftStack.dataset.safeTopPct = '26.00';
  f.options.leftStack.getAnimations = () => [];
  f.run();
  assert.equal(f.stack.dataset.safeTop, '220.0');
});

test('natural height includes visible content, margins and wrapper chrome, excluding hidden rows', () => {
  const panel = element('panel');
  const inner = element('inner', { top: 100 });
  inner.computed.paddingTop = '10px';
  inner.computed.paddingBottom = '5px';
  const row = element('row', { top: 110, height: 40 });
  row.scrollHeight = 80;
  row.computed.marginBottom = '3px';
  const hidden = element('hidden', { top: 1000, height: 900 });
  hidden.computed.visibility = 'hidden';
  panel.computed.borderTopWidth = '1px';
  panel.computed.borderBottomWidth = '1px';
  panel.children = [inner];
  inner.children = [row, hidden];
  assert.equal(
    measurePanelNaturalHeight(panel, (node) => node.computed),
    100,
  );
});

// Reproduce the allocation-dependent readings seen beside the weather card.
// Outside measurement, CCTV is 391 px in focus and 629 px in normal mode;
// Removing only the allocation leaves focus CSS active: its next reading is
// 422 px, so the old decision exits focus and then re-enters on the 629 px read.
function thrashingRightRail({ focused = false, weatherOpen = false } = {}) {
  const f = fixture('right');
  f.options.windowRef.innerHeight = 920;
  f.options.leftStack.rect.top = 439.6;
  f.stack.computed.rowGap = '8px';
  const display = element('pp-toggles', { collapsed: true });
  const cctv = element('cctv-panel', { height: 629 });
  const weather = element('weather-panel', {
    height: 444,
    collapsed: !weatherOpen,
  });
  const context = element('global-context-panel', { collapsed: true });
  if (!weatherOpen) weather.classList.add('layout-auto-collapsed');
  f.stack.children = [display, cctv, weather, context];
  f.stack.classList.toggle('layout-focus', focused);
  f.options.preferredPanelId = cctv.id;
  f.options.displayPanel = display;
  const allocation = '--right-panel-allocated-height';
  const measuring = () =>
    f.stack.getAttribute('data-rail-measuring') !== undefined;
  for (const panel of f.stack.children) {
    panel.parentElement = f.stack;
    panel.intrinsicHeight = panel.rect.height;
    panel.style.setProperty(allocation, '391px');
    panel.getBoundingClientRect = () => {
      let height;
      if (panel.classList.contains('collapsed')) {
        height =
          measuring() || f.stack.classList.contains('layout-focus') ? 44 : 0;
      } else if (measuring()) {
        height = panel.intrinsicHeight;
      } else if (f.stack.classList.contains('layout-focus')) {
        height = 391;
      } else {
        height = panel.intrinsicHeight;
      }
      return { ...panel.rect, height, bottom: panel.rect.top + height };
    };
    Object.defineProperty(panel, 'scrollHeight', {
      get: () => {
        if (measuring())
          return panel.classList.contains('collapsed')
            ? 44
            : panel.intrinsicHeight;
        if (panel.classList.contains('collapsed'))
          return panel.getBoundingClientRect().height;
        return f.stack.classList.contains('layout-focus') &&
          panel.style.getPropertyValue(allocation)
          ? 603
          : 422;
      },
    });
  }
  return { ...f, cctv, weather };
}

for (const focused of [false, true]) {
  test(`right rail settles mode-dependent CCTV and weather heights within two passes from ${focused ? 'focus' : 'normal'}`, () => {
    const f = thrashingRightRail({ focused });
    assert.equal(f.cctv.getBoundingClientRect().height, focused ? 391 : 629);
    assert.equal(f.weather.getBoundingClientRect().height, focused ? 44 : 0);
    const modes = [];
    const needs = [];
    for (let pass = 0; pass < 10; pass++) {
      f.run();
      modes.push(f.stack.classList.contains('layout-focus'));
      needs.push(f.stack.dataset.requiredHeight);
      assert.equal(f.stack.dataset.availableHeight, '443.6');
      assert.equal(f.stack.getAttribute('data-rail-measuring'), undefined);
    }
    assert.deepEqual(modes.slice(1), Array(9).fill(true));
    assert.deepEqual(needs, Array(10).fill('681.0'));
    assert.equal(f.retries(), 0);
    assert.equal(f.cctv.writes.filter(([op]) => op === 'remove').length, 0);
  });
}

test('right rail keeps focus through 30 px content growth inside the hysteresis band', () => {
  const f = thrashingRightRail();
  f.run();
  // Header + gap contribute 52 px: need moves 420 -> 450 -> 420.
  for (const height of [368, 398, 368, 398, 368]) {
    f.cctv.intrinsicHeight = height;
    f.run();
    assert.equal(f.stack.classList.contains('layout-focus'), true);
  }
  f.cctv.intrinsicHeight = 335; // Need 387 < 443.6 - 55.2.
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), false);
  f.cctv.intrinsicHeight = 365;
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), false);
});

test('right rail enters focus only above available height and leaves below the full deadband', () => {
  const f = thrashingRightRail();
  f.options.windowRef.innerHeight = 1000;
  f.options.leftStack.rect.top = 500;
  f.cctv.intrinsicHeight = 408; // Need equals available (460 px).
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), false);
  f.cctv.intrinsicHeight = 409;
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), true);
  f.cctv.intrinsicHeight = 348; // Need equals the 400 px exit boundary.
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), true);
  f.cctv.intrinsicHeight = 347;
  f.run();
  assert.equal(f.stack.classList.contains('layout-focus'), false);
});

test('right rail auto-collapse requests only one retry and settles within two passes', () => {
  const f = thrashingRightRail({ weatherOpen: true });
  const modes = [];
  for (let pass = 0; pass < 10; pass++) {
    f.run();
    modes.push(f.stack.classList.contains('layout-focus'));
  }
  assert.deepEqual(f.collapsed, ['weather-panel']);
  assert.equal(f.retries(), 1);
  assert.deepEqual(modes.slice(1), Array(9).fill(true));
});

test('right rail retry cannot enqueue another retry even if disclosure changes before it runs', () => {
  const f = thrashingRightRail({ weatherOpen: true });
  f.run();
  assert.equal(f.retries(), 1);
  f.weather.classList.remove('collapsed', 'layout-auto-collapsed');
  f.run();
  assert.equal(f.retries(), 1);
  assert.equal(f.stack.dataset.layoutMode, 'focus');
});

test('right rail restores presentation even when intrinsic measurement throws', () => {
  const f = thrashingRightRail();
  f.cctv.getBoundingClientRect = () => {
    throw new Error('measurement failed');
  };
  assert.throws(() => f.run(), /measurement failed/);
  assert.equal(f.stack.getAttribute('data-rail-measuring'), undefined);
});

test('right rail measuring pass keeps an opted-in scroller position', () => {
  const f = fixture('right');
  f.expand(f.first, 300);
  let scrollTop = 240;
  let writes = 0;
  let clamp = true;
  const body = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value) {
      writes++;
      scrollTop = value;
    },
  };
  f.stack.querySelectorAll = (selector) =>
    selector === '[data-rail-scroller]' ? [body] : [];
  const setAttribute = f.stack.setAttribute;
  f.stack.setAttribute = (name, value) => {
    setAttribute(name, value);
    // The lifted max-height removes the overflow and clamps the offset.
    if (clamp && name === 'data-rail-measuring') scrollTop = 0;
  };
  f.run();
  assert.equal(scrollTop, 240);
  assert.equal(writes, 1);
  clamp = false;
  f.run();
  assert.equal(writes, 1, 'an unclamped offset is not rewritten');
});

for (const variant of ['minimal', 'full']) {
  test(`right rail does not retry collapse that the ${variant} HUD immediately restores`, () => {
    const f = fixture('right', { hud: { visible: true, variant } });
    f.expand(f.first, 900);
    f.expand(f.second, 900);
    for (let pass = 0; pass < 10; pass++) f.run();
    assert.equal(f.retries(), 0);
    assert.equal(f.first.classList.contains('collapsed'), false);
    assert.equal(f.second.classList.contains('collapsed'), false);
  });
}
// ── Narrow-screen rail overflow pin ──────────────────────────────────────────
// At ≤720px both panel stacks become scroll containers (overflow-y: auto),
// which also makes their overflow-x compute to auto. Each panel's decorative
// .panel-glow is absolutely positioned with a negative inset, so inside a
// scroll container that overhang is no longer harmless paint: it becomes
// 18–20px of scrollable overflow on both axes, drawing a horizontal scrollbar
// band under the expanded CCTV/Context/Data panel plus a vertical scrollbar
// that scrolls nothing but glow. The narrow block therefore pins every hosted
// glow to its panel box.

/** Strip comments and return the bodies of every ≤720px media block. */
function narrowScreenBlocks(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('@media (max-width: 720px) {', from);
    if (start === -1) break;
    const open = source.indexOf('{', start);
    let depth = 0;
    let close = -1;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}' && (depth -= 1) === 0) {
        close = index;
        break;
      }
    }
    assert.notEqual(close, -1, 'unterminated narrow-screen media block');
    blocks.push(source.slice(open + 1, close));
    from = close + 1;
  }
  assert.ok(blocks.length, 'narrow-screen media block is missing');
  return blocks;
}

/** Split a flat (non-nested) rule list into [selectors, declarations] pairs. */
function flatRules(block) {
  assert.doesNotMatch(block, /@media/, 'nested media queries are not modelled');
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selectors, declarations]) => [
      selectors.split(',').map((part) => part.trim().replace(/\s+/g, ' ')),
      declarations,
    ],
  );
}

test('narrow-screen rails pin every hosted panel glow inside its panel box', () => {
  const css = readStylesheet(new URL('../../style.css', import.meta.url));
  for (const panel of [
    'data-panel',
    'scene-panel',
    'cctv-panel',
    'global-context-panel',
  ]) {
    assert.match(
      css,
      new RegExp(`#${panel} \\.panel-glow \\{[^}]*\\binset: -\\d+px;`),
      `${panel} glow no longer overhangs its panel; revisit this pin`,
    );
  }
  const narrow = narrowScreenBlocks(css).flatMap(flatRules);
  const scrollingRails = [
    ...new Set(
      narrow
        .filter(([, declarations]) =>
          /\boverflow(?:-y)?:\s*(?:auto|scroll)\b/.test(declarations),
        )
        .flatMap(([selectors]) => selectors)
        .filter((selector) =>
          /^#(?:left-panel-stack|right-context-rail)$/.test(selector),
        ),
    ),
  ].sort();
  assert.deepEqual(scrollingRails, [
    '#left-panel-stack',
    '#right-context-rail',
  ]);
  for (const rail of scrollingRails) {
    assert.ok(
      narrow.some(
        ([selectors, declarations]) =>
          selectors.includes(`${rail} .panel-glow`) &&
          /(?:^|;)\s*inset:\s*0\s*;/.test(declarations),
      ),
      `${rail} scrolls at ≤720px but does not pin its panel glows (inset: 0)`,
    );
  }
});

test('desktop Display owns Tactical exclusivity while mobile Display leaves sibling launchers accessible', () => {
  for (const mobile of [false, true]) {
    const f = fixture('right', { mobile });
    f.first.id = 'pp-toggles';
    f.expand(f.first, 250);
    f.run();
    assert.equal(f.stack.classList.contains('layout-exclusive'), !mobile);
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
    assert.equal(
      f.second.getAttribute('aria-hidden'),
      mobile ? undefined : 'true',
    );
    f.first.attributeWrites.length = 0;
    f.second.attributeWrites.length = 0;
    f.run();
    assert.deepEqual(
      f.first.attributeWrites.filter(([, name]) => name === 'aria-hidden'),
      [],
    );
    assert.deepEqual(
      f.second.attributeWrites.filter(([, name]) => name === 'aria-hidden'),
      [],
    );

    f.first.classList.add('collapsed');
    f.run();
    assert.equal(f.stack.classList.contains('layout-exclusive'), false);
    assert.equal(f.second.getAttribute('aria-hidden'), undefined);

    f.expand(f.second, 250);
    f.run();
    assert.equal(f.stack.classList.contains('layout-exclusive'), true);
    assert.equal(f.first.getAttribute('aria-hidden'), 'true');
    assert.equal(f.second.getAttribute('aria-hidden'), undefined);
  }
});

test('right layout ignores a CSS-hidden expanded panel when deciding exclusivity', () => {
  const f = fixture('right');
  const weather = element('weather-panel', { height: 300 });
  weather.computed.display = 'none';
  f.stack.children.push(weather);
  weather.parentElement = f.stack;

  f.run();

  assert.equal(f.stack.classList.contains('layout-exclusive'), false);
  assert.equal(f.stack.dataset.expandedCount, '0');
  assert.equal(f.first.getAttribute('aria-hidden'), undefined);
  assert.equal(f.second.getAttribute('aria-hidden'), undefined);
  assert.equal(
    weather.style.getPropertyValue('--right-panel-allocated-height'),
    '',
  );
});

test('right layout still restores panels that exclusive presentation hides', () => {
  const f = fixture('right');
  // Model layers.css: an exclusive rail hides its collapsed panels.
  f.options.windowRef.getComputedStyle = (node) => ({
    ...node.computed,
    display:
      f.stack.classList.contains('layout-exclusive') &&
      node.classList.contains('collapsed')
        ? 'none'
        : node.computed.display,
  });
  f.expand(f.first, 250);
  f.second.classList.add('layout-auto-collapsed');
  f.stack.classList.add('layout-exclusive');

  f.run();
  assert.equal(f.stack.classList.contains('layout-exclusive'), true);
  assert.equal(f.second.getAttribute('aria-hidden'), 'true');

  f.options.hud.visible = false;
  f.run();
  assert.equal(f.second.classList.contains('collapsed'), false);
  assert.equal(f.second.classList.contains('layout-auto-collapsed'), false);
  assert.deepEqual(f.collapsed, ['second']);
});

test('right layout ignores a hidden panel: no lane, no gap, no auto-collapse', () => {
  const f = fixture('right');
  const imagery = element('recent-imagery-panel', { height: 0 });
  imagery.hidden = true;
  imagery.scrollHeight = 0;
  imagery.rect.height = 0;
  f.stack.children.push(imagery);
  imagery.parentElement = f.stack;
  // A tall panel expands into focus mode: the hidden sibling is not among the
  // later panels that focus mode collapses, and it counts for nothing.
  f.expand(f.first, 900);
  f.run();
  assert.equal(f.stack.dataset.layoutMode, 'focus');
  assert.equal(imagery.classList.contains('collapsed'), false);
  assert.equal(imagery.classList.contains('layout-auto-collapsed'), false);
  assert.equal(f.stack.dataset.expandedCount, '1');
  assert.equal(
    imagery.style.getPropertyValue('--right-panel-allocated-height'),
    '',
  );
  assert.equal(imagery.getAttribute('aria-hidden'), undefined);
  const alone = parseFloat(
    f.first.style.getPropertyValue('--right-panel-allocated-height'),
  );
  // Shown (and expanded) it joins the allocation like any other panel.
  imagery.hidden = false;
  imagery.scrollHeight = 300;
  imagery.rect.height = 300;
  const retriesBefore = f.retries();
  f.run();
  assert.ok(
    f.collapsed.includes('recent-imagery-panel'),
    'focus mode collapses the later panel and asks for another pass',
  );
  assert.equal(f.retries(), retriesBefore + 1);
  f.run();
  assert.equal(f.stack.dataset.expandedCount, '1');
  assert.ok(
    parseFloat(
      f.first.style.getPropertyValue('--right-panel-allocated-height'),
    ) <= alone,
  );
});
