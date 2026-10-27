#!/usr/bin/env python3
"""Isolated Rust verification using retained migration descriptors.

The historical proposal phase requires pure relocation workspace success and
the original expanded-candidate exhaustive-dispatch failure. That failure was
an adoption blocker, not permission to weaken the production FILE gate.
The explicit --canonical phase instead requires the adopted source workspace to
pass its complete tests against the actual candidate image. This is not cutover.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def require_adoption_failure(returncode, stdout, stderr):
    """Accept only the known typed dispatch blocker, never arbitrary failures."""
    if returncode == 0:
        raise RuntimeError("Candidate unexpectedly compiles; review adoption evidence and update this probe")
    errors = []
    finished = False
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("reason") == "build-finished":
            finished = event.get("success") is False
        if event.get("reason") != "compiler-message":
            continue
        message = event.get("message", {})
        if message.get("level") == "error":
            errors.append(message)
    if returncode != 101 or not finished or not errors or any(
        (message.get("code") or {}).get("code") != "E0004"
        or "non-exhaustive patterns" not in message.get("message", "")
        or not all(variant in message.get("message", "") for variant in
                   ["Invoke::Rpc", "Invoke::Navigate", "Invoke::OpenPanel"])
        or not any(
            span.get("is_primary")
            and span.get("file_name", "").replace("\\", "/").endswith(
                "crates/core/rust/uiview/src/static_view.rs"
            )
            for span in message.get("spans", [])
        )
        for message in errors
    ):
        raise RuntimeError(f"Unexpected candidate failure (not accepted as migration evidence):\n{stdout}\n{stderr}")
    return errors


def protected_inputs(root):
    paths = [root / "Cargo.lock", root / "buf.yaml", root / "buf.gen.yaml"]
    paths.extend((root / "schemas/proto").glob("*.proto"))
    paths.extend(root.glob("crates/**/Cargo.toml"))
    paths.extend(root.glob("crates/**/proto/gen/*.binpb"))
    paths.append(root / "Cargo.toml")
    return {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def run_world(root, descriptor, target, *, candidate=False):
    environment = dict(os.environ, MERIDIAN_UIVIEW_DESCRIPTOR_SET=str(descriptor))
    command = ["cargo"]
    if candidate:
        command += ["check", "--locked", "-p", "meridian-uiview", "--lib", "--message-format=json"]
    else:
        command += ["test", "--locked", "--workspace", "--quiet"]
    command += ["--target-dir", str(target)]
    result = subprocess.run(command, cwd=root, env=environment, text=True,
                            capture_output=True, timeout=1800)
    if candidate:
        errors = require_adoption_failure(result.returncode, result.stdout, result.stderr)
        for error in errors:
            print(f"candidate adoption blocker: {error['message']}")
        print("candidate: rejected at typed core dispatch as expected; native adoption remains outstanding")
    elif result.returncode:
        raise RuntimeError(f"Workspace tests failed for {descriptor.name}:\n{result.stdout}\n{result.stderr}")
    else:
        print(f"{descriptor.stem}: workspace tests passed")
        for line in result.stdout.splitlines():
            if line.startswith("test result:"):
                print(line)


def world_plan(canonical=False):
    # Adopted source intentionally names new fields/variants, so compiling that
    # source against pre-adoption bindings is no longer a valid consumer test.
    # Frozen old-reader wire/source/bytecode checks remain in the Node/Java probe.
    return [("candidate", False)] if canonical else [
        ("old", False), ("relocated", False), ("candidate", True),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True,
                        help="Retained affordance_migration_probe.mjs --keep directory")
    parser.add_argument("--canonical", action="store_true",
                        help="Require complete workspace success against the actual canonical candidate")
    args = parser.parse_args()
    scratch = args.scratch.resolve()
    plan = world_plan(args.canonical)
    images = {name: scratch / f"{name}.binpb" for name, _ in plan}
    for image in images.values():
        if not image.is_file() or not image.stat().st_size:
            raise RuntimeError(f"Missing retained descriptor: {image}")
    before = protected_inputs(ROOT)
    try:
        with tempfile.TemporaryDirectory(prefix="meridian-affordance-rust-") as temporary:
            work = Path(temporary)
            for name, expected_failure in plan:
                # Separate targets prevent one descriptor world's generated Rust
                # or temporary registry artifacts from contaminating another.
                run_world(ROOT, images[name], work / name, candidate=expected_failure)
    finally:
        if protected_inputs(ROOT) != before:
            raise RuntimeError("Proposal probe changed canonical schemas, descriptors, policy, or Cargo inputs")
    print("Rust migration verification finished; no production cutover or v1 acceptance is implied")


if __name__ == "__main__":
    main()
