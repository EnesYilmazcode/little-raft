"""Mean absolute pixel difference between game screenshots (0-255 scale), by region. No PIL needed.
Usage: python sandbox/perf/imgdiff.py [ref.png] other.png ...   (default ref: shots/game-baseline.png)
changedPct: share of pixels where any channel differs by more than 8/255.
Regions: deck strip (y 420-620, the planks between the hands), sky (y 0-230), full frame.
shoot.py freezes the game clock, so the same build screenshots pixel-identically run to run (baseline vs baseline-2 = 0)."""
import sys, zlib, struct, json
from pathlib import Path
import numpy as np

def read_png(path):
    data = Path(path).read_bytes(); assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w = 8, b'', 0
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8]); body = data[pos + 8:pos + 8 + n]; pos += 12 + n
        if typ == b'IHDR': w, h, depth, ctype = struct.unpack('>IIBB', body[:10]); assert depth == 8
        elif typ == b'IDAT': idat += body
    ch = {2: 3, 6: 4}[ctype]; raw = zlib.decompress(idat); stride = w * ch
    out = np.zeros((h, stride), np.int32); prev = np.zeros(stride, np.int32)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = np.frombuffer(raw, np.uint8, stride, y * (stride + 1) + 1).astype(np.int32)
        if f == 0: cur = line
        elif f == 2: cur = (line + prev) & 255
        else:
            cur = np.zeros(stride, np.int32)
            for i in range(stride):
                a = cur[i - ch] if i >= ch else 0; b = prev[i]; c = prev[i - ch] if i >= ch else 0
                if f == 1: p = a
                elif f == 3: p = (a + b) >> 1
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c); p = a if pa <= pb and pa <= pc else b if pb <= pc else c
                cur[i] = (line[i] + p) & 255
        out[y] = cur; prev = cur
    return out.reshape(h, w, ch)[:, :, :3]

REGIONS = {'deck': (420, 620, 100, 1180), 'sky': (0, 230, 0, 1280), 'full': (0, 720, 0, 1280)}
def diff(a, b):
    out = {k: round(float(np.abs(a[y0:y1, x0:x1] - b[y0:y1, x0:x1]).mean()), 2) for k, (y0, y1, x0, x1) in REGIONS.items()}
    out['changedPct'] = round(100 * float((np.abs(a - b).max(axis=2) > 8).mean()), 2)  # pixels off by more than 8/255
    return out

if __name__ == '__main__':
    args = sys.argv[1:]; here = Path(__file__).resolve().parent
    ref = args.pop(0) if len(args) > 1 else str(here / 'shots' / 'game-baseline.png')
    A = read_png(ref)
    print(json.dumps({Path(p).stem: diff(A, read_png(p)) for p in args}, indent=1))
