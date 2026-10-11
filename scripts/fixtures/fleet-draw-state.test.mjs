import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  snapshotFleetDrawState,
  encodeFleetDrawState,
} from './fleet-draw-state.mjs';

function context({ failRead = false, failAtlas = false } = {}) {
  const bindings = { copy: { previous: 'copy' }, read: { previous: 'read' } };
  const original = { ...bindings };
  let deleted = 0;
  const gl = {
    COPY_READ_BUFFER_BINDING: 1,
    COPY_READ_BUFFER: 2,
    BUFFER_SIZE: 3,
    READ_FRAMEBUFFER_BINDING: 4,
    READ_FRAMEBUFFER: 5,
    PIXEL_PACK_BUFFER_BINDING: 6,
    FRAMEBUFFER_COMPLETE: 7,
    COLOR_ATTACHMENT0: 8,
    TEXTURE_2D: 9,
    RGBA: 10,
    UNSIGNED_BYTE: 11,
    getParameter(key) {
      return key === 1 ? bindings.copy : key === 4 ? bindings.read : null;
    },
    bindBuffer(_target, value) {
      bindings.copy = value;
    },
    getBufferParameter() {
      return 4;
    },
    getBufferSubData(_target, _offset, bytes) {
      if (failRead) throw new Error('injected buffer read failure');
      bytes.set([1, 2, 3, 4]);
    },
    createFramebuffer() {
      return {};
    },
    bindFramebuffer(_target, value) {
      bindings.read = value;
    },
    framebufferTexture2D() {},
    checkFramebufferStatus() {
      return failAtlas ? -1 : 7;
    },
    readPixels(...args) {
      args.at(-1).set([64, 128, 200, 13]);
    },
    deleteFramebuffer() {
      deleted++;
    },
  };
  const collection = {
    textureAtlas: {
      texture: { width: 1, height: 1, _texture: {} },
      _imagesToAddQueue: [],
    },
    _vaf: {
      _allBuffers: [
        {
          arrayBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
          vertexBuffer: { _buffer: {} },
          arrayViews: [],
          vertexSizeInBytes: 4,
        },
      ],
    },
  };
  return { gl, collection, bindings, original, deleted: () => deleted };
}

test('draw attribution preserves bindings and raw transparent atlas bytes', async () => {
  const ctx = context();
  const snapshot = snapshotFleetDrawState(ctx.collection, ctx.gl);
  assert.deepEqual(ctx.bindings, ctx.original);
  assert.equal(ctx.deleted(), 1);
  const result = await encodeFleetDrawState(snapshot);
  const bytes = gunzipSync(Buffer.from(result.atlas.data, 'base64'));
  assert.deepEqual([...bytes], [64, 128, 200, 13]);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    result.atlas.sha256,
  );
  assert.deepEqual(result.buffers[0].cpu, result.buffers[0].gpu);
});

for (const failure of ['failRead', 'failAtlas']) {
  test(`draw attribution restores engine bindings after ${failure}`, () => {
    const ctx = context({ [failure]: true });
    assert.throws(() => snapshotFleetDrawState(ctx.collection, ctx.gl));
    assert.deepEqual(ctx.bindings, ctx.original);
    assert.equal(ctx.deleted(), failure === 'failAtlas' ? 1 : 0);
  });
}

test('unsupported readback stays unavailable; oversized data is rejected', () => {
  const ctx = context();
  delete ctx.gl.getBufferSubData;
  delete ctx.gl.READ_FRAMEBUFFER;
  const result = snapshotFleetDrawState(ctx.collection, ctx.gl);
  assert.equal(result.buffers[0].gpu, null);
  assert.equal(result.atlas, null);
  ctx.collection._vaf._allBuffers[0].arrayBuffer = new ArrayBuffer(
    4 * 1024 * 1024 + 1,
  );
  assert.throws(
    () => snapshotFleetDrawState(ctx.collection, ctx.gl),
    /byte limit/,
  );
  assert.deepEqual(ctx.bindings, ctx.original);
});
