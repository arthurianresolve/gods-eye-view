import hashlib
import json
import shutil
import struct
import zlib
from pathlib import Path


def decode_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, chunks = 8, []
    while offset < len(data):
        n = struct.unpack('>I', data[offset:offset+4])[0]
        kind, payload = data[offset+4:offset+8], data[offset+8:offset+8+n]
        assert zlib.crc32(kind+payload) & 0xffffffff == struct.unpack('>I', data[offset+8+n:offset+12+n])[0]
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', payload)
        if kind == b'IDAT':
            chunks.append(payload)
        offset += 12+n
        if kind == b'IEND':
            break
    w, h, depth, color, compression, filtr, interlace = header
    assert (depth, color, compression, filtr, interlace) == (8, 6, 0, 0, 0)
    raw = zlib.decompress(b''.join(chunks))
    stride = w*4
    assert len(raw) == h*(stride+1)
    output, previous = bytearray(), bytearray(stride)
    for y in range(h):
        f = raw[y*(stride+1)]
        row = bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
        assert 0 <= f <= 4
        for x in range(stride):
            a, b, c = row[x-4] if x >= 4 else 0, previous[x], previous[x-4] if x >= 4 else 0
            p = 0
            if f == 1:
                p = a
            elif f == 2:
                p = b
            elif f == 3:
                p = (a+b)//2
            elif f == 4:
                est = a+b-c
                da, db, dc = abs(est-a), abs(est-b), abs(est-c)
                p = a if da <= db and da <= dc else (b if db <= dc else c)
            row[x] = (row[x]+p) & 255
        output.extend(row)
        previous = row
    return w, h, bytes(output)


source = Path('qa-artifacts/datacenter-benefit-38130908513/infrastructure-benefit-38130908513')
dest = Path('docs/performance-evidence/s54-production-collections/datacenter-benefit-38130908513')
report = json.loads((source/'report.json').read_text())
assert report['applicationCommit'] == report['harnessCommit'] == '4f5c55f5b4e708e48b6ec23dc68c5b5cbf50523d'
cache, comparisons = {}, []
for pair in report['pairs']:
    pixels = {}
    for mode, run in pair['runs'].items():
        for phase, image in run['images'].items():
            data = (source/image['path']).read_bytes()
            png_hash = hashlib.sha256(data).hexdigest()
            assert png_hash == image['sha256']
            assert len(data) == image['byteLength']
            if png_hash not in cache:
                cache[png_hash] = decode_png(data)
            w, h, rgba = cache[png_hash]
            assert (w, h) == (image['width'], image['height'])
            expected = run['firstUsable']['pixelSha256'] if phase == 'firstUsable' else run['settledPixelSha256']
            assert hashlib.sha256(rgba).hexdigest() == expected
            pixels[(mode, phase)] = rgba
    for phase in ['firstUsable', 'settled']:
        assert pixels[('entities', phase)] == pixels[('primitive-collections', phase)]
    comparisons.append({'suite': pair['suite'], 'pair': pair['index'], 'firstUsableDifferingBytes': 0, 'settledDifferingBytes': 0})
shutil.copytree(source, dest, dirs_exist_ok=True)
review = {
    'run': 'https://github.com/arthurianresolve/gods-eye-view/actions/runs/38130908513',
    'commit': report['applicationCommit'],
    'rawSha256': hashlib.sha256((source/'report.json').read_bytes()).hexdigest(),
    'verifiedImageFiles': sum(len(run['images']) for pair in report['pairs'] for run in pair['runs'].values()),
    'uniqueDecodedPngs': len(cache),
    'comparisons': comparisons,
    'summary': report['summary'],
    'scope': 'Hosted paravirtual Metal, five fresh-viewer latency pairs and five separate forced-GC JS-heap pairs. Not GPU/native/process retained memory, motion performance, Windows evidence or a full soak. Earlier default-Entity cold activation deadline remains unresolved.'
}
(dest/'review.json').write_text(json.dumps(review, indent=2)+'\n', encoding='utf8')
print(json.dumps({'verifiedImages': review['verifiedImageFiles'], 'uniquePngs': len(cache), 'exactPairs': len(comparisons)}))
