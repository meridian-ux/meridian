# uiview-core descriptor fuzzing

Use nightly-2026-04-29 and cargo-fuzz 0.13.2 (the CI pins). The target decodes
PanelDescriptor, TablePanel, GalleryPanel, RpcCall, and ValueDisplay. It exercises
core table/gallery rendering with a populated response, request binding, and
formatting of text, numeric, and null values with an explicit clock. This is not
a full native widget or all-input security audit. Seed a **scratch** corpus from
the E6 panels and typed core wire cases:

```sh
rustup toolchain install nightly-2026-04-29 --profile minimal
FUZZ_WORK="$(mktemp -d)"
cargo +nightly-2026-04-29 install cargo-fuzz --version 0.13.2 --locked --root "$FUZZ_WORK/tools"
mkdir -p "$FUZZ_WORK/corpus" "$FUZZ_WORK/artifacts"
node --test fuzz/seed_corpus.test.mjs
node fuzz/seed_corpus.mjs "$FUZZ_WORK/corpus"
cargo +nightly-2026-04-29 fetch --locked --manifest-path fuzz/Cargo.toml
RUSTUP_TOOLCHAIN=nightly-2026-04-29 CARGO_NET_OFFLINE=true "$FUZZ_WORK/tools/bin/cargo-fuzz" run \
  --fuzz-dir fuzz --target-dir "$FUZZ_WORK/target" --sanitizer address \
  panel_descriptor "$FUZZ_WORK/corpus" -- \
  -max_total_time=60 -timeout=5 -rss_limit_mb=2048 -max_len=65536 \
  -seed=1 -verbosity=0 -print_final_stats=1 \
  -artifact_prefix="$FUZZ_WORK/artifacts/"
git diff --exit-code -- Cargo.lock fuzz/Cargo.lock schemas/conformance/binpb
```

LibFuzzer adds interesting mutations to the scratch corpus, not the committed
fixtures. Crashes go to the explicit artifact directory; minimize and promote
real regressions into deterministic tests and canonical protobuf seeds. CI runs
this bounded address-sanitized campaign in addition to the stable compile check
and preserves crash reproducers. A successful minute is evidence of that smoke
run, not a proof that every possible descriptor is safe.

The actual WebAssembly artifact has deterministic mutations in
`packages/web/tests/conformance_wasm.test.ts`: every typical E6 panel arm plus
typed RPC/table/gallery/display seeds cross all seven binary decoder exports.
Truncation, invalid wire tags, overlong varints, future fields, and byte flips
may return valid results or ordinary errors, but must not trap or overflow the
JavaScript stack. These tests run under the real Bazel-built bridge, not mocks.

For a toolchain-independent compile check that does not run the sanitizer:

```sh
cargo check --manifest-path fuzz/Cargo.toml --bin panel_descriptor
```
