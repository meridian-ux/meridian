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

The release rehearsal also runs `cargo publish --workspace --dry-run --locked`,
which verifies all three packages without uploading. Cargo handles workspace
dependency order: core and theme before TUI. Registry-name ownership and trusted
publisher setup require separate owner approval before any actual publication.

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

## Complete release rehearsal

`publish.yml` keeps its existing filename for npm trusted-publisher identity.
Its preparation job runs on relevant PRs, version tags, and manual dispatches.
Those events prepare and test artifacts with **contents read only**. Preparation
does not request OIDC credentials or run registry uploads. A tag by itself no
longer publishes; manual dispatch defaults to `publish: false`.
The separate `bootstrap` input also defaults to false. Setting both inputs true
rejects both upload jobs rather than selecting a mode implicitly.

The job retains `release-packages-<checkout-commit>` for 30 days, containing
exactly seven npm tarballs, three crate archives and their existing standard
`SHA256SUMS` file. Package identities, versions and every first-party registry
dependency must agree with `MODULE.bazel`; missing, additional, modified,
private or locally linked packages fail verification. No custom parallel release
manifest is introduced. Preserve the verified files before retention expires.

Reproduce locally after the frozen workspace installation, `pnpm codegen` and
`pnpm core:prepare`:

```sh
bazel build --noannounce_rc --lockfile_mode=error \
  //schemas/proto:proto_ts_pkg //schemas:schemas_pkg \
  //packages/web:pkg //packages/web-react:pkg \
  //packages/chat:pkg //packages/launchpad:pkg
python3 tools/release.py prepare --artifacts /tmp/meridian-release-packages
python3 tools/release.py verify --artifacts /tmp/meridian-release-packages
```

The output directory must be new and its parent must exist. Failures preserve
the detached rehearsal directory for inspection; existing outputs are never
cleared. The real MUI producer builds its declarations into detached staging.
All seven actual tarballs install together without lifecycle scripts, pass
`npm ls`, strict TypeScript 5.7.3 with ESNext/Bundler resolution, a browser bundle,
DOM namespace imports, and a one-proto-ts-root check. This does not claim all-seven
NodeNext support. The existing three-package web check continues to verify
installed invocation behavior and frozen historical-wire traps independently.
Cargo's dry run compiles its actual extracted packages, including unpublished
first-party dependencies. Only a complete passing set reaches the output folder.

## Separately gated publication

No environment, enable flag, registry trust, credential or tag is configured by
this implementation. Before an authorized release, the owner must:

1. Confirm ownership/bootstrap for all seven npm names and three crate names.
   Name availability or a successful local rehearsal does not establish access.
2. Configure each npm trusted publisher for this repository, `publish.yml`, the
   `meridian-release` environment and **direct npm publish** permission. Newer
   npm configurations can be stage-only, which is insufficient for this lane.
   Verify each package's repository identity. Configure crates.io trust for the
   same repository/workflow/environment on all three crates. First publication
   of a new name may require a separately approved owner bootstrap.
3. Create and review the protected `meridian-release` GitHub environment with
   required reviewers and appropriate tag restrictions. The YAML environment
   name alone does not configure those protections. Only then, under separate
   approval, set repository variable `MERIDIAN_RELEASE_PUBLISH_ENABLED=true`.
4. Confirm successful main CI on the selected integrated source, approve a
   version tag matching the module and manually dispatch that tag with
   `publish: true`. Branch dispatches, tag pushes, PRs and an absent enable flag
   cannot run the credential/upload job. The protected environment still needs
   its own approval. Neither setting the flag nor this document authorizes a run.

The upload job downloads only its own workflow run's complete artifact set,
checks hashes/identities, verifies its source SHA, main ancestry and matching tag, then rehearses
Rust again and compares the regenerated crate hashes with the retained files.
The pinned official crates.io action obtains a short-lived credential only when
crate versions are missing, and revokes it in its post step. No registry-token
fallback is added to the normal publication lane. npm uses
OIDC with pinned npm 11.21.1 on Node 22. Registry setup and live authentication
have not been validated by the no-upload tests.

Cargo's actual upload command repackages and verifies the workspace; the tool
also compares resulting archives after it completes. It does not claim Cargo
accepts a prebuilt tarball upload argument. npm publishes the exact verified
tarballs, without lifecycle scripts, in dependency order. Stable versions use
`latest`; prereleases use `next`. There is no atomic transaction across registries.
After any ambiguous/partial upload failure, stop and inspect registry state
before an owner-approved retry. Do not delete tags, unpublish or blindly replay
uploads. Verify all ten registry versions, checksums, imports and Rust consumers
after the separately authorized release before announcing completion.

## Initial-name bootstrap and explicit resume

Both registries' documented trusted-publisher setup requires an existing package.
The initial new-name scope is exactly **`@savvifi/meridian-web`,
`meridian-uiview`, `theme-proto`, and `meridian-tui` at 1.0.0**. Bootstrap is a
distinct, initially disabled token-authenticated path, not a fallback when OIDC
fails. It cannot publish the six existing npm packages or any other version.
Preparing or merging this implementation does not authorize its execution.

The read-only command uses the verified complete artifact set:

```sh
python3 tools/release.py registry-plan --artifacts /path/to/release-packages
```

It sends unauthenticated HTTPS GETs only to npm, crates.io, and the canonical
crates.io static archive host. HTTP 404 means missing; authentication/rate-limit/
server errors, redirects, malformed metadata, timeouts and checksum differences
stop execution. Existing versions must have the exact package identity, registry
checksum and downloaded bytes of the approved archive. npm must also retain the
expected `latest` (stable) or `next` (prerelease) tag; deprecated npm versions and
yanked crates reject. A matching name/version alone is insufficient. Local hashes
and the full seven-plus-three package inventory remain mandatory.

For a future owner-approved first publication, all of these are prerequisites:

1. Verify npm scope creation authority, the exact crates.io owner, availability of
   all four names, and the reviewed 1.0.0 source/tag and same-run artifact set.
   A bootstrap name that already exists without the exact approved version is a
   conflict requiring owner review, not permission to publish to it.
2. Configure the protected `meridian-release` environment with required reviewers,
   tag restrictions, self-review prevention and bypass policy before enabling
   either lane. Each attempt needs its own explicit authority and job approval.
3. Separately approve credential creation and placement. The bootstrap job refers
   to environment secrets `MERIDIAN_BOOTSTRAP_CRATES_TOKEN` and
   `MERIDIAN_BOOTSTRAP_NPM_TOKEN`; this change creates neither secret. Confirm the
   minimum registry-supported new-name scopes and shortest practical expiration.
   If a registry cannot constrain initial creation to these exact names, broader
   credential authority needs explicit review before provisioning. Do not reuse
   the roadmap App key or any unrelated credential.
4. Separately approve `MERIDIAN_RELEASE_BOOTSTRAP_ENABLED=true` and a manual
   matching `v1.0.0` tag dispatch with only `bootstrap: true`. Bootstrap checks its
   own enable/request flags, official repository, manual event, tag, clean exact
   source SHA and main ancestry. Normal publication's enable flag does not enable
   bootstrap, and bootstrap's flag does not enable normal publication.

The bootstrap job has `contents: read`, no OIDC permission, and shares the normal
publication concurrency group. Only its final step receives bootstrap secrets.
Before any upload, the executor scans all ten versions and checks that every
needed credential exists. It passes the crate credential only to Cargo and the
npm credential only to npm, using environment variables rather than arguments or
generated token files. The selected Cargo subset is dry-run verified without
either credential and compared to retained bytes before uploading; Cargo's
verification stays enabled. The existing full-workspace rehearsal still runs.

Bootstrap uploads only missing approved new names: core/theme before TUI, then
the web package. Successful commands require public registry readback of the
same bytes before proceeding. The six existing npm package names remain untouched.
This is an intentionally partial release: web 1.0.0 depends on proto-ts/schemas
1.0.0, so it may not install until the separately approved normal publication
completes. That temporary availability impact belongs in publication approval;
bootstrap success is not release completion or permission to announce v1.

After authorized bootstrap, an owner can configure the four new publisher
records. Then a separately approved normal `publish: true` run uses npm OIDC and,
only if crates are still missing, the pinned crates.io OIDC action. Its preflight
rejects any still-uncreated registry name before requesting that credential.
Both executors re-read all ten versions, skip only verified exact matches, and
upload only their missing authorized subset. Cargo receives explicit package
selection rather than an indiscriminate workspace upload; npm receives the exact
remaining tarballs in dependency order. If everything is already published and
matches, verification completes without upload commands.

A partial/ambiguous upload exception ends the attempt immediately. There is no
automatic retry, sleep, unpublish, tag change or name transfer. An owner must
inspect registry state before authorizing another attempt at the same source and
approved bytes. A new attempt rechecks hashes and actual registry archives; it
does not trust a cached plan or a mutable uploaded-status ledger. A changed
artifact, yanked/deprecated version, moved dist-tag or unknown response stops it.
Rebuilt artifacts must prove equality; never substitute new bytes under an
already-approved version. Restrict/remove the bootstrap flag and credentials
after an owner-approved completion; cleanup itself requires owner authority.
Live authentication, initial-name ownership, and actual uploads remain untested
by the offline fixtures and read-only inventory.

### Preserve original artifacts when retrying a failed upload job

After inspecting registry state and obtaining separate retry approval, rerun
only the failed upload job in its **original workflow run**. The preparation job
must already have succeeded, and its complete artifact must still exist and
match the approved artifact ID, ZIP digest and archive checksums. For example:

```sh
gh run view <original-run-id> --repo meridian-ux/meridian
gh run rerun <original-run-id> --repo meridian-ux/meridian --failed
```

Use this command only when the failed jobs are the approved upload lane. It
reuses the original event, source and inputs; it cannot switch bootstrap into
normal publication or authorize another lane. Required environment approval and
the existing execution guards still apply. Inspect the resulting attempt and
verify all ten registry artifacts before declaring success.

Do not rerun the complete workflow, rerun successful preparation, or dispatch a
fresh workflow as a substitute for this recovery procedure. Fresh builds at the
same commit have produced different schemas tarball bytes. If preparation did
not succeed, artifacts expired, or the original approved set cannot be verified,
stop for a reviewed recovery plan; never replace bytes for an existing version.
The publication-free [retry experiment](https://github.com/meridian-ux/meridian/actions/runs/40617273020)
verified that a failed-job-only second attempt reused the original artifact ID
and digest. It did not exercise registry credentials or an actual upload.

Protocol activation, private integration, live roadmap automation, image/chart
publication and deployment remain separate gates.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites),
[crates.io trusted publishing](https://crates.io/docs/trusted-publishing),
[Cargo publish](https://doc.rust-lang.org/cargo/commands/cargo-publish.html), and
[official crates.io authentication action](https://github.com/rust-lang/crates-io-auth-action).
