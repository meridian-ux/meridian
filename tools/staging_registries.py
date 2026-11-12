#!/usr/bin/env python3
"""Upload retained release bytes to the two fixed, disposable loopback services."""

import json
import os
from pathlib import Path
import secrets
import shutil
import struct
import sys
import tomllib
from urllib.parse import quote, urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from release import CRATES, NPM, ROOT, consumer, digest, metadata, require, run, verify
from release_registry import NoRedirect

NPM_URL = "http://127.0.0.1:4873"
CARGO_URL = "http://127.0.0.1:8000"
CARGO_INDEX = f"sparse+{CARGO_URL}/api/v1/crates/"
CRATES_IO_INDEX = "https://github.com/rust-lang/crates.io-index"
HTTP = build_opener(ProxyHandler({}), NoRedirect)


def request(origin, path, body=None, headers=None):
    require(origin in (NPM_URL, CARGO_URL) and path.startswith("/") and not path.startswith("//"),
            "unexpected staging destination")
    with HTTP.open(Request(origin + path, data=body, headers=headers or {},
                           method="PUT" if body is not None else "GET"), timeout=30) as response:
        return response.read()


def check_download(path, contents, sums):
    require(path.read_bytes() == contents, f"download differs from retained candidate: {path.name}")
    sums.append(f"{digest(path)}  {path.name}")
    print(f"Verified registry download: {path.name}", flush=True)


def npm_stage(candidate, version, work, sums):
    env = {k: v for k, v in os.environ.items()
           if not k.lower().startswith(("npm_config_", "node_auth_token", "npm_token", "staging_cargo_token"))}
    env.update(NPM_CONFIG_USERCONFIG=str(work / "npmrc"), NPM_CONFIG_GLOBALCONFIG=os.devnull,
               NPM_CONFIG_CACHE=str(work / "npm-upload-cache"))
    config = Path(env["NPM_CONFIG_USERCONFIG"])
    config.touch(mode=0o600)
    response = json.loads(request(NPM_URL, "/-/user/org.couchdb.user:staging", json.dumps({
        "name": "staging", "password": secrets.token_hex(32), "email": "staging@example.invalid",
        "type": "user", "roles": [],
    }).encode(), {"Content-Type": "application/json"}))
    token = response["token"]
    config.write_text(f"@meridian-ux:registry={NPM_URL}/\n//127.0.0.1:4873/:_authToken={token}\n")
    for short, _ in NPM:
        name = f"@meridian-ux/{short}"
        path = candidate / f"meridian-ux-{short}-{version}.tgz"
        manifest = json.loads(metadata(path, "package/package.json"))
        require(set(manifest.get("publishConfig", {})) <= {"access"}, f"unexpected publishConfig for {name}")
        run(["npm", "publish", str(path), "--registry", NPM_URL, "--ignore-scripts",
             "--provenance=false", "--tag", "next", "--access", "public"], work, env=env)
        package = json.loads(request(NPM_URL, f"/{quote(name, safe='@')}/{version}"))
        tarball = urlsplit(package["dist"]["tarball"])
        require((tarball.scheme, tarball.netloc, tarball.query, tarball.fragment)
                == ("http", "127.0.0.1:4873", "", ""), f"unexpected tarball destination for {name}")
        check_download(path, request(NPM_URL, tarball.path), sums)
    config.write_text(f"@meridian-ux:registry={NPM_URL}/\n")
    env["NPM_CONFIG_CACHE"] = str(work / "npm-consumer-cache")
    app = work / "npm"
    consumer([f"@meridian-ux/{name}@{version}" for name, _ in NPM], app, env=env)
    lock = json.loads((app / "package-lock.json").read_text())["packages"]
    for short, _ in NPM:
        key = f"node_modules/@meridian-ux/{short}"
        entries = [v for k, v in lock.items() if k == key or k.endswith("/" + key)]
        require(len(entries) == 1 and entries[0]["version"] == version
                and entries[0]["resolved"].startswith(NPM_URL + "/"), f"unexpected npm source: {short}")
    print(f"All seven npm packages resolved from Verdaccio at {version}.", flush=True)
    shutil.copyfile(ROOT / "candidate/packages/mui-kit/harness/proto-viewdescriptors.json",
                    app / "projector-catalog.json")
    shutil.copyfile(ROOT / "tools/staging_browser.mjs", app / "staging_browser.mjs")
    run(["node", "node_modules/esbuild/bin/esbuild", "staging_browser.mjs", "--bundle",
         "--platform=browser", "--format=esm", "--external:jsdom", "--external:node:*",
         "--outfile=staging_bundle.mjs"], app)
    run(["node", "staging_bundle.mjs"], app)


def cargo_metadata(path, name, version, published):
    manifest = tomllib.loads(metadata(path, f"{name}-{version}/Cargo.toml"))
    package = manifest["package"]
    deps = []
    for target, tables in [(None, manifest), *manifest.get("target", {}).items()]:
        for key, kind in (("dependencies", "normal"), ("build-dependencies", "build"),
                          ("dev-dependencies", "dev")):
            for alias, dep in tables.get(key, {}).items():
                if isinstance(dep, str):
                    dep = {"version": dep}
                dependency = dep.get("package", alias)
                require(not (dep.keys() & {"path", "git", "registry", "registry-index"}),
                        f"unsupported release dependency source: {dependency}")
                if dependency in CRATES:
                    require(dependency in published and dep["version"] == "=" + version,
                            f"invalid staging dependency order or pin: {name} -> {dependency}")
                deps.append({
                    "name": dependency, "version_req": dep["version"], "features": dep.get("features", []),
                    "optional": dep.get("optional", False), "default_features": dep.get("default-features", True),
                    "target": target, "kind": kind, "registry": None if dependency in CRATES else CRATES_IO_INDEX,
                    "explicit_name_in_toml": alias if alias != dependency else None,
                })
    info = {key: package[key.replace("_", "-")] for key in (
        "authors", "description", "documentation", "homepage", "keywords", "categories",
        "license", "license_file", "repository", "links", "rust_version",
    ) if key.replace("_", "-") in package}
    if package.get("readme"):
        info["readme_file"] = package["readme"]
        info["readme"] = metadata(path, f"{name}-{version}/{package['readme']}")
    return dict(info, name=name, vers=version, deps=deps, features=manifest.get("features", {}))


def cargo_stage(candidate, version, work, evidence, sums):
    config = json.loads(request(CARGO_URL, "/api/v1/crates/config.json"))
    require(config["api"] == CARGO_URL and config["dl"] == f"{CARGO_URL}/api/v1/crates/dl"
            and not config.get("auth-required"), f"unexpected Kellnr config: {config}")
    published = set()
    for name in CRATES:
        path = candidate / f"{name}-{version}.crate"
        info = cargo_metadata(path, name, version, published)
        encoded = json.dumps(info).encode()
        archive = path.read_bytes()
        envelope = struct.pack("<I", len(encoded)) + encoded + struct.pack("<I", len(archive)) + archive
        # Cargo's native registry wire format lets us submit the retained .crate
        # as-is while setting alternate-registry sources in the upload metadata.
        response = json.loads(request(CARGO_URL, "/api/v1/crates/new", envelope, {
            "Authorization": os.environ["STAGING_CARGO_TOKEN"], "Content-Type": "application/octet-stream",
        }))
        require(not response.get("errors"), f"Kellnr rejected {name}")
        published.add(name)
        (evidence / f"{name}-upload-dependencies.json").write_text(json.dumps(info["deps"], indent=2) + "\n")
        check_download(path, request(CARGO_URL, f"/api/v1/crates/dl/{name}/{version}/download"), sums)
    app = work / "rust"
    (app / "src").mkdir(parents=True)
    home = work / "cargo-home"
    home.mkdir()
    (home / "config.toml").write_text(f'[registries.staging]\nindex = "{CARGO_INDEX}"\n')
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("CARGO_", "STAGING_CARGO_TOKEN"))}
    env["CARGO_HOME"] = str(home)
    (app / "Cargo.toml").write_text(
        '[package]\nname = "meridian-staging-consumer"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n'
        '[workspace]\n[dependencies]\n' +
        "".join(f'{name} = {{ version = "={version}", registry = "staging" }}\n' for name in CRATES))
    shutil.copyfile(ROOT / "tools/staging_consumer.rs", app / "src/main.rs")
    packages = json.loads(run(["cargo", "metadata", "--format-version", "1"], app, capture=True, env=env))["packages"]
    for name in CRATES:
        matches = [p for p in packages if p["name"] == name]
        require(len(matches) == 1 and matches[0]["version"] == version
                and matches[0]["source"] == "registry+" + CARGO_INDEX, f"unexpected Cargo source: {name}")
    print(f"All three Rust crates resolved from Kellnr at {version}.", flush=True)
    run(["cargo", "run", "--locked"], app, env=env)


def main(work, evidence):
    # Read the version from the checked-out candidate rather than the PR's source.
    version = run([sys.executable, "-c", "from release import release_version; print(release_version())"],
                  ROOT / "candidate/tools", capture=True).strip()
    candidate = verify(evidence / "candidate", version)
    for name in CRATES:
        file = f"{name}-{version}"
        vcs = json.loads(metadata(candidate / f"{file}.crate", f"{file}/.cargo_vcs_info.json"))
        require(vcs["git"]["sha1"] == os.environ["CANDIDATE"] and not vcs["git"].get("dirty"),
                f"candidate VCS mismatch: {name}")
    sums = []
    try:
        cargo_stage(candidate, version, work, evidence, sums)
        npm_stage(candidate, version, work, sums)
    finally:
        (evidence / "downloaded-SHA256SUMS").write_text("".join(f"{line}\n" for line in sums))


if __name__ == "__main__":
    main(*map(Path, sys.argv[1:]))
