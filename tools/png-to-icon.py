#!/usr/bin/env python3
"""Square up the raven artwork into the icon master.

    tools/png-to-icon.py assets/muninn-raven.png src-tauri/icons/icon.png 1024

The source is a transparent PNG of the mark with whatever framing the export
happened to leave around it. This trims to the artwork's own bounds and centres
it on a square canvas, so the icon does not inherit that framing — the mark's
long axis spans the canvas, which is what a menu bar template image wants.

Scaling is handed to `sips`, which resamples better than anything worth writing
here. This script only does the parts sips cannot: finding the alpha bounds, and
composing onto a transparent square.
"""

import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

# Alpha at or below this is background rather than artwork.
FLOOR = 8
# Fraction of the canvas left empty around the mark, per side. Zero: macOS
# scales a template image to the bar height whatever is in it, so any margin
# baked in here is the icon drawing itself smaller than it is allowed to be.
MARGIN = 0.0


def read_png(path):
    """Decode an 8-bit RGBA PNG to (width, height, bytes)."""
    data = pathlib.Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")

    idat, width, height, colour = b"", 0, 0, 0
    pos = 8
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if tag == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
            if depth != 8 or colour != 6:
                raise ValueError(f"{path}: need 8-bit RGBA, got depth {depth} colour {colour}")
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length

    raw = zlib.decompress(idat)
    stride = width * 4
    out = bytearray()
    previous = bytearray(stride)
    pos = 0
    for _ in range(height):
        filt = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = previous[i]
            c = previous[i - 4] if i >= 4 else 0
            if filt == 1:
                line[i] = (line[i] + a) & 255
            elif filt == 2:
                line[i] = (line[i] + b) & 255
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += line
        previous = line
    return width, height, bytes(out)


def write_png(path, width, height, pixels):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows += pixels[y * stride : (y + 1) * stride]

    pathlib.Path(path).write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def alpha_bounds(width, height, pixels):
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if pixels[row + x * 4 + 3] > FLOOR:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    if max_x < 0:
        raise ValueError("the image is entirely transparent")
    return min_x, min_y, max_x, max_y


def crop(width, height, pixels, box):
    min_x, min_y, max_x, max_y = box
    w, h = max_x - min_x + 1, max_y - min_y + 1
    out = bytearray()
    for y in range(min_y, max_y + 1):
        start = (y * width + min_x) * 4
        out += pixels[start : start + w * 4]
    return w, h, bytes(out)


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip().splitlines()[2].strip())
        return 2

    source, out = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    # "tight" keeps the artwork's own aspect instead of centring it on a square.
    # A square canvas pads a portrait mark with dead space on both sides, and in
    # a menu bar — which scales the whole image to the bar's height — that dead
    # space is simply the icon drawn smaller than the bar allows.
    tight = "--tight" in sys.argv

    width, height, pixels = read_png(source)
    box = alpha_bounds(width, height, pixels)
    cw, ch, cropped = crop(width, height, pixels, box)

    usable = round(size * (1 - MARGIN * 2))
    scale = usable / max(cw, ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))

    with tempfile.TemporaryDirectory() as tmp:
        trimmed = pathlib.Path(tmp) / "trimmed.png"
        scaled = pathlib.Path(tmp) / "scaled.png"
        write_png(trimmed, cw, ch, cropped)
        # sips resamples far better than anything worth writing here, and
        # -z takes height then width.
        subprocess.run(
            ["sips", "-z", str(th), str(tw), str(trimmed), "--out", str(scaled)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        sw, sh, spx = read_png(scaled)

    pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)

    if tight:
        write_png(out, sw, sh, spx)
        print(f"wrote {out} ({sw}x{sh}, tight) — trimmed {width}x{height} to {cw}x{ch}")
        return 0

    canvas = bytearray(size * size * 4)
    off_x, off_y = (size - sw) // 2, (size - sh) // 2
    for y in range(sh):
        src = y * sw * 4
        dst = ((y + off_y) * size + off_x) * 4
        canvas[dst : dst + sw * 4] = spx[src : src + sw * 4]

    write_png(out, size, size, bytes(canvas))
    print(f"wrote {out} ({size}x{size}) — trimmed {width}x{height} to {cw}x{ch}, scaled to {sw}x{sh}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
