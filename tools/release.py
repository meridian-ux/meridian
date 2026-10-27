#!/usr/bin/env python3
"""Build and rehearse the complete release; uploads require explicit CI gates.

Artifacts use the existing npm/Cargo formats and SHA256SUMS, not a new manifest.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import tomllib

from publish_manifests import FIRST_PARTY_NAMES, module_version

ROOT = Path(__file__).resolve().parent.parent
NPM = (
    ("proto-ts", "schemas/proto/proto_ts_pkg"),
    ("schemas", "schemas/schemas_pkg"),
    ("web-react", "packages/web-react/pkg"),
    ("mui-kit", None),
    ("chat", "packages/chat/pkg"),
    ("launchpad", "packages/launchpad/pkg"),
    ("web", "packages/web/pkg"),
)
CRATES = ("meridian-uiview", "theme-proto", "meridian-tui")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(args, cwd=ROOT, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def release_version():
    version = module_version()
    require(re.fullmatch(r"1\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?", version),
            "release execution requires a major-1 module version")
    return version


def filenames(version):
    return ([f"savvifi-meridian-{name}-{version}.tgz" for name, _ in NPM]
            + [f"{name}-{version}.crate" for name in CRATES])


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def checksums(directory, version):
    return "".join(f"{digest(directory / name)}  {name}\n" for name in filenames(version))


def metadata(archive, member):
    with tarfile.open(archive) as package:
        matches = [item for item in package.getmembers() if item.name == member]
        require(len(matches) == 1 and matches[0].isfile(), f"missing/duplicate metadata: {archive.name}")
        return package.extractfile(matches[0]).read().decode()


def verify(directory, version):
    directory = Path(directory)
    expected = set(filenames(version))
    require({p.name for p in directory.iterdir()} == expected | {"SHA256SUMS"},
            "release must contain exactly seven npm archives, three crates and SHA256SUMS")
    require(all((directory / name).is_file() and not (directory / name).is_symlink()
                for name in expected | {"SHA256SUMS"}), "release artifacts must be regular files")
    require((directory / "SHA256SUMS").read_text() == checksums(directory, version), "release checksum mismatch")
    require({f"@savvifi/meridian-{name}" for name, _ in NPM} == FIRST_PARTY_NAMES,
            "release inventory differs from publication-manifest producer")
    preceding = set()
    for short, _ in NPM:
        name = f"@savvifi/meridian-{short}"
        manifest = json.loads(metadata(directory / f"savvifi-meridian-{short}-{version}.tgz", "package/package.json"))
        require(manifest.get("name") == name and manifest.get("version") == version
                and not manifest.get("private"), f"invalid npm identity: {name}")
        for field in ("dependencies", "peerDependencies", "optionalDependencies"):
            for dependency, pin in manifest.get(field, {}).items():
                require(not pin.startswith(("workspace:", "link:", "file:")), "local npm dependency in release")
                if dependency in FIRST_PARTY_NAMES:
                    require(pin == version, f"non-lockstep npm dependency: {name} / {dependency}")
                    require(dependency in preceding, f"npm publication order does not precede dependent: {dependency} / {name}")
        preceding.add(name)
    for name in CRATES:
        manifest = tomllib.loads(metadata(directory / f"{name}-{version}.crate", f"{name}-{version}/Cargo.toml"))
        require(manifest.get("package", {}).get("name") == name
                and manifest["package"].get("version") == version, f"invalid crate identity: {name}")

        def dependencies(table):
            for key, value in table.items():
                if key in ("dependencies", "dev-dependencies", "build-dependencies"):
                    for dependency, pin in value.items():
                        if isinstance(pin, dict):
                            require("path" not in pin, "path dependency in normalized crate")
                            if pin.get("package", dependency) in CRATES:
                                require(pin.get("version") == "=" + version, "non-lockstep crate dependency")
                        elif dependency in CRATES:
                            require(pin == "=" + version, "non-lockstep crate dependency")
                elif isinstance(value, dict):
                    dependencies(value)
        dependencies(manifest)
    return directory


def consumer(archives, work):
    """Install real archives, check their dependency graph, types and browser imports."""
    work.mkdir()
    (work / "package.json").write_text('{"private":true,"type":"module"}\n')
    run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", *map(str, archives),
         "typescript@5.7.3", "esbuild@0.21.5", "jsdom@25.0.1", "react@19.2.7", "react-dom@19.2.7",
         "@types/react@19.2.17", "@types/react-dom@19.2.3"], work)
    run(["npm", "ls", "--all"], work)
    imports = "\n".join(f"import * as p{i} from '@savvifi/meridian-{name}';" for i, (name, _) in enumerate(NPM))
    (work / "consumer.ts").write_text(imports + "\nexport const packages = [" + ",".join(f"p{i}" for i in range(7)) + "];\n")
    run(["node", "node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--module", "ESNext",
         "--moduleResolution", "Bundler", "--target", "ES2022", "--lib", "ES2022,DOM,DOM.Iterable", "consumer.ts"], work)
    run(["node", "node_modules/esbuild/bin/esbuild", "consumer.ts", "--bundle", "--platform=browser",
         "--format=esm", "--target=es2022", "--outfile=consumer.mjs", "--metafile=inputs.json"], work)
    (work / "smoke.mjs").write_text("""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', {url:'https://release.invalid/'});
for (const key of ['window','document','navigator','HTMLElement','customElements','HTMLCanvasElement','MutationObserver','CustomEvent'])
  Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
const {packages}=await import('./consumer.mjs');
assert.equal(packages.length,7);
assert(packages.every(p=>Object.keys(p).length>0));
const proto=Object.keys(JSON.parse(readFileSync('inputs.json','utf8')).inputs).filter(p=>p.includes('meridian-proto-ts/'));
assert(proto.length>0 && proto.every(p=>p.startsWith('node_modules/@savvifi/meridian-proto-ts/')));
console.log('Seven installed browser packages share one proto-ts root.');
""")
    run(["node", "smoke.mjs"], work)


def rust_rehearsal(target):
    # Cargo's multi-package dry run builds extracted packages using its temporary
    # registry for unpublished first-party dependencies. No upload or token needed.
    workspace_identity(release_version(), runner=run)
    run(["cargo", "publish", "--workspace", "--locked", "--registry", "crates-io",
         "--dry-run", "--target-dir", str(target)])


def workspace_identity(version, runner=run):
    data = json.loads(runner(["cargo", "metadata", "--no-deps", "--format-version", "1", "--locked"], capture=True))
    members = [p for p in data["packages"] if p["id"] in data["workspace_members"] and p.get("publish") != []]
    require({p["name"] for p in members} == set(CRATES), "publishable Rust workspace differs from the three-crate release")
    require(all(p["version"] == version for p in members), "Rust workspace version mismatch")


def rust_archive(target, filename):
    # Cargo 1.95 workspace publishing retains the upload tarballs here, whereas
    # `cargo package` puts its completed archives directly under package/.
    return Path(target) / "package/tmp-crate" / filename


def prepare(output):
    output = Path(output).resolve()
    require(not output.exists() and output.parent.is_dir(), "output must be new with an existing parent")
    version = release_version()
    work = Path(tempfile.mkdtemp(prefix="meridian-release-"))
    print(f"Release rehearsal retained at {work}", flush=True)
    stage = work / "artifacts"
    stage.mkdir()
    for name, source in NPM:
        if source:
            package = ROOT / "bazel-bin" / source
        else:
            package = work / "mui-kit"
            package.mkdir()
            run(["node", "node_modules/typescript/bin/tsc", "-p", "packages/mui-kit/tsconfig.build.json",
                 "--outDir", str(package / "dist")])
            shutil.copyfile(ROOT / "packages/mui-kit/mui-kit.package.json", package / "package.json")
            shutil.copyfile(ROOT / "packages/mui-kit/README.md", package / "README.md")
        run(["npm", "pack", "--ignore-scripts", "--pack-destination", str(stage)], package)
        require((stage / f"savvifi-meridian-{name}-{version}.tgz").is_file(), "unexpected npm pack output")
    consumer([stage / name for name in filenames(version) if name.endswith(".tgz")], work / "consumer")
    rust_rehearsal(work / "rust")
    for name in CRATES:
        archive = f"{name}-{version}.crate"
        shutil.copyfile(rust_archive(work / "rust", archive), stage / archive)
    (stage / "SHA256SUMS").write_text(checksums(stage, version))
    verify(stage, version)
    # Only a complete, tested set reaches the output directory.
    shutil.copytree(stage, output)
    print(f"Verified seven npm packages and three crates at {version}: {output}", flush=True)


def authorize(env, version):
    require(env.get("GITHUB_REPOSITORY") == "meridian-ux/meridian", "wrong release repository")
    require(env.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "publication requires manual dispatch")
    require(env.get("GITHUB_REF") == f"refs/tags/v{version}", "publication requires the matching version tag")
    require(env.get("MERIDIAN_RELEASE_PUBLISH_ENABLED") == "true"
            and env.get("MERIDIAN_RELEASE_PUBLISH_REQUESTED") == "true", "publication is not enabled and requested")


def compare_crates(directory, target, version):
    for name in CRATES:
        archive = f"{name}-{version}.crate"
        require(digest(rust_archive(target, archive)) == digest(Path(directory) / archive),
                f"rehearsed crate differs from retained artifact: {name}")


def source_identity(env, runner=run):
    require(runner(["git", "rev-parse", "HEAD"], capture=True).strip() == env.get("GITHUB_SHA"), "release source SHA mismatch")
    runner(["git", "diff", "--exit-code", "HEAD"])
    runner(["git", "merge-base", "--is-ancestor", "HEAD", "origin/main"])


def publish(directory, target, env=None, runner=run):
    version = release_version()
    env = os.environ if env is None else env
    authorize(env, version)
    directory = verify(directory, version)
    source_identity(env, runner=runner)
    workspace_identity(version, runner=runner)
    compare_crates(directory, target, version)
    # Cargo repackages in both dry-run and upload modes; verification stays on.
    # The preflight compares those packages to the retained review artifacts.
    runner(["cargo", "publish", "--workspace", "--locked", "--registry", "crates-io", "--target-dir", str(target)])
    compare_crates(directory, target, version)
    tag = "next" if "-" in version else "latest"
    for name, _ in NPM:
        runner(["npm", "publish", str(directory / f"savvifi-meridian-{name}-{version}.tgz"),
                "--ignore-scripts", "--access", "public", "--tag", tag, "--registry", "https://registry.npmjs.org"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify", "authorize", "rehearse-rust", "publish"))
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--rust-target", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.artifacts)
        return
    version = release_version()
    verify(args.artifacts, version)
    if args.command == "authorize":
        authorize(os.environ, version)
        source_identity(os.environ)
    elif args.command in ("rehearse-rust", "publish"):
        require(args.rust_target is not None, "--rust-target is required")
        if args.command == "rehearse-rust":
            rust_rehearsal(args.rust_target)
            compare_crates(args.artifacts, args.rust_target, version)
        else:
            publish(args.artifacts, args.rust_target)


if __name__ == "__main__":
    main()
