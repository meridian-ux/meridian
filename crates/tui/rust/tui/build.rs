//! Cargo build script: compile meridian.theme.v1 (theme.proto) via prost-build.
//!
//! The Bazel build of meridian-tui pulls `//rust/uiview:theme_proto`
//! (rules_rust_prost over //proto:theme_proto) and selects it via the
//! `bazel_proto` crate-feature. Under cargo there is no rules_rust_prost, so we
//! run prost-build directly here and `include!()` the generated
//! `meridian.theme.v1.rs` from the `theme` module.
//!
//! theme.proto has no imports (pure scalar fields), so unlike uiview's build
//! script no vendored include path is needed.

use std::env;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?).join("../../proto");
    let theme_proto = proto_root.join("theme.proto");

    println!("cargo:rerun-if-changed={}", theme_proto.display());

    // theme.proto uses no imports, so the proto dir itself is the only include
    // path needed.
    prost_build::Config::new().compile_protos(&[theme_proto], &[proto_root])?;

    Ok(())
}
