import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  DECORATION_STYLE_KEYS,
  readDecorationCaptureProofInPage,
  createDecorationSnapshotReader,
  createDecorationFontReader,
  retainDecorationFailureEvidence,
} from './decorationCaptureProof.mjs';

function pageFixture() {
  const computed = Object.fromEntries(
    DECORATION_STYLE_KEYS.map((key) => [key, '']),
  );
  Object.assign(computed, {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    fontStyle: 'normal',
    fontWeight: '400',
    fontSize: '12px',
    fontFamily: 'monospace',
  });
  const root = (id) => ({
    id,
    tagName: 'DIV',
    className: '',
    isConnected: true,
    parentElement: null,
    attributes: [{ name: 'id', value: id }],
    children: [],
    childNodes: [],
    getBoundingClientRect: () => ({ x: 10, y: 10, width: 100, height: 20 }),
    closest: () => null,
    contains: () => false,
  });
  const title = root('title-bar'),
    badge = root('cctv-source-badge');
  const nodes = (element, strings) => {
    element.childNodes = strings.map((data) => ({
      nodeType: 3,
      data,
      parentElement: element,
    }));
    return element.childNodes;
  };
  const titleTexts = nodes(title, [
    "GOD'S EYE ",
    'VIEW',
    'NO PLACE LEFT BEHIND',
  ]);
  const badgeTexts = nodes(badge, ['SYNTHETIC · STALE']);
  const fonts = [];
  fonts.status = 'loaded';
  fonts.check = () => true;
  const document = {
    fonts,
    querySelector: (selector) => (selector === '#title-bar' ? title : badge),
    createTreeWalker: (element) => {
      const values = element === title ? titleTexts : badgeTexts;
      let index = 0;
      return { nextNode: () => values[index++] || null };
    },
    createRange: () => ({
      selectNodeContents() {},
      getClientRects: () => [{ x: 10, y: 10, width: 90, height: 12 }],
    }),
    getAnimations: () => [],
  };
  return {
    document,
    getComputedStyle: () => computed,
    NodeFilter: { SHOW_TEXT: 4 },
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
  };
}

test('serialized reader records raw text nodes even when their parent has element children', () => {
  const context = pageFixture();
  const result = vm.runInNewContext(
    `(${readDecorationCaptureProofInPage.toString()})()`,
    context,
  );
  assert.equal(result.status, 'observed');
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.texts.map((text) => text.text))),
    ["GOD'S EYE ", 'VIEW', 'NO PLACE LEFT BEHIND', 'SYNTHETIC · STALE'],
  );
  assert.deepEqual(Object.keys(result.texts[0].style), DECORATION_STYLE_KEYS);
  assert.equal(result.texts[0].rects.length, 1);
  const reader = createDecorationSnapshotReader(() => ({ phase: 0 }));
  assert.equal(
    vm.runInNewContext(`(${reader.toString()})()`, context).phase,
    0,
  );
  const skipped = createDecorationSnapshotReader(() => ({ phase: -1 }));
  assert.equal(
    vm.runInNewContext(`(${skipped.toString()})()`, {}).decoration,
    null,
  );
});

test('reader marks missing roots and excessive text unavailable without changing the document', () => {
  const context = pageFixture();
  context.document.querySelector = () => null;
  assert.equal(
    vm.runInNewContext(
      `(${readDecorationCaptureProofInPage.toString()})()`,
      context,
    ).status,
    'unavailable',
  );
  const large = pageFixture();
  large.document.createTreeWalker = () => {
    let count = 0;
    const parentElement = large.document.querySelector('#title-bar');
    return {
      nextNode: () => (count++ < 40 ? { data: 'text', parentElement } : null),
    };
  };
  assert.equal(
    vm.runInNewContext(
      `(${readDecorationCaptureProofInPage.toString()})()`,
      large,
    ).overflow,
    true,
  );
});

test('failed decoration inputs preserve exact boxless ancestor geometry with a bounded diagnostic envelope', () => {
  const context = pageFixture();
  const badge = context.document.querySelector('#cctv-source-badge');
  const computed = context.getComputedStyle();
  const wrapper = {
    tagName: 'DIV',
    id: '',
    className: 'cyber-panel-body',
    parentElement: null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  };
  badge.parentElement = wrapper;
  context.getComputedStyle = (element) =>
    element === wrapper ? { ...computed, display: 'contents' } : computed;
  const before = JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        `(${readDecorationCaptureProofInPage.toString()})()`,
        context,
      ),
    ),
  );
  assert.deepEqual(before.surfaces[1].ancestors[1].rect, {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  assert.equal(before.surfaces[1].ancestors[1].style.display, 'contents');
  const input = {
    before,
    fontsBefore: [{ selector: '#cctv-source-badge', fonts: [] }],
  };
  const retained = retainDecorationFailureEvidence(input);
  assert.equal(retained.acceptanceEligible, false);
  assert.equal(retained.status, 'retained');
  assert.deepEqual(retained.evidence, input);
  before.surfaces[1].ancestors[1].rect.width = 1;
  assert.equal(retained.evidence.before.surfaces[1].ancestors[1].rect.width, 0);
  assert.equal(
    retainDecorationFailureEvidence({ before: 'x'.repeat(524289) }).status,
    'omitted-size-bound',
  );
  const cycle = {};
  cycle.self = cycle;
  assert.equal(
    retainDecorationFailureEvidence({ before: cycle }).status,
    'unserializable',
  );
  assert.equal(retainDecorationFailureEvidence({ before: null }), null);
});

function fontSession({ fail = null, fonts = null } = {}) {
  const calls = [];
  const session = {
    async send(method) {
      calls.push(method);
      if (method === fail) throw new Error(`failed ${method}`);
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') return { nodeId: 2 };
      if (method === 'CSS.getPlatformFontsForNode')
        return {
          fonts: fonts || [
            {
              familyName: 'Consolas',
              postScriptName: 'Consolas',
              isCustomFont: false,
              glyphCount: 8,
            },
          ],
        };
      return {};
    },
    async detach() {
      calls.push('detach');
      if (fail === 'detach') throw new Error('detach failure');
    },
  };
  return { calls, page: { createCDPSession: async () => session } };
}

test('font reader resolves post-navigation nodes on each boundary and normalizes only node identity', async () => {
  const { page, calls } = fontSession();
  const reader = await createDecorationFontReader(page);
  const proof = {
    status: 'observed',
    texts: [{ parentSelector: '#title-bar' }],
  };
  const first = await reader.read(proof),
    second = await reader.read(proof);
  assert.deepEqual(first, second);
  assert.equal(
    calls.filter((method) => method === 'DOM.getDocument').length,
    2,
  );
  assert.equal(JSON.stringify(first).includes('nodeId'), false);
  await reader.dispose();
  await reader.dispose();
  assert.equal(calls.filter((method) => method === 'detach').length, 1);
  await assert.rejects(reader.read(proof), /disposed/);
});

test('partial font-session setup and cleanup failure release all owned resources', async () => {
  for (const fail of ['DOM.enable', 'CSS.enable']) {
    const { page, calls } = fontSession({ fail });
    await assert.rejects(createDecorationFontReader(page));
    assert.deepEqual(calls.slice(-3), ['CSS.disable', 'DOM.disable', 'detach']);
  }
  const { page, calls } = fontSession({ fail: 'CSS.disable' });
  const reader = await createDecorationFontReader(page);
  await assert.rejects(reader.dispose(), /cleanup/);
  assert.deepEqual(calls.slice(-3), ['CSS.disable', 'DOM.disable', 'detach']);
});

test('unsupported, empty or malformed platform-font results fail unavailable', async () => {
  for (const options of [
    { fail: 'CSS.getPlatformFontsForNode' },
    { fonts: [] },
    {
      fonts: [
        {
          familyName: 'X',
          postScriptName: 'X',
          isCustomFont: false,
          glyphCount: 0,
        },
      ],
    },
  ]) {
    const { page } = fontSession(options);
    const reader = await createDecorationFontReader(page);
    await assert.rejects(
      reader.read({
        status: 'observed',
        texts: [{ parentSelector: '#title-bar' }],
      }),
    );
    await reader.dispose();
  }
});
