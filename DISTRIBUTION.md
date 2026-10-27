# Distribution preparation for v1

Decision: prepare crates.io packages for the Rust core, theme types, and TUI,
and an npm package for the web-components renderer. Bazel and the existing
browser ESM bundle remain supported build surfaces. This document does not
announce a release, reserve registry names, configure credentials, publish
packages, or authorize a deployment.

All artifacts follow `MODULE.bazel` and the Cargo workspace version. This
unreleased source line prepares **1.0.0** for the canonical removal contract.
Required node CI explicitly selects the reviewed major-1 FILE reference while
preserving both frozen old-line references and their expected rejection reports.
The earlier 1.0.0-alpha.1 preparation supplied verification evidence without an
alpha publication. Published 0.x artifacts remain on their separate contract;
hosts must select compatible descriptor/SDK delivery rather than send new JSON
to an old reader. No registry artifact or service deployment changes merely
because source policy is selected. Tags, uploads, private image/chart publication,
production consumer cutover and deployment require their own approval. The
integrated release artifacts require exact-source packaging and detached checks.

Aion is a downstream consumer, not a Meridian build or runtime dependency.
Its application/installer rollout and whole-repository CI do not gate Meridian's
release. The checked-in Studio catalog remains a renderer fixture; rendering
and testing that fixture does not build or contact Aion. Regenerating it from
its original producer is a separate downstream export. Meridian still owns its declared
SDK contracts, migration notices and first-party consumer checks.

## Rust archives

`meridian-uiview`, `theme-proto`, and `meridian-tui` are the three public Cargo
packages. Their manifests inherit the public monorepo repository metadata.
First-party dependencies carry both local paths and exact registry versions;
Cargo removes workspace paths when normalizing the distributed manifests.
Release version changes must update those pins with the workspace version.
Generated npm manifests likewise pin all declared first-party dependency and
peer edges to that exact version, including explicit old development peer ranges.
Third-party ranges are preserved; similar package-name prefixes are not proof
that a package belongs to this repository's lockstep set.

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

After successful verification, CI retains the three `.crate` files and
`SHA256SUMS` in `rust-packages-<source-commit>` for 30 days. These are review
artifacts, not registry uploads. Download and preserve the approved bytes and
their hashes before their CI retention expires; rebuilding is a new verification
input, not proof of the earlier files' identity.

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
the public imports (including surviving typed facades, canonical envelopes,
and negative checks for removed DTO/host APIs),
bundles the installed browser entrypoints with pinned esbuild, and executes a
browser-DOM smoke test. Installed controls also prove denied canonical targets
ask no consent, admitted targets honor accepted/declined consent, raw zero/false
RPC bindings reach the packaged Rust builder unchanged, and historical-only or
explicitly empty canonical envelopes never revive legacy buttons. Historical
traps are real wire bytes produced with the digest-pinned additive descriptor,
not ignored unknown JSON keys. Metadata alone cannot recover a destination.
This tests the removal candidate; the frozen additive compatibility probes
remain separate. The detached check does not resolve
first-party dependencies from workspace symlinks or publish to npm. CI also
retains all existing renderer, compatibility, and conformance gates.

CI sets `MERIDIAN_WEB_PACKAGE_ARTIFACTS` to retain the exact three tarballs that
passed this consumer (proto-ts, schemas and web) plus `SHA256SUMS`, in
`web-packages-<source-commit>` for 30 days. A local run may set the same variable
to a new output directory whose parent already exists. An existing directory
fails without being cleared. Only successful checks copy these archives; the detached
app and its installed dependencies are excluded. This evidence covers this
three-package consumer, not all seven npm packages or an approved release.

The existing release workflow still publishes only its previous six packages.
Adding this package to an actual release requires an approved release change,
npm ownership/trusted-publisher setup, and verification that the full v1 contract
is ready. Neither tag creation nor publication is authorized by this preparation.
