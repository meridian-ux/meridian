#!/usr/bin/env python3
"""Render schemas/conformance/coverage.json as the ROADMAP.md parity matrix.

    tools/roadmap_matrix.py            # print the markdown block
    tools/roadmap_matrix.py --write    # splice it into ROADMAP.md between the markers

The manifest is the source of truth for renderer parity; this only projects it.
A table someone typed beside the manifest drifts. One that is generated cannot.
"""
import json, pathlib, re, sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
GLYPH = {"renders": "●", "placeholder": "◐", "separate-entrypoint": "◑",
         "missing": "○", "structural-gap": "✕", "not-applicable": "–"}

def render() -> str:
    d = json.loads((ROOT / "schemas/conformance/coverage.json").read_text())
    R = list(d["renderers"]); arms = d["arms"]
    out = ["| arm | parity | " + " | ".join(R) + " |", "|---|---|" + "---|" * len(R)]
    gaps = Counter(); by_r = Counter()
    for a, v in arms.items():
        cells = []
        for r in R:
            s = v["renderers"].get(r, {}).get("status", "?")
            cells.append(GLYPH.get(s, "?"))
            if s != "renders":
                gaps[s] += 1; by_r[r] += 1
        out.append(f"| `{a}` | {v['parity']} | " + " | ".join(cells) + " |")
    total = len(arms) * len(R); n = sum(gaps.values())
    out += ["", f"**{len(arms)} arms × {len(R)} renderers = {total} cells; {total - n} render, {n} do not.**", "",
            "| status | cells |", "|---|---|"] + [f"| {GLYPH[k]} `{k}` | {c} |" for k, c in gaps.most_common()]
    out += ["", "| renderer | gaps |", "|---|---|"] + [f"| {r} | {by_r[r]} |" for r in R]
    return "\n".join(out)

if __name__ == "__main__":
    block = render()
    if "--write" in sys.argv:
        p = ROOT / "ROADMAP.md"; t = p.read_text()
        # The end marker may sit directly under the start marker (an empty block on
        # first run), so nothing between them is required — including a newline.
        new = re.sub(r"(<!-- matrix:start -->\n).*?(<!-- matrix:end -->)", lambda m: m.group(1) + block + "\n" + m.group(2), t, flags=re.S)
        if new == t:
            raise SystemExit("ROADMAP.md: matrix markers not found — nothing written")
        p.write_text(new); print("ROADMAP.md matrix refreshed")
    else:
        print(block)
