#!/usr/bin/env python3
"""Render schemas/conformance/coverage.json as the ROADMAP.md parity matrix.

    tools/roadmap_matrix.py            # print the markdown block
    tools/roadmap_matrix.py --write    # splice it into ROADMAP.md between the markers
    tools/roadmap_matrix.py --check    # fail when the committed matrix is stale

The manifest is the source of truth for renderer parity; this only projects it.
A table someone typed beside the manifest drifts. One that is generated cannot.
"""
import difflib
import json
import pathlib
import re
import sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
GLYPH = {"renders": "●", "placeholder": "◐", "separate-entrypoint": "◑",
         "missing": "○", "structural-gap": "✕", "not-applicable": "–"}
MATRIX_PATTERN = re.compile(
    r"(<!-- matrix:start -->\n).*?(<!-- matrix:end -->)", re.S
)

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


def splice_matrix(roadmap: str, block: str) -> str:
    """Return ROADMAP.md with its generated matrix replaced."""
    new, spliced = MATRIX_PATTERN.subn(
        lambda match: match.group(1) + block + "\n" + match.group(2),
        roadmap,
    )
    if spliced != 1:
        raise ValueError(
            "ROADMAP.md: expected exactly one matrix marker pair, "
            f"found {spliced}"
        )
    return new


def matrix_diff(current: str, expected: str) -> str:
    """Return a reviewable diff for a stale generated matrix."""
    return "".join(
        difflib.unified_diff(
            current.splitlines(keepends=True),
            expected.splitlines(keepends=True),
            fromfile="ROADMAP.md (committed)",
            tofile="ROADMAP.md (generated)",
        )
    )


def main(args: list[str] | None = None) -> int:
    args = sys.argv[1:] if args is None else args
    write = "--write" in args
    check = "--check" in args
    unknown = [arg for arg in args if arg not in {"--write", "--check"}]
    if unknown:
        print(f"unknown argument: {unknown[0]}", file=sys.stderr)
        return 2
    if write and check:
        print("--write and --check are mutually exclusive", file=sys.stderr)
        return 2

    block = render()
    if not write and not check:
        print(block)
        return 0

    path = ROOT / "ROADMAP.md"
    current = path.read_text()
    try:
        expected = splice_matrix(current, block)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1

    if write:
        if expected == current:
            print("ROADMAP.md matrix already current")
        else:
            path.write_text(expected)
            print("ROADMAP.md matrix refreshed")
        return 0

    if expected != current:
        print("ROADMAP.md parity matrix is out of date:", file=sys.stderr)
        print(matrix_diff(current, expected), end="", file=sys.stderr)
        print(
            "\nRun tools/roadmap_matrix.py --write and commit the result.",
            file=sys.stderr,
        )
        return 1

    print("ROADMAP.md parity matrix is current")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
