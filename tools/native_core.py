#!/usr/bin/env python3
"""Prepare a local static Rust XCFramework; no distribution signing or publication."""
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    "aarch64-apple-darwin", "x86_64-apple-darwin",
    "aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios",
)


def prepare():
    installed = set(subprocess.check_output(["rustup", "target", "list", "--installed"], text=True).split())
    missing = set(TARGETS) - installed
    if missing:
        raise RuntimeError("Install native build targets first: rustup target add " + " ".join(sorted(missing)))
    build = ROOT / ".build/native-core"
    build.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "MACOSX_DEPLOYMENT_TARGET": "13.0",
                   "IPHONEOS_DEPLOYMENT_TARGET": "16.0", "CARGO_INCREMENTAL": "0",
                   "CARGO_PROFILE_RELEASE_PANIC": "unwind"}
    for target in TARGETS:
        subprocess.run([
            "cargo", "rustc", "--locked", "--release", "-p", "meridian-uiview", "--lib",
            "--crate-type", "staticlib", "--target", target, "--target-dir", str(build / "rust"),
        ], cwd=ROOT, env=environment, check=True)
    # Cross-link an actual C consumer for every slice; SwiftPM library builds
    # alone need not link an executable. Run only the current host executable.
    smoke = build / "smoke"
    smoke.mkdir(exist_ok=True)
    triples = (
        ("macosx", "arm64-apple-macosx13.0"), ("macosx", "x86_64-apple-macosx13.0"),
        ("iphoneos", "arm64-apple-ios16.0"),
        ("iphonesimulator", "arm64-apple-ios16.0-simulator"),
        ("iphonesimulator", "x86_64-apple-ios16.0-simulator"),
    )
    headers = str(ROOT / "crates/core/rust/uiview/include")
    host = "aarch64-apple-darwin" if platform.machine() == "arm64" else "x86_64-apple-darwin"
    for target, (sdk_name, triple) in zip(TARGETS, triples):
        sdk = subprocess.check_output(["xcrun", "--sdk", sdk_name, "--show-sdk-path"], text=True).strip()
        executable = smoke / target
        subprocess.run([
            "xcrun", "clang", "-target", triple, "-isysroot", sdk, "-I", headers,
            str(ROOT / "crates/core/rust/uiview/tests/native_smoke.c"),
            str(build / "rust" / target / "release/libmeridian_uiview.a"),
            "-liconv", "-o", str(executable),
        ], check=True)
        if target == host:
            subprocess.run([str(executable)], check=True)
    with tempfile.TemporaryDirectory(prefix="package-", dir=build) as temporary:
        staging = Path(temporary)
        def archive(target):
            return str(build / "rust" / target / "release/libmeridian_uiview.a")
        (staging / "macos").mkdir()
        (staging / "simulator").mkdir()
        mac = staging / "macos/libmeridian_uiview.a"
        simulator = staging / "simulator/libmeridian_uiview.a"
        subprocess.run(["xcrun", "lipo", "-create", archive(TARGETS[0]), archive(TARGETS[1]), "-output", str(mac)], check=True)
        subprocess.run(["xcrun", "lipo", "-create", archive(TARGETS[3]), archive(TARGETS[4]), "-output", str(simulator)], check=True)
        # Match the module name in module.modulemap; all three platform slices
        # contain the same bounded ABI, not a runtime-loaded dylib.
        bundle = staging / "MeridianCoreFFI.xcframework"
        subprocess.run(["xcodebuild", "-create-xcframework",
                        "-library", str(mac), "-headers", headers,
                        "-library", archive(TARGETS[2]), "-headers", headers,
                        "-library", str(simulator), "-headers", headers,
                        "-output", str(bundle)], check=True)
        destination = ROOT / ".build/MeridianCoreFFI.xcframework"
        # Only replace this producer's ignored bundle, after every slice builds.
        if destination.exists():
            destination.rename(staging / "previous.xcframework")
        shutil.move(str(bundle), destination)
    print("Prepared static native core for macOS universal, iOS device, and iOS simulator universal")


if __name__ == "__main__":
    prepare()
