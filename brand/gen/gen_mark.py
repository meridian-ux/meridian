#!/usr/bin/env python3
"""meridian mark — an "M" traced by a single refracted light beam.

ONE Spec drives everything: the M letterform (five vertices), the beam stroke
width, and the four spectrum hues the beam disperses into (cyan · azure · violet
· green = refracted light). Geometry = shapely (the beam segments are buffered
line strings, so the joints are round beam-caps). EMISSION goes through brando's
marklib (the reusable layered-SVG / rounded-tile convention).

This file is meridian CONTENT: the geometry + palette. The reusable plumbing
(geometry->SVG path, rounded-square bg, the Canvas/Layer emit model) lives in
@brando//marklib. The web sites add a glow/bloom treatment on top of the same
letterform; the icon form here is the solid, refracted M.

CLI: `gen_mark.py <out-dir>` emits the composite mark SVGs into <out-dir>.
"""
import os
import sys
from dataclasses import dataclass, field, replace

from shapely.geometry import LineString, Point

from marklib import Canvas

# M letterform in a normalized, y-up model space (matches the sites' viewBox M:
# bottom-left -> top-left -> valley -> top-right -> bottom-right).
TOPL = (-0.80, 0.82)
BOTL = (-0.80, -0.82)
VALLEY = (0.0, -0.26)
TOPR = (0.80, 0.82)
BOTR = (0.80, -0.82)

@dataclass
class Spec:
    canvas: int = 1024
    bg: str = "#131419"                      # ink tile
    # the four beam segments, back-to-front: left leg · left diag · right diag · right leg
    seg: tuple = ("#3ED9E0", "#6E8BFF", "#A97CEE", "#57D98B")  # cyan azure violet green
    spark: str = "#E9EAF3"                   # the valley light-source
    stroke: float = 0.16                     # beam width in model units
    bg_round: float = 0.22
    scale_frac: float = 0.40                 # M half-extent as a fraction of the canvas

class Mark:
    def __init__(self, s: Spec):
        self.s = s

    def _tf(self):                           # model (y-up) -> canvas pixels (y-down)
        S = self.s.canvas
        sc = self.s.scale_frac * S
        return lambda x, y: (S / 2 + x * sc, S / 2 - y * sc)

    def segs(self):                          # four buffered beam segments (round caps/joins)
        hw = self.s.stroke / 2
        beam = lambda a, b: LineString([a, b]).buffer(hw, cap_style=1, join_style=1)
        return [
            beam(BOTL, TOPL),                # left leg   (cyan)
            beam(TOPL, VALLEY),              # left diag  (azure)
            beam(VALLEY, TOPR),              # right diag (violet)
            beam(TOPR, BOTR),                # right leg  (green)
        ]

    def spark(self):                         # the bright valley vertex (light concentrates)
        return Point(VALLEY).buffer(self.s.stroke * 0.6)

    def canvas(self) -> Canvas:              # assemble the marklib Canvas
        c = Canvas(size=self.s.canvas, tf=self._tf(), bg_round=self.s.bg_round)
        c.add_background(self.s.bg)
        names = ["leg_l", "diag_l", "diag_r", "leg_r"]
        for name, g, col in zip(names, self.segs(), self.s.seg):
            c.add_layer(name, g, col)        # flat fill per hue = the dispersed beam
        c.add_layer("spark", self.spark(), self.s.spark)
        return c

    def render(self, path):                  # composite SVG (bg + beam + spark)
        self.canvas().render(path)

# dark = the canonical refracted M on ink; light = a deepened spectrum on paper
# (so cyan/green keep contrast off a light field).
MODES = {
    "mark": Spec(),
    "light": Spec(
        bg="#EDEFF6",
        seg=("#17B3C6", "#5A6FE0", "#7C63D8", "#2E9E63"),
        spark="#191B22",
    ),
}

def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    Mark(MODES["mark"]).render(os.path.join(out_dir, "meridian_mark.svg"))
    Mark(MODES["light"]).render(os.path.join(out_dir, "meridian_light_mark.svg"))
    print(f"emit meridian_mark + meridian_light_mark -> {out_dir}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
