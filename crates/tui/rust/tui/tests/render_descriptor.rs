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

#![allow(clippy::needless_update)]

use std::path::PathBuf;

use crossterm::event::KeyCode;
use prost::Message as _;
use ratatui::{backend::TestBackend, Terminal};

use meridian_tui::{Palette, PanelView, RpcError, RpcInvoker};
use meridian_uiview::proto::{
    form_field::Kind, panel_descriptor::Body, CardSpec, DescriptorRow, DetailHeaderPanel,
    FormField, FormMode, FormPanel, GalleryPanel, IntegerSpinner, LroPanel, MediaChapter,
    MediaPanel, PanelDescriptor, RecordCardPanel, RpcCall, StatPanel, TextInput,
};
use meridian_uiview::Context;

/// Refuses everything, loudly — the same posture as the binary's OfflineInvoker.
/// A `Result::Ok(json!({}))` here would let a panel that never got its data look
/// like it rendered fine, which is the failure this whole test is guarding.
struct Refuse;

impl RpcInvoker for Refuse {
    fn invoke(
        &self,
        s: &str,
        m: &str,
        _r: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Err(RpcError::Transport(format!("{s}/{m}: no transport")))
    }
}

struct GalleryData;

#[test]
fn selected_row_action_requests_use_wire_bindings_without_changing_raw_values() {
    use meridian_uiview::proto::{field_binding::Source, FieldBinding, NestedBinding};
    use serde_json::json;
    struct Rows;
    impl RpcInvoker for Rows {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            Ok(
                json!({"claims": [{"id": 0, "member": "Ada", "enabled": false,
                "amount": "0012.50", "metadata": {"count": 0}}, {"member": "Grace"}],
                "services": [{"id": 0, "member": "Ada", "enabled": false,
                "amount": "0012.50", "metadata": {"count": 0}}, {"member": "Grace"}]}),
            )
        }
    }
    let binding = |name: &str, source| FieldBinding {
        request_field: name.into(),
        source: Some(source),
    };
    let call = RpcCall {
        service: "demo.Actions".into(),
        method: "Run".into(),
        bindings: vec![
            binding("tenant", Source::Literal("demo".into())),
            binding("enabled", Source::RowField("enabled".into())),
            binding("amount", Source::RowField("amount".into())),
            binding("missing", Source::RowField("absent".into())),
            binding(
                "details",
                Source::Nested(NestedBinding {
                    fields: vec![
                        binding("count", Source::RowField("metadata.count".into())),
                        binding("scope", Source::SelectionKey("scope".into())),
                    ],
                }),
            ),
        ],
    };
    let bytes = call.encode_to_vec();
    let call = RpcCall::decode(bytes.as_slice()).unwrap();
    let mut context = Context {
        selected_row: Some(json!({"id": "stale"})),
        ..Default::default()
    };
    context.selections.insert("scope".into(), json!(false));
    for fixture in ["table.binpb", "resource_cards.binpb"] {
        let descriptor =
            PanelDescriptor::decode(read_canonical_fixture(fixture).as_slice()).unwrap();
        let mut view = PanelView::new();
        assert_eq!(view.selected_row_request(&call, &context, true), None);
        let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
        terminal
            .draw(|frame| view.render(frame, frame.area(), &descriptor, &context, &Rows))
            .unwrap();
        if view.selected_row().is_none() {
            view.select_next();
        }
        let before = view.selected_row().unwrap().clone();
        assert_eq!(
            view.selected_row_request(&call, &context, true),
            Some(json!({
                "tenant": "demo", "enabled": false, "amount": "0012.50", "details": {"count": 0, "scope": false}
            }))
        );
        let unbound = RpcCall {
            bindings: vec![],
            ..call.clone()
        };
        assert_eq!(
            view.selected_row_request(&unbound, &context, true),
            Some(json!({"id": 0}))
        );
        assert_eq!(
            view.selected_row_request(&unbound, &context, false),
            Some(json!({}))
        );
        assert_eq!(view.selected_row(), Some(&before));
        view.select_next();
        assert_eq!(
            view.selected_row_request(&unbound, &context, true),
            Some(json!({}))
        );
        assert_eq!(context.selected_row, Some(json!({"id": "stale"})));
        assert_eq!(call.encode_to_vec(), bytes);
    }
}

struct TableData;

impl RpcInvoker for TableData {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        assert_eq!((service, method), ("demo.Claims", "List"));
        Ok(serde_json::json!({"claims": [
            {"member": "Ada", "amount": "0012.50", "enabled": true, "website": "https://example.com/ada"},
            {"member": "Grace", "amount": "0007.00", "enabled": false, "website": "javascript:alert(1)"}
        ]}))
    }
}

impl RpcInvoker for GalleryData {
    fn invoke(
        &self,
        _service: &str,
        _method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "items": [
                {"name": "GitHub", "description": "Source control", "status": "Connected", "href": "https://github.com", "action": "Manage"},
                {"name": "PagerDuty", "description": "Incident response", "status": "Connected", "href": "https://pagerduty.com", "action": "Manage"}
            ]
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

struct ResourceCardsData;

impl RpcInvoker for ResourceCardsData {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        assert_eq!((service, method), ("demo.Services", "List"));
        Ok(serde_json::json!({
            "services": [
                {"name": "GitHub", "description": "Source control"},
                {"name": "PagerDuty", "description": "Incident response"}
            ]
        }))
    }
}

fn draw(descriptor: &PanelDescriptor, w: u16, h: u16) -> String {
    draw_with(descriptor, w, h, &Refuse)
}

fn draw_with<I: RpcInvoker>(descriptor: &PanelDescriptor, w: u16, h: u16, invoker: &I) -> String {
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| view.render(f, f.area(), descriptor, &ctx, invoker))
        .unwrap();
    term.backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat()
}

const CANONICAL_FIXTURES: &[(&str, &str)] = &[
    ("table", "table.binpb"),
    ("lro", "lro.binpb"),
    ("adhoc", "adhoc.binpb"),
    ("prompt", "prompt.binpb"),
    ("llm_prompt", "llm_prompt.binpb"),
    ("gallery", "gallery.binpb"),
    ("form", "form.binpb"),
    ("detail_header", "detail_header.binpb"),
    ("record_card", "record_card.binpb"),
    ("resource_cards", "resource_cards.binpb"),
    ("chart", "chart.binpb"),
    ("steps", "steps.binpb"),
    ("media", "media.binpb"),
    ("stream", "stream.binpb"),
    ("choice", "choice.binpb"),
    ("snippet", "snippet.binpb"),
    ("action", "action.binpb"),
    ("connect_flow", "connect_flow.binpb"),
    ("copy_value", "copy_value.binpb"),
    ("catalog", "catalog.binpb"),
    ("stat", "stat.binpb"),
    ("terminal", "terminal.binpb"),
    ("grammar", "grammar.binpb"),
    ("(unset)", "empty.binpb"),
];

fn read_canonical_fixture(filename: &str) -> Vec<u8> {
    let mut candidates = vec![PathBuf::from("schemas/conformance/binpb").join(filename)];
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        candidates.push(
            PathBuf::from(manifest_dir)
                .join("../../../../schemas/conformance/binpb")
                .join(filename),
        );
    }
    candidates
        .into_iter()
        .find_map(|path| std::fs::read(&path).ok())
        .unwrap_or_else(|| {
            panic!(
                "canonical fixture {filename} is missing; run schemas/tools/write_conformance_binpb.mjs"
            )
        })
}

fn body_name(descriptor: &PanelDescriptor) -> &'static str {
    match descriptor.body.as_ref() {
        Some(Body::Table(_)) => "table",
        Some(Body::Lro(_)) => "lro",
        Some(Body::Adhoc(_)) => "adhoc",
        Some(Body::Prompt(_)) => "prompt",
        Some(Body::LlmPrompt(_)) => "llm_prompt",
        Some(Body::Gallery(_)) => "gallery",
        Some(Body::Form(_)) => "form",
        Some(Body::DetailHeader(_)) => "detail_header",
        Some(Body::RecordCard(_)) => "record_card",
        Some(Body::ResourceCards(_)) => "resource_cards",
        Some(Body::Chart(_)) => "chart",
        Some(Body::Steps(_)) => "steps",
        Some(Body::Media(_)) => "media",
        Some(Body::Stream(_)) => "stream",
        Some(Body::Choice(_)) => "choice",
        Some(Body::Snippet(_)) => "snippet",
        Some(Body::Action(_)) => "action",
        Some(Body::ConnectFlow(_)) => "connect_flow",
        Some(Body::CopyValue(_)) => "copy_value",
        Some(Body::Catalog(_)) => "catalog",
        Some(Body::Stat(_)) => "stat",
        Some(Body::Terminal(_)) => "terminal",
        Some(Body::Grammar(_)) => "grammar",
        None => "(unset)",
    }
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

fn lro_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-run".into(),
        title: "Run deployment".into(),
        body: Some(Body::Lro(LroPanel {
            start: Some(RpcCall {
                service: "demo.Deploy".into(),
                method: "Start".into(),
                ..Default::default()
            }),
            metadata_type: "demo.DeployMetadata".into(),
            response_type: "demo.DeployResponse".into(),
            run_button_label: "Deploy".into(),
            inputs: vec![FormField {
                field_id: "replicas".into(),
                label: "Replicas".into(),
                request_field: "replicas".into(),
                kind: Some(Kind::Integer(IntegerSpinner {
                    default_value: 1,
                    min: 1,
                    max: 5,
                    ..Default::default()
                })),
                ..Default::default()
            }],
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn media_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-recording".into(),
        title: "Deployment recording".into(),
        body: Some(Body::Media(MediaPanel {
            src_uri: "https://cdn.example.test/deploy.mp4".into(),
            alt: "A deployment progressing from build to ready.".into(),
            captions_uri: "https://cdn.example.test/deploy.vtt".into(),
            duration_ms: 125_000,
            caption: "Deployment walkthrough".into(),
            chapters: vec![MediaChapter {
                start_ms: 65_000,
                label: "Ready".into(),
            }],
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
    assert!(
        out.contains("Fleet health"),
        "title missing from the drawn buffer:\n{out}"
    );
    assert!(out.contains("Nodes ready"), "stat label missing:\n{out}");
    assert!(out.contains("118"), "stat value missing:\n{out}");
}

#[test]
fn canonical_binpb_corpus_reaches_every_tui_dispatch_arm() {
    // These are the exact bytes emitted from schemas/conformance/fixtures.ts,
    // not Rust-authored equivalents. Decoding and drawing every one proves the
    // native renderer consumes the shared protobuf corpus and preserves its
    // documented placeholder/degradation cases.
    for (expected, filename) in CANONICAL_FIXTURES {
        let bytes = read_canonical_fixture(filename);
        let descriptor = PanelDescriptor::decode(bytes.as_slice())
            .unwrap_or_else(|error| panic!("{filename} is not a PanelDescriptor: {error}"));
        assert_eq!(
            body_name(&descriptor),
            *expected,
            "fixture {filename} decoded to the wrong body arm"
        );

        let output = draw(&descriptor, 96, 12);
        assert!(
            output.contains(&descriptor.title),
            "{filename} did not render its title {:?}:\n{output}",
            descriptor.title
        );
        if *expected == "(unset)" {
            assert!(
                output.contains("(no body set)"),
                "empty fixture lost its degradation"
            );
        } else {
            assert!(
                !output.contains("(no body set)"),
                "{filename} fell through to the empty-body degradation"
            );
        }
    }
}

#[test]
fn canonical_long_copy_value_preserves_text_at_sufficient_width() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("copy_value.binpb").as_slice()).unwrap();
    let Some(Body::CopyValue(panel)) = &descriptor.body else {
        panic!("expected copy value")
    };
    let value = panel.value.as_ref().unwrap();
    assert!(value.value.len() > 160);
    let output = draw(&descriptor, 512, 16);
    assert!(output.contains(&descriptor.title));
    assert!(output.contains(&value.label));
    assert!(output.contains(&value.value));
    // Narrow terminals may clip or wrap. Their viewport must remain renderable;
    // full content preservation is asserted above, not inferred from clipping.
    assert!(!draw(&descriptor, 32, 8).is_empty());
}

#[test]
fn canonical_resource_cards_fixture_renders_populated_rows() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("resource_cards.binpb").as_slice())
            .expect("resource-card fixture decodes");
    let output = draw_with(&descriptor, 72, 16, &ResourceCardsData);
    assert!(output.contains("GitHub"));
    assert!(output.contains("Source control"));
    assert!(output.contains("PagerDuty"));
    assert!(output.contains("Incident response"));
    assert!(!output.contains("Failed to load resources"));
}

#[test]
fn canonical_gallery_fixture_renders_populated_rows() {
    let descriptor = PanelDescriptor::decode(read_canonical_fixture("gallery.binpb").as_slice())
        .expect("gallery fixture decodes");
    let output = draw_with(&descriptor, 72, 16, &GalleryData);
    assert!(output.contains("GitHub"));
    assert!(output.contains("Source control"));
    assert!(output.contains("PagerDuty"));
    assert!(output.contains("Incident response"));
    assert!(!output.contains("Failed to load gallery"));
}

#[test]
fn canonical_table_fixture_renders_populated_rows() {
    let descriptor = PanelDescriptor::decode(read_canonical_fixture("table.binpb").as_slice())
        .expect("table fixture decodes");
    let output = draw_with(&descriptor, 160, 20, &TableData);
    for text in ["Ada", "Grace", "0012.50", "0007.00", "Yes", "No"] {
        assert!(output.contains(text), "missing {text}: {output}");
    }
    assert!(!output.contains("no claims"));
}

// Preserve row boundaries while discarding terminal padding. These text goldens
// cover content and ordering, not colors or interactive navigation.
fn terminal_lines(output: &str, width: usize) -> Vec<String> {
    output
        .chars()
        .collect::<Vec<_>>()
        .chunks(width)
        .map(|row| {
            row.iter()
                .collect::<String>()
                .trim_matches('│')
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|row| !row.starts_with(['┌', '└']))
        .filter(|row| !row.is_empty())
        .collect()
}

#[test]
fn canonical_populated_native_text_goldens() {
    for name in ["gallery", "table", "resource_cards"] {
        let descriptor =
            PanelDescriptor::decode(read_canonical_fixture(&format!("{name}.binpb")).as_slice())
                .unwrap();
        let output = if name == "gallery" {
            draw_with(&descriptor, 160, 20, &GalleryData)
        } else if name == "resource_cards" {
            draw_with(&descriptor, 160, 20, &ResourceCardsData)
        } else {
            draw_with(&descriptor, 160, 20, &TableData)
        };
        let expected = if name == "gallery" {
            vec![
                "Assets",
                "▶ 1. GitHub [Connected]",
                "Source control",
                "[1] Manage https://github.com",
                "2. PagerDuty [Connected]",
                "Incident response",
                "[2] Manage https://pagerduty.com",
            ]
        } else if name == "resource_cards" {
            vec![
                "Services",
                "▶ 1. GitHub",
                "Source control",
                "2. PagerDuty",
                "Incident response",
            ]
        } else {
            // URLs remain noninteractive scalar text in the native table.
            vec![
                "Claims",
                "2",
                "Member Amount Enabled Website",
                "Ada 0012.50 Yes https://example.com/ada",
                "Grace 0007.00 No javascript:alert(1)",
            ]
        };
        assert_eq!(terminal_lines(&output, 160), expected, "{name}");
    }
}

struct EmptyData;
impl RpcInvoker for EmptyData {
    fn invoke(
        &self,
        _: &str,
        _: &str,
        _: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({"items": [], "claims": [], "services": []}))
    }
}

#[test]
fn canonical_native_empty_and_absent_populate_states() {
    for name in ["gallery", "table", "resource_cards"] {
        let mut descriptor =
            PanelDescriptor::decode(read_canonical_fixture(&format!("{name}.binpb")).as_slice())
                .unwrap();
        let empty = if name == "gallery" {
            vec!["Assets", "no assets"]
        } else if name == "resource_cards" {
            vec!["Services", "No services"]
        } else {
            vec!["Claims", "0", "Member Amount Enabled Website"]
        };
        assert_eq!(
            terminal_lines(&draw_with(&descriptor, 160, 20, &EmptyData), 160),
            empty,
            "{name} empty"
        );
        match descriptor.body.as_mut().unwrap() {
            Body::Gallery(panel) => panel.populate = None,
            Body::Table(panel) => panel.populate = None,
            Body::ResourceCards(panel) => panel.populate = None,
            _ => unreachable!(),
        }
        let absent = if name == "gallery" {
            vec!["Assets", "Gallery panel has no populate RPC."]
        } else if name == "resource_cards" {
            vec!["Services", "Resource-card panel has no populate RPC."]
        } else {
            vec!["Claims", "0", "Member Amount Enabled Website"]
        };
        assert_eq!(
            terminal_lines(&draw(&descriptor, 160, 20), 160),
            absent,
            "{name} absent"
        );
    }
}

#[test]
fn canonical_resource_cards_transport_failure_text_golden() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("resource_cards.binpb").as_slice())
            .expect("resource-card fixture decodes");
    assert_eq!(
        terminal_lines(&draw(&descriptor, 160, 20), 160),
        vec![
            "Services",
            "Failed to load resources: transport: demo.Services/List: no transport",
        ]
    );
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
    term.draw(|f| view.render(f, f.area(), &gallery_descriptor(), &ctx, &GalleryData))
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
    assert!(
        out.contains("https://github.com"),
        "gallery href missing:\n{out}"
    );
}

#[test]
fn declared_record_links_survive_wire_decode_and_render_as_noninteractive_metadata() {
    use meridian_uiview::proto::{
        value_display::Options, PrincipalOptions, TableColumn, TablePanel, ValueDisplay, ValueLink,
        ValueType,
    };
    use std::cell::Cell;
    struct Data(Cell<usize>);
    impl RpcInvoker for Data {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            self.0.set(self.0.get() + 1);
            let record = serde_json::json!({"owner": "Name <name@example.com>"});
            Ok(serde_json::json!({"owner": record["owner"], "items": [record]}))
        }
    }
    for (link, linked) in [
        (None, true),
        (
            Some(ValueLink {
                target_kind: "identity.user".into(),
            }),
            true,
        ),
        (Some(ValueLink::default()), false),
    ] {
        let display = ValueDisplay {
            r#type: ValueType::Principal as i32,
            options: Some(Options::Principal(PrincipalOptions {
                target_kind: "identity.user".into(),
                link_to_record: true,
                ..Default::default()
            })),
            link,
        };
        let populate = Some(RpcCall {
            service: "demo.Users".into(),
            method: "Get".into(),
            ..Default::default()
        });
        let bodies = [
            Body::DetailHeader(DetailHeaderPanel {
                populate: populate.clone(),
                descriptor_rows: vec![DescriptorRow {
                    label: "Owner".into(),
                    source_path: "owner".into(),
                    display: Some(display.clone()),
                }],
                ..Default::default()
            }),
            Body::RecordCard(RecordCardPanel {
                populate: populate.clone(),
                fields: vec![FormField {
                    field_id: "owner".into(),
                    label: "Owner".into(),
                    display: Some(display.clone()),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            Body::Table(TablePanel {
                populate,
                rows_field: "items".into(),
                columns: vec![TableColumn {
                    header: "Owner".into(),
                    field_path: "owner".into(),
                    value_display: Some(display),
                    ..Default::default()
                }],
                ..Default::default()
            }),
        ];
        for body in bodies {
            let descriptor = PanelDescriptor {
                panel_id: "linked".into(),
                body: Some(body),
                ..Default::default()
            };
            let decoded = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
            let data = Data(Cell::new(0));
            let mut view = PanelView::default();
            let mut terminal = Terminal::new(TestBackend::new(110, 12)).unwrap();
            terminal
                .draw(|f| view.render(f, f.area(), &decoded, &Context::default(), &data))
                .unwrap();
            let text = terminal
                .backend()
                .buffer()
                .content()
                .iter()
                .map(|c| c.symbol())
                .collect::<String>();
            assert!(text.contains("Name"), "{text}");
            assert_eq!(text.contains("[record:"), linked, "{text}");
            if linked {
                assert!(
                    text.contains("[record: \"identity.user\" id=\"Name <name@example.com>\"]"),
                    "{text}"
                );
            }
            assert_eq!(data.0.get(), 1, "link decoration must not invoke an RPC");
        }
    }
}

#[test]
fn detail_panels_populate_and_render_the_record_dispatch_path() {
    let ctx = Context::default();
    let mut header = PanelView::with_palette(Palette::default());
    let mut header_term = Terminal::new(TestBackend::new(64, 9)).unwrap();
    header_term
        .draw(|f| header.render(f, f.area(), &detail_header_descriptor(), &ctx, &RecordData))
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
        .draw(|f| card.render(f, f.area(), &record_card_descriptor(), &ctx, &RecordData))
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
fn form_prefill_renders_and_submit_contains_edited_values() {
    let descriptor = form_descriptor();
    let form = match descriptor.body.as_ref() {
        Some(Body::Form(form)) => form,
        _ => panic!("expected form descriptor"),
    };
    let ctx = Context::default();
    let mut view = PanelView::with_palette(Palette::default());
    let mut term = Terminal::new(TestBackend::new(64, 12)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &FormData))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        output.contains("Edit deployment"),
        "form mode missing:\n{output}"
    );
    assert!(
        output.contains("Name: worker"),
        "prefill missing:\n{output}"
    );
    assert!(
        output.contains("Replicas: 2"),
        "integer prefill missing:\n{output}"
    );

    view.handle_form_key(form, &ctx, KeyCode::Char('x'));
    let submission = view
        .handle_form_key(form, &ctx, KeyCode::Enter)
        .expect("editable form should submit");
    assert_eq!(submission.service, "demo.Deploy");
    assert_eq!(submission.method, "Apply");
    assert_eq!(submission.request["name"], "workerx");
    assert_eq!(submission.request["replicas"], 2);
}

#[test]
fn lro_renders_inputs_and_emits_start_request() {
    let descriptor = lro_descriptor();
    let panel = match descriptor.body.as_ref() {
        Some(Body::Lro(panel)) => panel,
        _ => panic!("expected lro descriptor"),
    };
    let ctx = Context::default();
    let mut view = PanelView::with_palette(Palette::default());
    let mut term = Terminal::new(TestBackend::new(64, 10)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &Refuse))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(output.contains("Deploy"), "run label missing:\n{output}");
    assert!(
        output.contains("Replicas: 1"),
        "input default missing:\n{output}"
    );

    view.handle_lro_key(panel, &ctx, KeyCode::Up);
    let submission = view
        .handle_lro_key(panel, &ctx, KeyCode::Enter)
        .expect("LRO with a start RPC should emit a request");
    assert_eq!(submission.service, "demo.Deploy");
    assert_eq!(submission.method, "Start");
    assert_eq!(submission.request["replicas"], 1);
}

#[test]
fn media_uses_the_terminal_accessible_degradation() {
    let descriptor = media_descriptor();
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(80, 12)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &Refuse))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(output.contains("A deployment progressing from build to ready."));
    assert!(output.contains("02:05"));
    assert!(output.contains("deploy.vtt"));
    assert!(output.contains("Chapter: 01:05 — Ready"));
    assert!(output.contains("deploy.mp4"));
}

#[test]
fn an_empty_descriptor_draws_rather_than_panicking() {
    // main.rs will happily decode a zero-byte file into a default
    // PanelDescriptor — an empty message is valid protobuf. It must not panic on
    // the way to telling the user there is nothing here.
    let out = draw(&PanelDescriptor::default(), 32, 4);
    assert!(!out.trim().is_empty() || out.len() == 32 * 4);
}
