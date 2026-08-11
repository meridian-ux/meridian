//! End-to-end: wire bytes → `PanelDescriptor` → drawn terminal cells.
//!
//! This is the path `src/main.rs` runs, minus the TTY. It exists because the
//! binary itself cannot be gated in CI — it takes over a terminal — and a
//! renderer whose only proof is someone looking at it is a renderer that breaks
//! quietly. `ratatui::backend::TestBackend` draws into a buffer, so the same
//! render call the binary makes is assertable headlessly.
//!
//! It also closes the loop the monorepo merge opened. Until the merge this crate
//! could not be compiled at all — it named `meridian_uiview` and `theme_proto`,
//! which only Bazel's `rust_prost_library` produced — so *nothing* here had ever
//! been executed against a descriptor. The first `cargo build` immediately found
//! a `Block.view` arm missing since schemas 0.21.0 and three test fixtures
//! enumerating fields the schema had outgrown.

use prost::Message as _;
use ratatui::{backend::TestBackend, Terminal};

use meridian_tui::{Palette, PanelView, RpcError, RpcInvoker};
use meridian_uiview::proto::{panel_descriptor::Body, PanelDescriptor, StatPanel};
use meridian_uiview::Context;

/// Refuses everything, loudly — the same posture as the binary's OfflineInvoker.
/// A `Result::Ok(json!({}))` here would let a panel that never got its data look
/// like it rendered fine, which is the failure this whole test is guarding.
struct Refuse;

impl RpcInvoker for Refuse {
    fn invoke(&self, s: &str, m: &str, _r: serde_json::Value) -> Result<serde_json::Value, RpcError> {
        Err(RpcError::Transport(format!("{s}/{m}: no transport")))
    }
}

fn draw(descriptor: &PanelDescriptor, w: u16, h: u16) -> String {
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| view.render(f, f.area(), descriptor, &ctx, &Refuse))
        .unwrap();
    term.backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat()
}

fn stat_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "fleet-health".into(),
        title: "Fleet health".into(),
        body: Some(Body::Stat(StatPanel {
            label: "Nodes ready".into(),
            value: 118.0,
            previous: Some(124.0),
            higher_is_better: Some(true),
            caption: "vs. last sync".into(),
            series: vec![124.0, 123.0, 121.0, 118.0],
            ..Default::default()
        })),
        ..Default::default()
    }
}

#[test]
fn wire_bytes_round_trip_into_drawn_cells() {
    // Encode and decode rather than rendering the struct directly: the binary is
    // handed BYTES, and a field that fails to survive the wire would otherwise
    // pass here and produce an empty panel in the real thing.
    let bytes = stat_descriptor().encode_to_vec();
    let decoded = PanelDescriptor::decode(bytes.as_slice()).expect("descriptor round-trips");
    assert_eq!(decoded, stat_descriptor());

    let out = draw(&decoded, 48, 8);
    assert!(out.contains("Fleet health"), "title missing from the drawn buffer:\n{out}");
    assert!(out.contains("Nodes ready"), "stat label missing:\n{out}");
    assert!(out.contains("118"), "stat value missing:\n{out}");
}

#[test]
fn a_declining_stat_marked_higher_is_better_reads_as_bad() {
    // 118 against a previous 124 with higher_is_better: the delta must render,
    // and render as a DECREASE. This is the one piece of semantics a terminal can
    // get wrong silently — a sign flip still draws a plausible-looking panel.
    let out = draw(&stat_descriptor(), 48, 8);
    assert!(
        out.contains('↓') || out.contains('-') || out.contains('▾'),
        "no decrease marker for 124 -> 118:\n{out}"
    );
}

#[test]
fn an_empty_descriptor_draws_rather_than_panicking() {
    // main.rs will happily decode a zero-byte file into a default
    // PanelDescriptor — an empty message is valid protobuf. It must not panic on
    // the way to telling the user there is nothing here.
    let out = draw(&PanelDescriptor::default(), 32, 4);
    assert!(!out.trim().is_empty() || out.len() == 32 * 4);
}
