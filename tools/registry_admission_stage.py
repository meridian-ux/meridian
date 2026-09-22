#!/usr/bin/env python3
"""Stage the working module file over the latest published registry version.

The D2/D3 registry ratchet compares the published registry projection with a
projection that substitutes this checkout's module graph declarations. Version
numbers are normalized to the published directory because this check measures
graph policy, not release-version validity.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys


def stage_module(module_file: pathlib.Path, registry_module: pathlib.Path) -> str:
    source = module_file.read_text()
    declaration = re.search(r"^module\((.*?)^\)", source, re.S | re.M)
    if not declaration:
        raise ValueError("MODULE.bazel has no module() declaration")
    name = re.search(r'name\s*=\s*"([^"]+)"', declaration.group(1))
    version = re.search(r'version\s*=\s*"([^"]+)"', declaration.group(1))
    if not name or name.group(1) != "meridian" or not version:
        raise ValueError("expected module(name = 'meridian', version = ...)")

    metadata_path = registry_module / "metadata.json"
    metadata = json.loads(metadata_path.read_text())
    versions = metadata.get("versions", [])
    if not versions:
        raise ValueError("published registry has no Meridian versions")
    latest = versions[-1]
    published = registry_module / latest / "MODULE.bazel"
    if not published.is_file():
        raise ValueError(f"published Meridian module is missing: {published}")

    staged, replacements = re.subn(
        r'(^module\(.*?^\s*version\s*=\s*)"[^"]+"',
        lambda match: match.group(1) + json.dumps(latest),
        source,
        count=1,
        flags=re.S | re.M,
    )
    if replacements != 1:
        raise ValueError("could not normalize staged module version")
    (registry_module / latest / "MODULE.bazel").write_text(staged)
    return f"candidate: meridian@{version.group(1)} staged as published meridian@{latest}"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: registry_admission_stage.py MODULE.bazel REGISTRY/modules/meridian")
    try:
        print(stage_module(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
