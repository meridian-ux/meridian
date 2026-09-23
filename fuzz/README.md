# uiview-core descriptor fuzzing

Install `cargo-fuzz` with `cargo install cargo-fuzz --locked`, then run the
descriptor decoder and the table/gallery consumers against the committed E6
conformance corpus:

```sh
cargo fuzz run panel_descriptor schemas/conformance/binpb
```

LibFuzzer adds mutations of those canonical wire fixtures while retaining
crashing inputs in the supplied corpus directory. Keep minimized regressions in
the corpus so they remain seeds for future runs. The actual WebAssembly artifact
has a separate boundary regression in `packages/web/tests/conformance_wasm.test.ts`;
it calls the compiled exports with malformed and future-arm protobuf bytes rather
than mocking the bridge.

For a toolchain-independent compile check that does not run the sanitizer:

```sh
cargo check --manifest-path fuzz/Cargo.toml --bin panel_descriptor
```
