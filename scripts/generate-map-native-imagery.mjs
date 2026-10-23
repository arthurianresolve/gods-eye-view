// Regenerate the pinned native-DPR map corpus with Node 24.16.0.
// Existing v3 PNG bytes are retained; only its eight missing patterns are encoded.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const original = new URL(
  './performance/fixtures/austin-map-streaming-v3/',
  import.meta.url,
);
const target = new URL(
  './performance/fixtures/austin-map-streaming-v5/',
  import.meta.url,
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const indexBytes = await readFile(
  new URL('imagery-png-templates.json', original),
);
const oldBytes = await readFile(new URL('imagery-png-templates.bin', original));
assert.equal(
  hash(indexBytes),
  'd7c9b77091f1ac6daff16542fcd972f95cb47ab6f858e650208d0406b28fa764',
);
assert.equal(
  hash(oldBytes),
  'f2de5cbdd02f5dfd91de10bedabf55511aceb81538aa083d9908ea3cd9271025',
);
const index = JSON.parse(indexBytes);
const oldPatterns = new Map(
  index.templates.map((row) => [
    row.patternId,
    oldBytes.subarray(row.offset, row.offset + row.byteLength),
  ]),
);
const chunks = [];
const sample = oldPatterns.values().next().value;
for (let offset = 8; offset < sample.length;) {
  const length = sample.readUInt32BE(offset);
  const type = sample.toString('ascii', offset + 4, offset + 8);
  if (type === 'IHDR' || type === 'PLTE')
    chunks.push(sample.subarray(offset, offset + length + 12));
  offset += length + 12;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  bytes.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function encode(patternId) {
  const pixels = Buffer.alloc(256 * 257);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++)
      pixels[y * 257 + x + 1] =
        (Math.floor((x + y + patternId) / 11) +
          Math.floor(x / 32) * 3 +
          Math.floor(y / 32) * 5) &
        15;
  return Buffer.concat([
    sample.subarray(0, 8),
    ...chunks,
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let offset = 0;
const templates = [],
  buffers = [];
for (let patternId = 0; patternId < 176; patternId++) {
  const bytes = oldPatterns.get(patternId) || encode(patternId);
  templates.push({
    patternId,
    offset,
    byteLength: bytes.length,
    sha256: hash(bytes),
  });
  buffers.push(bytes);
  offset += bytes.length;
}
const corpus = Buffer.concat(buffers);
const outputIndex = Buffer.from(
  JSON.stringify({
    ...index,
    version: 'austin-map-high-imagery-templates-v2',
    levels: [13, 14, 15, 16],
    corpusByteLength: corpus.length,
    corpusSha256: hash(corpus),
    seedCount: 256,
    patternCount: 176,
    seedMappings: Array.from({ length: 256 }, (_, seed) => ({
      seed,
      patternId: seed % 176,
    })),
    templates,
  }) + '\n',
);
if (process.argv.includes('--check')) {
  assert.deepEqual(
    await readFile(new URL('imagery-png-templates.json', target)),
    outputIndex,
  );
  assert.deepEqual(
    await readFile(new URL('imagery-png-templates.bin', target)),
    corpus,
  );
} else {
  await mkdir(target);
  await writeFile(new URL('imagery-png-templates.json', target), outputIndex, {
    flag: 'wx',
  });
  await writeFile(new URL('imagery-png-templates.bin', target), corpus, {
    flag: 'wx',
  });
}
console.log(
  JSON.stringify({
    indexBytes: outputIndex.length,
    indexSha256: hash(outputIndex),
    corpusBytes: corpus.length,
    corpusSha256: hash(corpus),
    retainedPatterns: oldPatterns.size,
    addedPatterns: 176 - oldPatterns.size,
  }),
);
