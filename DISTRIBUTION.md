# Distribution preparation for v1

Decision: prepare crates.io packages for the Rust core, theme types, and TUI,
and an npm package for the web-components renderer. Bazel and the existing
browser ESM bundle remain supported build surfaces. This document does not
announce a release, reserve registry names, configure credentials, publish
packages, or authorize a deployment.

All artifacts follow `MODULE.bazel` and the Cargo workspace version. The current
preparation uses 0.25.1; v1 versions must not be assigned until its remaining
contract and conformance requirements are satisfied.

## Rust archives

`meridian-uiview`, `theme-proto`, and `meridian-tui` are the three public Cargo
packages. Their manifests inherit the public monorepo repository metadata.
First-party dependencies carry both local paths and exact registry versions;
Cargo removes workspace paths when normalizing the distributed manifests.
Release version changes must update those pins with the workspace version.

Verify without publication:

```sh
cargo package --workspace --locked --target-dir /tmp/meridian-crate-packages
```

Cargo assembles archives and compiles their extracted contents, using its
temporary registry for the not-yet-published workspace dependencies. This catches
missing descriptor sets and invalid registry dependency specifications without
uploading anything. The archive verifier uses a separate target directory so
temporary-registry artifacts cannot contaminate subsequent path-origin workspace
builds. The core and theme build scripts consume descriptor sets inside their own
archives, with no consumer-side protoc requirement. This build
verification does not replace the repository's full Cargo/Bazel conformance tests;
some of those tests depend on the shared repository fixture corpus.

After a separately approved release, the dependency order is core and theme,
then TUI. Registry-name availability/ownership and publishing credentials still
need a release-time check. No Cargo publication workflow is enabled here.

## Web-components npm artifact

Build `//packages/web:pkg`. Its generated publication manifest is
`packages/web/web.package.json`; the development manifest remains private to
prevent publishing unbuilt source. `tools/publish_manifests.py` pins first-party
dependencies to the same module version as the other npm artifacts.

Public browser ESM entrypoints:

| Import | Surface |
| --- | --- |
| `@savvifi/meridian-web` | Panel/view renderer, codec helpers, component registration |
| `@savvifi/meridian-web/toolkit` | Worker/DOM toolkit |
| `@savvifi/meridian-web/theme` | Compiled theme binding |
| `@savvifi/meridian-web/theme.css` | Theme stylesheet |

The package ships compiled JavaScript, declarations, the worker-command schema,
and CSS, not raw TypeScript. It is a browser library, not a server-rendering API.
Consumers checking dependency declarations need TypeScript 5.7 or newer because
protobuf-es 2.12.1 uses generic typed arrays. The detached check uses 5.7.3 with
strict checking and without `skipLibCheck`; it does not change the workspace's
existing compiler pin.
Import CSS through the host's bundler; custom element registration stays explicit.
Hosts still supply initialized `UiviewWasm` bindings for rendering operations that
need the core. The new package does not secretly replace that transport/runtime
seam or contain an unrelated generated WASM copy.

Verify the actual tarballs from a detached consumer:

```sh
bazel build --announce_rc=false //packages/web:pkg //schemas:schemas_pkg //schemas/proto:proto_ts_pkg
node tools/check_web_package.mjs
```

The check packs all three local artifacts, verifies exported files, installs
them without lifecycle scripts into a fresh temporary directory, typechecks
the public imports (including typed old-path facades and canonical envelopes),
bundles the installed browser entrypoints with pinned esbuild, and executes a
browser-DOM smoke test. Installed controls also prove denied semantic actions
ask no consent, admitted actions honor accepted/declined consent, raw zero/false
RPC bindings reach the packaged Rust builder unchanged, and an explicit empty
canonical envelope never revives legacy buttons. It does not resolve
first-party dependencies from workspace symlinks or publish to npm. CI also
retains all existing renderer, compatibility, and conformance gates.

The existing release workflow still publishes only its previous six packages.
Adding this package to an actual release requires an approved release change,
npm ownership/trusted-publisher setup, and verification that the full v1 contract
is ready. Neither tag creation nor publication is authorized by this preparation.
