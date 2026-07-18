#!/usr/bin/env python3
"""Rasterize the meridian mark — hermetic, via brando's marklib raster helpers.

Builds the mark Canvas per size and composites it with Pillow. Emits per-size
PNGs for both modes (dark = spectrum on ink, light = deepened spectrum on paper)
plus .icns / .ico for the dark variant.

meridian CONTENT: the per-mode palette + the size/format policy. The Pillow
plumbing (rounded tile, geometry paste) lives in @brando//marklib:raster.

CLI: raster.py <out-dir>
"""
import dataclasses
import os
import sys

from PIL import Image

from gen_mark import Mark, MODES
from marklib import raster as mraster

PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 32, 48, 64, 128, 256]

def raster(spec, size):
    s = dataclasses.replace(spec, canvas=size)
    m = Mark(s)
    tf = m._tf()
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mraster.background_rect(img, size, s.bg, s.bg_round)
    for g, col in zip(m.segs(), s.seg):
        mraster.paste_geom(img, size, tf, g, col)
    mraster.paste_geom(img, size, tf, m.spark(), s.spark)
    return img

def emit(out_dir, name, spec, packed=True):
    imgs = {sz: raster(spec, sz) for sz in PNG_SIZES}
    for sz in PNG_SIZES:
        imgs[sz].save(os.path.join(out_dir, f"meridian_{name}_{sz}.png"))
    if packed:
        imgs[1024].save(os.path.join(out_dir, f"meridian_{name}.icns"), format="ICNS")
        imgs[256].save(os.path.join(out_dir, f"meridian_{name}.ico"),
                       format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"icons meridian_{name}")

def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    emit(out_dir, "mark", MODES["mark"], packed=True)                 # dark (primary)
    emit(out_dir, "light_mark", MODES["light"], packed=False)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
