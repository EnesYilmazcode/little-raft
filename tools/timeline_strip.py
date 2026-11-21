"""Compose screenshots into one labelled contact-sheet PNG.

Usage: python tools/timeline_strip.py <out.png> <frame.png> [<frame.png> ...]
Library: build_strip(frames, out_path, labels=None, cols=6, thumb=(320, 180)).
Labels default to the file stem. Needs Pillow; returns False when it is missing.
"""
from pathlib import Path
import sys


def build_strip(frames, out_path, labels=None, cols=6, thumb=(320, 180)):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    frames = [Path(f) for f in frames if Path(f).is_file()]
    if not frames:
        return False
    labels = labels or [f.stem for f in frames]
    tw, th = thumb
    pad, bar = 6, 20
    cols = max(1, min(cols, len(frames)))
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + bar + pad) + pad), (18, 24, 28))
    draw = ImageDraw.Draw(sheet)
    for i, (f, label) in enumerate(zip(frames, labels)):
        x = pad + (i % cols) * (tw + pad)
        y = pad + (i // cols) * (th + bar + pad)
        with Image.open(f) as im:
            sheet.paste(im.convert('RGB').resize((tw, th)), (x, y + bar))
        fail = label.startswith('!')
        draw.rectangle([x, y, x + tw, y + bar - 2], fill=(150, 40, 40) if fail else (40, 60, 70))
        draw.text((x + 4, y + 4), label[:48], fill=(255, 255, 255))
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    return True


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(0 if build_strip(sys.argv[2:], sys.argv[1]) else 1)
