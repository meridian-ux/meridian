// meridian-uiview: platform-neutral core for the Meridian proto-driven
// UI framework.
//
// What it provides:
//   * prost-generated Rust types for meridian.ui.v1 (PanelDescriptor +
//     friends). Accessible at `meridian_uiview::proto::*`.
//   * `ProtoPaths` — field-path accessor over prost Message instances.
//     Drives TableColumn.field_path and FieldBinding.row_field
//     resolution.
//   * `RequestBuilder` — turns an RpcCall + runtime context into a
//     serde_json::Value request the host can submit over gRPC-Web /
//     gRPC / whatever.
//   * `filter_launchpad` — the Launchpad descriptor's fuzzy filter +
//     ranking (the Rust twin of @savvifi/meridian-launchpad's
//     src/filter.ts, so a query ranks identically in every modality).
//   * `ConversationModel` — the ConversationEvent streaming model:
//     dedup by seq, upsert blocks by block_id (the Rust twin of
//     @savvifi/meridian-chat's src/model.ts).
//
// Two consumers:
//   * `meridian-tui` — native Rust ratatui renderer. Uses these
//     helpers directly.
//   * The TS web renderer — imports a wasm-bindgen wrapper compiled
//     from this crate's `wasm` feature. The DOM lives on the JS
//     side; this crate handles all proto-walking + request building.
//
// All types here are platform-neutral: no JavaFX, no DOM, no terminal
// dependencies. Renderers layer those on top.

/// prost-generated types for meridian.ui.v1.
///
/// TWO codegen paths producing the same surface, mirroring `meridian-mcp`'s
/// `src/proto.rs` and `meridian-proto`'s `build.rs`:
///
///   * **Bazel** (`--cfg=bazel_proto`, set in `BUILD.bazel`) — the
///     `rust_prost_library` `//rust/uiview:uiview_proto` over
///     `@meridian_schemas//proto:uiview_proto`. Bazel remains the authority:
///     adding a proto to `//proto:uiview_proto` flows through automatically, with
///     no hand-maintained `srcs` list to drift against proto/BUILD.bazel.
///   * **cargo** (default) — `build.rs` runs prost-build over the committed
///     `proto/gen/meridian_ui_v1.binpb`, which is that same proto_library's
///     output checked in. No protoc required.
///
/// The cargo path is not a nicety. Without it this crate cannot be built by
/// cargo at all, which is why `meridian-tui` — which depends on it — has no
/// `[[bin]]` and cannot be run. Both paths land the types at
/// `meridian_uiview::proto::*`, so nothing downstream cares which ran.
#[cfg(bazel_proto)]
#[allow(clippy::large_enum_variant)]
pub mod proto {
    pub use uiview_proto::meridian::ui::v1::*;
}

#[cfg(not(bazel_proto))]
#[allow(clippy::large_enum_variant)]
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/meridian.ui.v1.rs"));
}

mod affordance;
mod conversation;
mod form_values;
mod launchpad;
pub mod legacy;
#[cfg(not(target_arch = "wasm32"))]
pub mod native_api;
mod paths;
mod payload_budget;
mod render;
mod render_limits;
mod request;
mod stat;
mod static_view;
mod stream;

#[cfg(target_arch = "wasm32")]
mod wasm_input;

#[cfg(test)]
mod conformance;

pub use affordance::row_filter_matches;
pub use conversation::{is_active_status, ConversationModel};
pub use form_values::validate_form_values;
pub use launchpad::{command_haystack, filter_launchpad, flatten, match_score, FilteredGroup};
pub use paths::ProtoPaths;
pub use payload_budget::{
    PayloadBudget, PayloadLimitExceeded, DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_PAYLOAD_RATE,
};
pub use render::{
    format_cell, format_display_value, format_display_value_with_context,
    format_display_value_with_metadata, format_inferred_value, format_lro_metadata,
    format_summary_number, format_value, render_gallery, render_table,
    try_format_relative_timestamp, try_format_timestamp, RenderedCard, RenderedRow,
};
pub use render_limits::{
    admit_formatted_value, render_gallery_bounded, render_resource_cards_bounded,
    render_table_bounded, RenderLimitExceeded,
};
pub use request::{
    Context, RequestBudget, RequestBuilder, RequestLimitExceeded, RequestOverrides, SubmissionKind,
};
pub use stat::{
    compute_stat, compute_stat_with_response, format_stat_number, trend_arrow, StatComputed,
    StatSemantics, StatTrend,
};
pub use static_view::{static_view_text, StaticViewError};
pub use stream::{
    stream_frame_data, stream_frame_from_json, StreamError, StreamInvoker, StreamSession,
};

// Re-export the prost crate so downstream consumers can decode our
// generated message types (e.g. `PanelBundle`) without introducing a
// second prost instance from their own crate universe. Bazel's
// isolated `@crates::prost` would otherwise produce trait-distinct
// `Message` impls and `PanelBundle::decode` would not resolve.
pub use prost;

#[cfg(test)]
mod tone_contract {
    use super::proto::{Tone, ValueTone};

    #[test]
    fn shared_tone_retains_every_legacy_numeric_assignment() {
        for (tone, legacy, name) in [
            (Tone::Unspecified, ValueTone::Unspecified, "UNSPECIFIED"),
            (Tone::Neutral, ValueTone::Neutral, "NEUTRAL"),
            (Tone::Info, ValueTone::Info, "INFO"),
            (Tone::Success, ValueTone::Success, "SUCCESS"),
            (Tone::Warning, ValueTone::Warning, "WARNING"),
            (Tone::Danger, ValueTone::Danger, "DANGER"),
            (Tone::Accent, ValueTone::Accent, "ACCENT"),
        ] {
            assert_eq!(tone as i32, legacy as i32);
            assert_eq!(tone.as_str_name(), format!("TONE_{name}"));
            assert_eq!(legacy.as_str_name(), format!("VALUE_TONE_{name}"));
        }
        assert!(Tone::try_from(999).is_err());
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm_api;
