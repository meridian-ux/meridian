#!/usr/bin/env python3
"""Build the pinned Swift generator, generate canonical bindings, and test SwiftUI."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-only", action="store_true")
    parser.add_argument("--ios", action="store_true", help="Also cross-compile for iOS 16 (no deployment)")
    args = parser.parse_args()
    run("swift", "package", "resolve")
    dependency = ROOT / ".build/checkouts/swift-protobuf"
    build = ROOT / ".build/swift-protobuf-generator"
    run("swift", "build", "--package-path", str(dependency), "--scratch-path", str(build),
        "--product", "protoc-gen-swift")
    binary_dir = subprocess.check_output([
        "swift", "build", "--package-path", str(dependency), "--scratch-path", str(build),
        "--show-bin-path"], cwd=ROOT, text=True).strip()
    # Buf owns import resolution and uses the same modules as every other language.
    # Include the field-behavior annotation's generated extension, not a vendored DTO.
    # Generate in isolation first. A failed generator cannot truncate the last
    # usable tree, and removed declarations cannot survive as stale Swift files.
    destination = ROOT / "packages/swiftui/Generated"
    with tempfile.TemporaryDirectory(prefix="meridian-swift-") as directory:
        template = {"version": "v2", "plugins": [{
            "local": str(Path(binary_dir) / "protoc-gen-swift"),
            "out": directory,
            "opt": ["Visibility=Public", "FileNaming=PathToUnderscores"],
        }]}
        run(str(ROOT / "node_modules/.bin/buf"), "generate", "--template", json.dumps(template),
            "--path", "schemas/proto", "--path", "third_party/googleapis/google/api/field_behavior.proto")
        outputs = list(Path(directory).glob("*.pb.swift"))
        if not outputs:
            raise RuntimeError("Swift generation produced no bindings")
        names = {output.name for output in outputs}
        for output in outputs:
            shutil.copyfile(output, destination / output.name)
        for stale in destination.glob("*.pb.swift"):
            if stale.name not in names:
                stale.unlink()  # Only this tool's ignored generated outputs.
    if not args.generate_only:
        run("swift", "test", "--parallel")
    if args.ios:
        sdk = subprocess.check_output(["xcrun", "--sdk", "iphoneos", "--show-sdk-path"], text=True).strip()
        run("swift", "build", "--triple", "arm64-apple-ios16.0", "--sdk", sdk,
            "--scratch-path", str(ROOT / ".build/ios"))


if __name__ == "__main__":
    main()
