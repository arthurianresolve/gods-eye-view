import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const OUTPUT = path.join(ROOT, 'src/data/fixtures/weather-effects-v1');

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function makePng(kind, frameIndex) {
  const width = 256;
  const height = 256;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  const palettes = {
    radar: [
      [0, 40, 120],
      [0, 225, 235],
      [250, 235, 0],
      [220, 20, 0],
    ],
    clouds: [
      [18, 24, 36],
      [72, 82, 105],
      [165, 172, 181],
      [238, 238, 232],
    ],
    lightning: [
      [18, 12, 36],
      [70, 24, 140],
      [245, 80, 20],
      [255, 238, 80],
    ],
  };
  const colors = palettes[kind].map(([r, g, b], index) => [
    (r + frameIndex * 17 + index * frameIndex * 3) % 256,
    (g + frameIndex * 29 + index * frameIndex * 5) % 256,
    (b + frameIndex * 41 + index * frameIndex * 7) % 256,
  ]);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const phase = ((x * 7 + y * 11 + ((x * y) % 97)) % 256) / 255;
      const band = Math.min(
        colors.length - 2,
        Math.floor(phase * (colors.length - 1)),
      );
      const local = phase * (colors.length - 1) - band;
      const offset = row + 1 + x * 4;
      for (let channel = 0; channel < 3; channel += 1)
        pixels[offset + channel] = Math.round(
          colors[band][channel] * (1 - local) +
            colors[band + 1][channel] * local,
        );
      pixels[offset + 3] = kind === 'clouds' ? 220 : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const fixedTime = '2026-10-08T12:00:00.000Z';
const times = [
  '2026-10-08T11:50:00.000Z',
  '2026-10-08T11:55:00.000Z',
  fixedTime,
];
const manifests = {
  radar: {
    schemaVersion: 1,
    product: 'radar',
    bounds: { west: -130, south: 20, east: -60, north: 55 },
    times,
    latest: fixedTime,
    tileSize: 256,
    maxLevel: 6,
    tilingScheme: 'geographic',
  },
  'clouds-regional': {
    schemaVersion: 1,
    product: 'clouds-regional',
    bounds: { west: -150, south: 5, east: -40, north: 70 },
    times,
    latest: fixedTime,
    tileSize: 256,
    maxLevel: 6,
    tilingScheme: 'geographic',
  },
  lightning: {
    schemaVersion: 1,
    product: 'lightning',
    bounds: { west: -180, south: -60, east: 180, north: 60 },
    times,
    latest: fixedTime,
    tileSize: 256,
    maxLevel: 6,
    tilingScheme: 'geographic',
  },
};

await mkdir(OUTPUT, { recursive: true });
for (const [product, manifest] of Object.entries(manifests)) {
  await writeFile(
    path.join(OUTPUT, `${product}.manifest.json`),
    `${JSON.stringify(manifest)}\n`,
  );
  for (let frameIndex = 0; frameIndex < times.length; frameIndex += 1)
    await writeFile(
      path.join(OUTPUT, `${product}-${frameIndex}.tile.png`),
      makePng(product === 'clouds-regional' ? 'clouds' : product, frameIndex),
    );
}

const nx = 360;
const ny = 181;
const grid = new Float32Array(nx * ny * 2);
for (let row = 0; row < ny; row += 1) {
  const latitude = (90 - row) * (Math.PI / 180);
  for (let column = 0; column < nx; column += 1) {
    const longitude = column * (Math.PI / 180);
    const index = row * nx + column;
    grid[index] = 8 + 3 * Math.sin(latitude) * Math.cos(longitude);
    grid[nx * ny + index] = 2.5 * Math.sin(longitude) * Math.cos(latitude);
  }
}
await writeFile(
  path.join(OUTPUT, 'gfs-weather-grid.bin'),
  Buffer.from(grid.buffer),
);
