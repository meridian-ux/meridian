#!/usr/bin/env python3
"""Assert every `exports_files([...])` entry names a file that exists.

    tools/check_exports.py

WHY. A BUILD file that exports a nonexistent file makes its whole package fail to
LOAD, and the error Bazel gives names the missing file rather than the damage.
That is fine when the package is a leaf and catastrophic when it is not: in the
public monorepo, `crates/core/rust/BUILD.bazel` exported a `Cargo.toml` and
`Cargo.lock` that the Cargo-workspace merge had hoisted to the root — and because
that same package defines `:prost_toolchain`, which MODULE.bazel registers, two
lines of dead config were poisoning toolchain resolution for EVERY target.

This is a merge-shaped bug and it has bitten three times now:
  * crates/core/rust and crates/tui/rust  — Cargo.toml/Cargo.lock hoisted
  * schemas and packages/web              — pnpm-lock.yaml/pnpm-workspace.yaml
  * meridian-internal ×4                  — Cargo.lock, never generated at all
  * site                                  — .bazelignore, deleted as inert

Every instance was invisible until a ~10-minute Bazel CI round, and every one
reported something other than its cause. This runs in milliseconds, needs no
Bazel, no registry and no credentials, and catches all of them at review time.

Deliberately NOT a Bazel test: the point is to run in the fast lane, before and
independently of the job it protects.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Only the list literal, terminated at the FIRST closing bracket. A looser regex
# swallows everything after the call and reports every quoted string in the file
# as a missing export — which is exactly what a first attempt at this did.
EXPORTS = re.compile(r"exports_files\(\s*\[(.*?)\]", re.S)
ENTRY = re.compile(r'"([^"]+)"')


def build_files() -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "*BUILD.bazel", "BUILD.bazel"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return sorted(set(out))


def main() -> int:
    problems: list[str] = []
    checked = 0

    for rel in build_files():
        path = ROOT / rel
        pkg = path.parent
        for block in EXPORTS.finditer(path.read_text()):
            for name in ENTRY.findall(block.group(1)):
                checked += 1
                if not (pkg / name).exists():
                    problems.append(f"{rel}: exports_files(\"{name}\") — no such file")

    if problems:
        print("exports_files entries naming files that do not exist:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\nA package whose exports_files names a missing file fails to LOAD, and\n"
            "the error Bazel prints names the file rather than the damage. Delete the\n"
            "entry, or restore the file it refers to.",
            file=sys.stderr,
        )
        return 1

    print(f"exports_files OK — {checked} entries across {len(build_files())} BUILD files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
