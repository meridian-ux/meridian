#!/usr/bin/env python3
"""Generate a per-feature OG card (1200x630) for every feature with meta.og_generate.

Reads src/content/features.json (the collected catalog), renders an on-brand SVG per
feature (mark + eyebrow + wrapped headline + tagline), and rasterizes to
public/assets/og/<slug>.png via rsvg-convert with the vendored Space Grotesk fonts.

  python3 tools/gen_og.py            # (re)generate cards for og_generate features
"""
import html
import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG = os.path.join(ROOT, "src", "content", "features.json")
FONTS = os.path.join(ROOT, "public", "assets", "fonts")
OUT = os.path.join(ROOT, "public", "assets", "og")

# The brand mark, inlined (1254 viewBox) so rsvg needs no external asset.
MARK = '''<g transform="translate(76,68) scale(0.04785)">
<rect fill="#15161A" height="1254" rx="250.8" ry="250.8" width="1254" x="0" y="0"/>
<path d="M 927.28,522.62 L 821.90,522.62 L 882.74,417.23 L 988.13,417.23 L 927.28,522.62 Z" fill="#4A565A" fill-rule="evenodd"/>
<path d="M 429.26,700.23 L 397.27,644.82 L 476.31,599.19 L 371.26,417.23 L 882.74,417.23 L 627.00,860.19 L 521.95,678.23 L 442.91,723.86 L 429.26,700.23 Z" fill="url(#ag)" fill-rule="evenodd"/>
<path d="M 821.90,522.62 L 927.28,522.62 L 627.00,1042.72 L 442.91,723.86 L 521.95,678.23 L 627.00,860.19 L 821.90,522.62 Z M 213.18,325.96 L 1040.82,325.96 L 988.13,417.23 L 882.74,417.23 L 371.26,417.23 L 432.10,522.62 L 716.51,522.62 L 663.82,613.88 L 450.86,613.88 L 397.27,644.82 L 342.74,550.37 L 326.72,522.62 L 213.18,325.96 Z" fill="#ECE7DA" fill-rule="evenodd"/>
</g>'''


def wrap(text, width):
    """Greedy word-wrap by character budget."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def svg_for(feat):
    hero = feat.get("hero", {})
    eyebrow = (hero.get("eyebrow") or feat.get("category", "").lower()).upper()
    headline = hero.get("headline") or feat.get("name")
    tagline = feat.get("tagline", "")
    hlines = wrap(headline, 22)[:3]
    tlines = wrap(tagline, 64)[:2]

    # Headline block, top-anchored around y=250.
    hy = 300
    htext = ""
    for i, ln in enumerate(hlines):
        htext += f'<text x="76" y="{hy + i*66}" font-family="Space Grotesk" font-weight="600" font-size="58" letter-spacing="-2" fill="#ECE7DA">{html.escape(ln)}</text>\n'
    ty = hy + len(hlines) * 66 + 26
    ttext = ""
    for i, ln in enumerate(tlines):
        ttext += f'<text x="76" y="{ty + i*30}" font-family="Space Grotesk" font-weight="500" font-size="22" fill="#9A9488">{html.escape(ln)}</text>\n'

    return f'''<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F2C46A"/><stop offset="1" stop-color="#C9852B"/></linearGradient>
    <radialGradient id="wa" cx="88%" cy="-12%" r="60%"><stop offset="0" stop-color="#F2C46A" stop-opacity="0.15"/><stop offset="1" stop-color="#F2C46A" stop-opacity="0"/></radialGradient>
    <radialGradient id="wb" cx="-8%" cy="110%" r="60%"><stop offset="0" stop-color="#4A565A" stop-opacity="0.28"/><stop offset="1" stop-color="#4A565A" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#15161A"/>
  <rect width="1200" height="630" fill="url(#wa)"/>
  <rect width="1200" height="630" fill="url(#wb)"/>
  {MARK}
  <text x="150" y="112" font-family="Space Grotesk" font-weight="600" font-size="34" letter-spacing="-0.3" fill="#ECE7DA">fastverk</text>
  <text x="76" y="232" font-family="monospace" font-size="18" letter-spacing="4" fill="#F2C46A">{html.escape(eyebrow)}</text>
  {htext}
  {ttext}
  <text x="76" y="580" font-family="monospace" font-size="17" letter-spacing="0.5" fill="#9A9488">fastverk.com/features/{feat['slug']}</text>
  <text x="1124" y="580" text-anchor="end" font-family="monospace" font-size="15" letter-spacing="1" fill="#4A565A">the intelligence assurance platform</text>
</svg>'''


def main():
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    feats = [f for f in catalog["features"] if f.get("meta", {}).get("og_generate")]
    os.makedirs(OUT, exist_ok=True)

    # Stage fonts so fontconfig (rsvg) can resolve "Space Grotesk".
    home = tempfile.mkdtemp(prefix="og-fonts-")
    fdir = os.path.join(home, ".fonts")
    os.makedirs(fdir)
    for ttf in os.listdir(FONTS):
        if ttf.endswith(".ttf"):
            shutil.copy(os.path.join(FONTS, ttf), fdir)
    env = dict(os.environ, HOME=home)
    subprocess.run(["fc-cache", "-f", fdir], env=env, capture_output=True)

    for f in feats:
        svg_path = os.path.join(home, f"{f['slug']}.svg")
        png_path = os.path.join(OUT, f"{f['slug']}.png")
        open(svg_path, "w", encoding="utf-8").write(svg_for(f))
        subprocess.run(
            ["rsvg-convert", "-w", "1200", "-h", "630", svg_path, "-o", png_path],
            env=env, check=True,
        )
        print(f"  og/{f['slug']}.png")
    shutil.rmtree(home, ignore_errors=True)
    print(f"generated {len(feats)} per-feature OG cards")


if __name__ == "__main__":
    main()
