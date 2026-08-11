#!/usr/bin/env python3
"""Generate the PUBLISHED package manifests from the development ones.

    tools/publish_manifests.py            # write <name>.package.json for each
    tools/publish_manifests.py --check    # fail if any is stale (the CI gate)

WHY THIS EXISTS. Development manifests use `workspace:*`, which is what makes two
copies of @savvifi/meridian-proto-ts unrepresentable inside the repo. But
`workspace:*` NEVER REACHES THE TARBALL, and that is not a style preference:

  * nothing runs `pnpm publish` — every publish path ends in `npm publish`, and
    npm does not translate the `workspace:` protocol;
  * the Bazel-built packages publish from a DETACHED COPY outside the repo
    (`cp -RL bazel-bin/pkg "$RUNNER_TEMP/pkg" && cd "$RUNNER_TEMP/pkg"`), which
    has no workspace root, no lockfile and no sibling packages. `workspace:*`
    there cannot be resolved by anything — it publishes literally, and a consumer
    installing it gets `EUNSUPPORTEDPROTOCOL`.

meridian-schemas already solved this for its two packages, by hand: a
`schemas.package.json` / `proto/proto-ts.package.json` with real versions,
mapped onto `package.json` by npm_package's `replace_prefixes`. The pattern is
right and this generalises it to all six — GENERATED rather than hand-written,
because six hand-maintained parallel manifests is six chances to drift, and the
drift is invisible until it ships. It shipped twice already: 0.14.0 and 0.15.0
both went out with a stale dependency range, which is why check_versions.py was
written in the first place. That script compared two manifests it could not fix;
this one produces them, so the class of bug ends rather than being detected.

ONE VERSION comes from MODULE.bazel. That is already the estate's convention —
check_versions.py compared the npm manifests against `module(version)` — and it
now also matches //:Cargo.toml's [workspace.package] version, so the three axes
that used to disagree inside a single repo cannot.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# (development manifest, generated published manifest). The generated file sits
# beside the source so `replace_prefixes` in the same package can map it.
PACKAGES = [
    # proto-ts is the one asymmetry: its DEVELOPMENT manifest lives at
    # packages/proto-ts/ (where pnpm links it and where buf generates into), but
    # the Bazel npm_package that assembles the tarball is //schemas/proto:proto_ts_pkg,
    # because the generated TS is a Bazel output of the proto_library. The
    # published manifest therefore sits beside the rule that consumes it.
    ("packages/proto-ts/package.json", "schemas/proto/proto-ts.package.json"),
    ("schemas/package.json", "schemas/schemas.package.json"),
    ("packages/web-react/package.json", "packages/web-react/web-react.package.json"),
    ("packages/mui-kit/package.json", "packages/mui-kit/mui-kit.package.json"),
    ("packages/chat/package.json", "packages/chat/chat.package.json"),
    ("packages/launchpad/package.json", "packages/launchpad/launchpad.package.json"),
]

# Fields that are development-only and must not ship. `devDependencies` in
# particular: a consumer installing the package would otherwise be told it needs
# vitest.
DROP = ("devDependencies", "pnpm", "private")


def module_version() -> str:
    text = (ROOT / "MODULE.bazel").read_text()
    m = re.search(r'module\(\s*(?:[^)]*?)name\s*=\s*"meridian"[^)]*?version\s*=\s*"([^"]+)"', text, re.S)
    if not m:
        raise SystemExit("could not read version from MODULE.bazel")
    return m.group(1)


def published(dev: dict, version: str) -> dict:
    out = {k: v for k, v in dev.items() if k not in DROP}
    out["version"] = version

    for field in ("dependencies", "peerDependencies", "optionalDependencies"):
        deps = out.get(field)
        if not deps:
            continue
        resolved = {}
        for name, spec in deps.items():
            if spec == "workspace:*":
                # An EXACT pin, not a caret. These six release in lockstep, so a
                # range would only ever widen to versions that were never tested
                # together — and at 0.x a caret does not widen anyway
                # (^0.25.0 is >=0.25.0 <0.26.0), so the range buys nothing while
                # costing the guarantee.
                resolved[name] = version
            elif spec.startswith("workspace:"):
                raise SystemExit(
                    f"{field}.{name} uses {spec!r}; only 'workspace:*' is handled here"
                )
            else:
                resolved[name] = spec
        out[field] = resolved

    # `scripts` that only make sense in the workspace would run on `npm install`
    # for a consumer. Keep only lifecycle hooks a published package legitimately
    # needs; today that is none of them.
    out.pop("scripts", None)
    return out


def main() -> int:
    check = "--check" in sys.argv[1:]
    version = module_version()
    stale: list[str] = []

    for dev_path, pub_path in PACKAGES:
        dev = json.loads((ROOT / dev_path).read_text())
        want = json.dumps(published(dev, version), indent=2) + "\n"
        target = ROOT / pub_path

        if check:
            have = target.read_text() if target.exists() else ""
            if have != want:
                stale.append(f"{pub_path} ({'missing' if not have else 'stale'})")
        else:
            target.write_text(want)
            print(f"wrote {pub_path}  {dev['name']}@{version}")

    if check:
        if stale:
            print("published manifests are out of date:", file=sys.stderr)
            for s in stale:
                print(f"  - {s}", file=sys.stderr)
            print(
                "\nRun tools/publish_manifests.py and commit the result.\n"
                "These are what `npm publish` actually ships — the development\n"
                "manifests' `workspace:*` cannot be resolved from the detached\n"
                "$RUNNER_TEMP copy the release job publishes from.",
                file=sys.stderr,
            )
            return 1
        print(f"published manifests OK — all six at {version}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
