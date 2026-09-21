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

use crossterm::event::KeyCode;
use prost::Message as _;
use ratatui::{backend::TestBackend, Terminal};

use meridian_tui::{Palette, PanelView, RpcError, RpcInvoker};
use meridian_uiview::proto::{
    form_field::Kind, panel_descriptor::Body, CardSpec, DescriptorRow, DetailHeaderPanel,
    FormField, FormMode, FormPanel, GalleryPanel, IntegerSpinner, PanelDescriptor,
    RecordCardPanel, RpcCall, StatPanel, TextInput,
};
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

struct GalleryData;

impl RpcInvoker for GalleryData {
    fn invoke(
        &self,
        _service: &str,
        _method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "items": [{
                "name": "GitHub",
                "description": "Source control",
                "status": "Connected",
                "href": "https://github.com"
            }]
        }))
    }
}

struct RecordData;

impl RpcInvoker for RecordData {
    fn invoke(
        &self,
        _service: &str,
        _method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "name": "Build 42",
            "owner": "Platform",
            "phase": "Running",
            "metadata": {"region": "us-east"}
        }))
    }
}

struct FormData;

impl RpcInvoker for FormData {
    fn invoke(
        &self,
        _service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        if method == "Prefill" {
            Ok(serde_json::json!({"name": "worker", "replicas": 2}))
        } else {
            Err(RpcError::UnknownMethod {
                service: "demo.Deploy".into(),
                method: method.into(),
            })
        }
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

fn gallery_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "integrations".into(),
        title: "Integrations".into(),
        body: Some(Body::Gallery(GalleryPanel {
            populate: Some(RpcCall {
                service: "demo.Catalog".into(),
                method: "List".into(),
                ..Default::default()
            }),
            rows_field: "items".into(),
            card: Some(CardSpec {
                title_field: "name".into(),
                subtitle_field: "description".into(),
                status_field: "status".into(),
                href_field: "href".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn detail_header_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "build-header".into(),
        title: "Build".into(),
        body: Some(Body::DetailHeader(DetailHeaderPanel {
            title: "Build".into(),
            title_source_path: "name".into(),
            subtitle_source_path: "owner".into(),
            status_source_path: "phase".into(),
            descriptor_rows: vec![DescriptorRow {
                label: "Region".into(),
                source_path: "metadata.region".into(),
                ..Default::default()
            }],
            populate: Some(RpcCall {
                service: "demo.Builds".into(),
                method: "Get".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn record_card_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "build-card".into(),
        title: "Build details".into(),
        body: Some(Body::RecordCard(RecordCardPanel {
            item_noun: "build".into(),
            fields: vec![
                FormField {
                    field_id: "name".into(),
                    label: "Name".into(),
                    ..Default::default()
                },
                FormField {
                    field_id: "metadata.region".into(),
                    label: "Region".into(),
                    ..Default::default()
                },
            ],
            populate: Some(RpcCall {
                service: "demo.Builds".into(),
                method: "Get".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn form_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-form".into(),
        title: "Deployment".into(),
        body: Some(Body::Form(FormPanel {
            fields: vec![
                FormField {
                    field_id: "name".into(),
                    label: "Name".into(),
                    request_field: "name".into(),
                    kind: Some(Kind::Text(TextInput {
                        default_value: "service".into(),
                        ..Default::default()
                    })),
                    ..Default::default()
                },
                FormField {
                    field_id: "replicas".into(),
                    label: "Replicas".into(),
                    request_field: "replicas".into(),
                    kind: Some(Kind::Integer(IntegerSpinner {
                        default_value: 1,
                        min: 1,
                        max: 10,
                        ..Default::default()
                    })),
                    ..Default::default()
                },
            ],
            mode: FormMode::Edit as i32,
            submit: Some(RpcCall {
                service: "demo.Deploy".into(),
                method: "Apply".into(),
                ..Default::default()
            }),
            item_noun: "deployment".into(),
            prefill: Some(RpcCall {
                service: "demo.Deploy".into(),
                method: "Prefill".into(),
                ..Default::default()
            }),
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
fn gallery_populate_flows_into_the_tui_card_list() {
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(64, 10)).unwrap();
    term.draw(|f| {
        view.render(
            f,
            f.area(),
            &gallery_descriptor(),
            &ctx,
            &GalleryData,
        )
    })
    .unwrap();
    let out = term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(out.contains("GitHub"), "gallery title missing:\n{out}");
    assert!(out.contains("Connected"), "gallery status missing:\n{out}");
    assert!(out.contains("https://github.com"), "gallery href missing:\n{out}");
}

#[test]
fn detail_panels_populate_and_render_the_record_dispatch_path() {
    let ctx = Context::default();
    let mut header = PanelView::with_palette(Palette::default());
    let mut header_term = Terminal::new(TestBackend::new(64, 9)).unwrap();
    header_term
        .draw(|f| {
            header.render(
                f,
                f.area(),
                &detail_header_descriptor(),
                &ctx,
                &RecordData,
            )
        })
        .unwrap();
    let header_out = header_term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(header_out.contains("Build 42"));
    assert!(header_out.contains("[Running]"));
    assert!(header_out.contains("Region: us-east"));

    let mut card = PanelView::with_palette(Palette::default());
    let mut card_term = Terminal::new(TestBackend::new(64, 8)).unwrap();
    card_term
        .draw(|f| {
            card.render(
                f,
                f.area(),
                &record_card_descriptor(),
                &ctx,
                &RecordData,
            )
        })
        .unwrap();
    let card_out = card_term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(card_out.contains("Name: Build 42"));
    assert!(card_out.contains("Region: us-east"));
}

#[test]
fn an_empty_descriptor_draws_rather_than_panicking() {
    // main.rs will happily decode a zero-byte file into a default
    // PanelDescriptor — an empty message is valid protobuf. It must not panic on
    // the way to telling the user there is nothing here.
    let out = draw(&PanelDescriptor::default(), 32, 4);
    assert!(!out.trim().is_empty() || out.len() == 32 * 4);
}
