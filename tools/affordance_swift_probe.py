#!/usr/bin/env python3
"""Compile the public SwiftUI package against isolated migration descriptors."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, *, failure=False):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=300)
    if failure:
        if result.returncode == 0 or "switch must be exhaustive" not in result.stdout + result.stderr:
            raise RuntimeError(f"Expected explicit invoke-adoption compile failure:\n{result.stdout}\n{result.stderr}")
    elif result.returncode:
        raise RuntimeError(f"Command failed: {command}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True, help="Retained Node proposal probe directory")
    parser.add_argument("--generator", required=True, help="Pinned SwiftProtobuf 1.39.0 generator from tools/swiftui.py")
    args = parser.parse_args()
    if run([args.generator, "--version"]) != "protoc-gen-swift 1.39.0":
        raise RuntimeError("Use the same pinned generator/runtime as the public Swift package")
    with tempfile.TemporaryDirectory(prefix="meridian-affordance-swift-") as temporary:
        work = Path(temporary)
        for name in ["relocated", "candidate"]:
            package = work / name
            package.mkdir()
            for manifest in ["Package.swift", "Package.resolved"]:
                shutil.copyfile(ROOT / manifest, package / manifest)
            native = ROOT / ".build/MeridianCoreFFI.xcframework"
            if not native.is_dir():
                raise RuntimeError("Prepare the canonical native core with tools/swiftui.py first")
            shutil.copytree(native, package / ".build/MeridianCoreFFI.xcframework")
            for directory in ["Sources", "Tests"]:
                shutil.copytree(ROOT / "packages/swiftui" / directory, package / "packages/swiftui" / directory)
            generated = package / "packages/swiftui/Generated"
            generated.mkdir()
            shutil.copyfile(ROOT / "packages/swiftui/Generated/Schema.swift", generated / "Schema.swift")
            shutil.copytree(ROOT / "schemas/conformance/binpb", package / "schemas/conformance/binpb")
            shutil.copyfile(ROOT / "schemas/conformance/core.json", package / "schemas/conformance/core.json")
            image = args.scratch / f"{name}.binpb"
            if not image.is_file():
                raise RuntimeError(f"Missing retained descriptor: {image}")
            template = {"version": "v2", "plugins": [{
                "local": args.generator, "out": str(generated),
                "opt": ["Visibility=Public", "FileNaming=PathToUnderscores"],
            }]}
            run([str(ROOT / "node_modules/.bin/buf"), "generate", str(image),
                 "--exclude-path", "google/protobuf", "--template", json.dumps(template)])
            command = ["swift", "test", "--parallel", "--package-path", str(package)]
            run(command, failure=name == "candidate")
            print(f"{name}: " + ("public Swift package tests pass" if name == "relocated"
                                    else "expanded invoke enum requires explicit host adoption, as expected"))


if __name__ == "__main__":
    main()
