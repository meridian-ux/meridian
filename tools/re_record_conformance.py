#!/usr/bin/env python3
"""Run the shared snapshot updater from the actual Bazel workspace."""

import os
import sys


def main() -> None:
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY")
    if not workspace:
        print(
            "Run this target with 'bazel run' so snapshots are written to the workspace.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    os.chdir(workspace)
    os.execvp("node", ["node", "schemas/tools/conformance_snapshots.mjs", *sys.argv[1:]])


if __name__ == "__main__":
    main()
