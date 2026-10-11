// Cesium 1.138 fixture-only attribution. Sample completed draws; never patch
// engine resources or use this synchronous GPU readback in latency runs.
const MAX_BYTES = 4 * 1024 * 1024;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

export function snapshotFleetDrawState(collection, gl) {
  const atlas = collection?.textureAtlas;
  const texture = atlas?.texture;
  const buffers = collection?._vaf?._allBuffers || [];
  check(buffers.length <= 16, 'Fleet buffer diagnostic limit exceeded');
  let total = 0;
  const result = {
    propertiesChanged: Array.from(collection?._propertiesChanged || []),
    queuedBillboards: collection?._billboardsToUpdateIndex ?? null,
    atlasQueuedImages: atlas?._imagesToAddQueue?.length ?? null,
    vertexCount: collection?._vaf?._size ?? null,
    instanced: collection?._vaf?._instanced ?? null,
    buffers: [],
    atlas: null,
  };
  const copyBinding =
    typeof gl.getBufferSubData === 'function'
      ? gl.getParameter(gl.COPY_READ_BUFFER_BINDING)
      : undefined;
  try {
    for (const buffer of buffers) {
      total += buffer.arrayBuffer?.byteLength || 0;
      check(total <= MAX_BYTES, 'Fleet buffer byte limit exceeded');
      const cpu = buffer.arrayBuffer
        ? new Uint8Array(buffer.arrayBuffer.slice(0))
        : null;
      let gpu = null;
      if (copyBinding !== undefined && buffer.vertexBuffer?._buffer && cpu) {
        gl.bindBuffer(gl.COPY_READ_BUFFER, buffer.vertexBuffer._buffer);
        check(
          gl.getBufferParameter(gl.COPY_READ_BUFFER, gl.BUFFER_SIZE) >=
            cpu.byteLength,
          'GPU buffer is shorter than its CPU source',
        );
        gpu = new Uint8Array(cpu.byteLength);
        gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, gpu);
      }
      result.buffers.push({
        usage: buffer.usage,
        vertexSizeInBytes: buffer.vertexSizeInBytes,
        attributes: buffer.arrayViews.map(
          ({
            index,
            componentsPerAttribute,
            componentDatatype,
            normalize,
            offsetInBytes,
          }) => ({
            index,
            componentsPerAttribute,
            componentDatatype,
            normalize,
            offsetInBytes,
          }),
        ),
        needsCommit: buffer.needsCommit,
        cpu,
        gpu,
      });
    }
  } finally {
    if (copyBinding !== undefined)
      gl.bindBuffer(gl.COPY_READ_BUFFER, copyBinding);
  }
  // Bind only the read target of an owned framebuffer; the draw target and
  // engine texture contents stay untouched. Restore the exact prior binding
  // before deleting the temporary framebuffer, including on error.
  if (texture && gl.READ_FRAMEBUFFER !== undefined) {
    const size = texture.width * texture.height * 4;
    check(size > 0 && size <= MAX_BYTES, 'Fleet atlas byte limit exceeded');
    check(
      gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === null,
      'Fleet atlas readback needs an unbound pixel pack buffer',
    );
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const framebuffer = gl.createFramebuffer();
    check(framebuffer, 'Could not allocate diagnostic framebuffer');
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture._texture,
        0,
      );
      check(
        gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) ===
          gl.FRAMEBUFFER_COMPLETE,
        'Atlas cannot be read as an RGBA framebuffer',
      );
      const bytes = new Uint8Array(size);
      gl.readPixels(
        0,
        0,
        texture.width,
        texture.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
      result.atlas = { width: texture.width, height: texture.height, bytes };
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
      gl.deleteFramebuffer(framebuffer);
    }
  }
  return result;
}

export async function encodeFleetDrawState(snapshot) {
  for (const buffer of snapshot.buffers) {
    for (const kind of ['cpu', 'gpu']) {
      const bytes = buffer[kind];
      buffer[kind] = bytes
        ? {
            byteLength: bytes.byteLength,
            sha256: await hash(bytes),
            // Small, bounded attribute evidence permits independent hashing
            // and decoding on the host, including differences in float bits.
            base64: btoa(
              Array.from(bytes, (n) => String.fromCharCode(n)).join(''),
            ),
          }
        : null;
    }
  }
  if (snapshot.atlas) {
    const { width, height, bytes } = snapshot.atlas;
    // Canvas would premultiply transparent texels. Store compressed raw bytes
    // instead so the host can reproduce the original hash without conversion.
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    snapshot.atlas = {
      width,
      height,
      byteLength: bytes.byteLength,
      sha256: await hash(bytes),
      encoding: 'gzip-base64',
      data: btoa(
        Array.from(compressed, (n) => String.fromCharCode(n)).join(''),
      ),
    };
  }
  return snapshot;
}
