//! Native panels extracted from the same ViewDescriptor wires as the browsers.
//! This does not pretend PanelView implements the view slot/layout tier.
use std::{
    cell::RefCell,
    collections::BTreeSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
};

use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use meridian_tui::PanelPromptResponse;
use meridian_tui::{PanelView, RpcError, RpcInvoker, StreamError, StreamInvoker, StreamSession};
use meridian_uiview::{
    proto::{panel_descriptor::Body, RpcCall, ViewDescriptor},
    Context,
};
use prost::Message;
use prost_types::{value::Kind, Struct, Value};
use ratatui::{backend::TestBackend, Terminal};
use serde_json::{json, Value as Json};

fn data_root() -> PathBuf {
    let mut candidates = vec![PathBuf::from("schemas/conformance")];
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest).join("../../../../schemas/conformance"));
    }
    candidates
        .into_iter()
        .find(|p| p.join("fixtures/table/typical.view.binpb").is_file())
        .expect("shared stateful protobuf corpus must be available")
}

// Test-only reader of the canonical corpus's proto3-JSON bytes. This is not a
// formatter or a new serialized type; the decoded messages remain canonical.
fn option_wire(value: &Json) -> Vec<u8> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bytes = Vec::new();
    let (mut bits, mut available) = (0u32, 0);
    for byte in value
        .as_str()
        .unwrap()
        .bytes()
        .take_while(|byte| *byte != b'=')
    {
        let digit = alphabet
            .iter()
            .position(|candidate| *candidate == byte)
            .expect("base64 digit") as u32;
        bits = (bits << 6) | digit;
        available += 6;
        if available >= 8 {
            available -= 8;
            bytes.push((bits >> available) as u8);
            bits &= (1 << available) - 1;
        }
    }
    bytes
}

fn label_occurrences(buffer: &ratatui::buffer::Buffer, text: &str) -> usize {
    // Retain authored spaces and wide-glyph continuation cells exactly.
    let expected_width = ratatui::text::Line::from(text).width() as u16;
    assert!(expected_width > 0 && expected_width <= buffer.area.width);
    let area = ratatui::layout::Rect::new(0, 0, expected_width, 1);
    let mut expected_buffer = ratatui::buffer::Buffer::empty(area);
    ratatui::widgets::Widget::render(
        ratatui::widgets::Paragraph::new(text),
        area,
        &mut expected_buffer,
    );
    let pattern: Vec<_> = (0..expected_width)
        .map(|x| expected_buffer[(x, 0)].symbol())
        .collect();
    (0..buffer.area.height)
        .map(|y| {
            let row: Vec<_> = (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect();
            row.windows(pattern.len())
                .filter(|cells| *cells == pattern.as_slice())
                .count()
        })
        .sum()
}

#[test]
fn canonical_string_options_reach_native_conversation_slots() {
    use meridian_tui::{render_conversation, Palette};
    use meridian_uiview::{
        proto::{
            block, conversation_event, Block, ConversationEvent, FormattedValue, ValueDisplay,
        },
        ConversationModel,
    };
    let corpus: Json =
        serde_json::from_slice(&std::fs::read(data_root().join("core.json")).unwrap()).unwrap();
    let cases: Vec<_> = corpus["valueFormats"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry.get("nowMs").is_none() && entry["input"].is_string())
        .collect();
    assert_eq!(
        cases.len(),
        180,
        "all no-clock string inputs without numeric coercion"
    );
    for case in cases {
        let raw = case["input"].as_str().unwrap();
        let display = ValueDisplay::decode(option_wire(&case["display"]).as_slice()).unwrap();
        let formatted = FormattedValue::decode(option_wire(&case["expected"]).as_slice()).unwrap();
        let expected = if !raw.is_empty() && [8, 9, 10, 12, 13].contains(&display.r#type) {
            formatted.text.as_str()
        } else {
            raw
        };
        let kinds = [
            block::Kind::Fields(block::Fields {
                fields: vec![block::Field {
                    key: "Value".into(),
                    value: raw.into(),
                    display: Some(display.clone()),
                }],
            }),
            block::Kind::List(block::ListBlock {
                items: vec![block::ListItem {
                    title: raw.into(),
                    subtitle: raw.into(),
                    title_display: Some(display.clone()),
                    subtitle_display: Some(display.clone()),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            block::Kind::Table(block::Table {
                columns: vec![block::Column {
                    key: "value".into(),
                    label: "Value".into(),
                }],
                rows: vec![block::Row {
                    cells: [("value".into(), "stale legacy cell".into())]
                        .into_iter()
                        .collect(),
                    display_cells: [(
                        "value".into(),
                        block::Cell {
                            value: raw.into(),
                            display: Some(display.clone()),
                        },
                    )]
                    .into_iter()
                    .collect(),
                }],
                ..Default::default()
            }),
        ];
        let mut model = ConversationModel::new();
        for (index, kind) in kinds.into_iter().enumerate() {
            let block = Block {
                block_id: "value".into(),
                role: "assistant".into(),
                kind: Some(kind),
            };
            let event = ConversationEvent {
                seq: index as u64 + 1,
                event: Some(conversation_event::Event::Block(block.clone())),
            };
            let bytes = event.encode_to_vec();
            let decoded = ConversationEvent::decode(bytes.as_slice()).unwrap();
            assert!(model.ingest(&decoded));
            assert!(!model.ingest(&decoded));
            assert_eq!(model.blocks(), vec![&block]);
            let mut terminal = Terminal::new(TestBackend::new(1024, 24)).unwrap();
            terminal
                .draw(|frame| {
                    render_conversation(frame, frame.area(), &model, &Palette::default(), "Empty")
                })
                .unwrap();
            let buffer = terminal.backend().buffer();
            let text = buffer
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>();
            assert!(!text.contains("stale legacy cell"));
            if expected.is_empty() {
                assert!(!text.contains('—'));
            } else {
                let slots = if index == 1 { 2 } else { 1 };
                assert!(
                    label_occurrences(buffer, expected) >= slots,
                    "{} slot{index}: {expected:?}",
                    case["name"]
                );
            }
            assert_eq!(decoded.encode_to_vec(), bytes);
        }
    }
}

#[test]
fn canonical_value_options_reach_every_native_read_surface() {
    use meridian_uiview::proto::{
        CardSpec, DescriptorRow, DetailHeaderPanel, FormField, FormattedValue, GalleryPanel,
        MetaField, PanelDescriptor, RecordCardPanel, ResourceCardPanel, ResourceCardTemplate,
        TableColumn, TablePanel, ValueDisplay,
    };
    let corpus: Json =
        serde_json::from_slice(&std::fs::read(data_root().join("core.json")).unwrap()).unwrap();
    let cases: Vec<_> = corpus["valueFormats"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry.get("nowMs").is_none())
        .collect();
    assert_eq!(cases.len(), 220, "every independent no-clock expectation");
    for case in cases {
        let display = ValueDisplay::decode(option_wire(&case["display"]).as_slice()).unwrap();
        let expected = FormattedValue::decode(option_wire(&case["expected"]).as_slice()).unwrap();
        let call = Some(RpcCall {
            service: "fixture.Options".into(),
            method: "Get".into(),
            ..Default::default()
        });
        let bodies = [
            (
                "table",
                Body::Table(TablePanel {
                    populate: call.clone(),
                    rows_field: "rows".into(),
                    columns: vec![TableColumn {
                        header: "Value".into(),
                        field_path: "value".into(),
                        value_display: Some(display.clone()),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
            ),
            (
                "record_card",
                Body::RecordCard(RecordCardPanel {
                    populate: call.clone(),
                    fields: vec![FormField {
                        field_id: "value".into(),
                        label: "Value".into(),
                        display: Some(display.clone()),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
            ),
            (
                "detail_header",
                Body::DetailHeader(DetailHeaderPanel {
                    populate: call.clone(),
                    title: "Fixture".into(),
                    descriptor_rows: vec![DescriptorRow {
                        label: "Value".into(),
                        source_path: "value".into(),
                        display: Some(display.clone()),
                    }],
                    ..Default::default()
                }),
            ),
            (
                "gallery",
                Body::Gallery(GalleryPanel {
                    populate: call.clone(),
                    rows_field: "rows".into(),
                    card: Some(CardSpec {
                        title_field: "value".into(),
                        subtitle_field: "value".into(),
                        status_field: "value".into(),
                        title_display: Some(display.clone()),
                        subtitle_display: Some(display.clone()),
                        status_display: Some(display.clone()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
            ),
            (
                "resource_cards",
                Body::ResourceCards(ResourceCardPanel {
                    populate: call.clone(),
                    rows_field: "rows".into(),
                    template: Some(ResourceCardTemplate {
                        title_field: "value".into(),
                        subtitle_field: "value".into(),
                        status_field: "value".into(),
                        title_display: Some(display.clone()),
                        subtitle_display: Some(display.clone()),
                        status_display: Some(display.clone()),
                        meta: vec![MetaField {
                            label: "Value".into(),
                            field_path: "value".into(),
                            display: Some(display.clone()),
                        }],
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
            ),
        ];
        for (arm, body) in bodies {
            let authored = PanelDescriptor {
                panel_id: format!("{arm}-{}", case["name"].as_str().unwrap()),
                title: "Option fixture".into(),
                body: Some(body),
            };
            let bytes = authored.encode_to_vec();
            let panel = PanelDescriptor::decode(bytes.as_slice()).unwrap();
            let record = json!({ "value": case["input"] });
            let response = if matches!(arm, "record_card" | "detail_header") {
                record
            } else {
                json!({"rows": [record]})
            };
            let host = CorpusHost {
                responses: json!({"fixture.Options.Get": response}),
                calls: RefCell::new(BTreeSet::new()),
                closed: Arc::new(AtomicUsize::new(0)),
            };
            let original = host.responses.clone();
            let mut widget = PanelView::new();
            // Wide viewport prevents this option test from conflating formatting
            // with truncation; the existing golden suite pins narrow layouts.
            let (width, height) = (1024, 24);
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| {
                    widget.render(frame, frame.area(), &panel, &Context::default(), &host)
                })
                .unwrap();
            let buffer = terminal.backend().buffer();
            let output = (0..height)
                .map(|y| {
                    (0..width)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                        .trim_end()
                        .to_owned()
                })
                .collect::<Vec<_>>()
                .join("\n");
            let slots = match arm {
                "gallery" => 3,
                "resource_cards" => 4,
                _ => 1,
            };
            // A wide glyph occupies a continuation cell. Compare terminal
            // cells with an independently drawn expected label rather than
            // flattening that continuation into an invented authored space.
            let occurrences = label_occurrences(buffer, &expected.text);
            assert!(
                occurrences >= slots,
                "{arm}/{}: expected {slots} occurrences of {:?}\n{output}",
                case["name"],
                expected.text
            );
            assert!(host.calls.borrow().contains("fixture.Options.Get"));
            assert_eq!(host.responses, original);
            assert_eq!(panel.encode_to_vec(), bytes);
            // Native buffers intentionally omit hover-only supporting titles.
        }
    }
}

fn json_value(value: Value) -> Json {
    match value.kind.expect("corpus Struct values must have a kind") {
        Kind::NullValue(_) => Json::Null,
        Kind::NumberValue(n) => json!(n),
        Kind::StringValue(s) => Json::String(s),
        Kind::BoolValue(b) => Json::Bool(b),
        Kind::StructValue(s) => json_struct(s),
        Kind::ListValue(l) => Json::Array(l.values.into_iter().map(json_value).collect()),
    }
}

fn json_struct(value: Struct) -> Json {
    Json::Object(
        value
            .fields
            .into_iter()
            .map(|(key, value)| (key, json_value(value)))
            .collect(),
    )
}

// WKT Value has one double-valued JSON number kind. Runtime request builders
// may retain an integer Number internally; compare the same protobuf numeric
// representation without coercing strings, booleans, arrays, or objects.
fn protobuf_json_numbers(value: Json) -> Json {
    match value {
        Json::Number(value) => json!(value.as_f64().unwrap()),
        Json::Array(values) => Json::Array(values.into_iter().map(protobuf_json_numbers).collect()),
        Json::Object(values) => Json::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, protobuf_json_numbers(value)))
                .collect(),
        ),
        other => other,
    }
}

struct CorpusHost {
    responses: Json,
    calls: RefCell<BTreeSet<String>>,
    closed: Arc<AtomicUsize>,
}

impl RpcInvoker for CorpusHost {
    fn invoke(&self, service: &str, method: &str, _: Json) -> Result<Json, RpcError> {
        let key = format!("{service}.{method}");
        self.calls.borrow_mut().insert(key.clone());
        self.responses
            .get(&key)
            .cloned()
            .ok_or_else(|| RpcError::Transport(format!("unexpected corpus call {key}")))
    }
}

impl StreamInvoker for CorpusHost {
    fn subscribe(&self, _: &RpcCall, _: Json) -> Result<StreamSession, StreamError> {
        let (sender, receiver) = mpsc::channel();
        for frame in self.responses["__streamFrames"]
            .as_array()
            .expect("stream frames")
        {
            sender
                .send(meridian_uiview::stream_frame_from_json(frame.clone()))
                .unwrap();
        }
        let closed = self.closed.clone();
        Ok(StreamSession::new(receiver, move || {
            closed.fetch_add(1, Ordering::SeqCst);
        }))
    }
}

#[test]
fn shared_stateful_panels_match_native_buffers() {
    let root = data_root();
    let values: Json =
        serde_json::from_slice(&std::fs::read(root.join("value_types.json")).unwrap()).unwrap();
    let constrained: Json =
        serde_json::from_slice(&std::fs::read(root.join("constrained_value_types.json")).unwrap())
            .unwrap();
    let inputs = json_struct(
        Struct::decode(
            std::fs::read(root.join("input_values.binpb"))
                .unwrap()
                .as_slice(),
        )
        .unwrap(),
    );
    let mut cases = Vec::new();
    for arm in std::fs::read_dir(root.join("fixtures")).unwrap() {
        for entry in std::fs::read_dir(arm.unwrap().path()).unwrap() {
            let path = entry.unwrap().path();
            if path.to_string_lossy().ends_with(".view.binpb") {
                cases.push(path);
            }
        }
    }
    cases.sort();
    let coverage: Json =
        serde_json::from_slice(&std::fs::read(root.join("coverage.json")).unwrap()).unwrap();
    assert_eq!(
        cases.len(),
        coverage["arms"].as_object().unwrap().len() * 3
            + values["panelArms"].as_array().unwrap().len()
                * values["cases"].as_array().unwrap().len()
            + constrained["stringArms"].as_array().unwrap().len()
                * constrained["strings"].as_array().unwrap().len()
            + constrained["numberArms"].as_array().unwrap().len()
                * constrained["numbers"].as_array().unwrap().len()
            + inputs["cases"].as_array().unwrap().len()
                * (inputs["arms"].as_array().unwrap().len() + 1),
        "every arm/state and every declared value surface/case"
    );
    let recording = std::env::var("UPDATE_SNAPSHOTS").as_deref() == Ok("1");
    let golden_root = if recording {
        // bazel run exposes the source workspace; never write through runfiles.
        let workspace = std::env::var("BUILD_WORKSPACE_DIRECTORY")
            .expect("record with bazel run from the source workspace");
        let path = PathBuf::from(workspace).join("schemas/conformance");
        assert!(path.is_absolute() && path.join("fixtures/table/typical.view.binpb").is_file());
        path.join("native")
    } else {
        root.join("native")
    };
    let mut expected_goldens = BTreeSet::new();
    for path in cases {
        let arm = path
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        let filename = path.file_name().unwrap().to_str().unwrap();
        let state = filename.strip_suffix(".view.binpb").unwrap();
        let name = format!("{arm}/{state}");
        let input = state
            .strip_prefix("input-")
            .or_else(|| state.strip_prefix("read-"))
            .and_then(|name| {
                inputs["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|case| case["name"].as_str() == Some(name))
            });
        let view = ViewDescriptor::decode(std::fs::read(&path).unwrap().as_slice()).unwrap();
        assert_eq!(view.slots.len(), 1, "{name}: corpus currently has one slot");
        let panel = view.slots[0].panel.as_ref().unwrap();
        let host = CorpusHost {
            responses: json_struct(
                Struct::decode(
                    std::fs::read(path.with_file_name(format!("{state}.responses.binpb")))
                        .unwrap()
                        .as_slice(),
                )
                .unwrap(),
            ),
            calls: RefCell::new(BTreeSet::new()),
            closed: Arc::new(AtomicUsize::new(0)),
        };
        let mut widget = PanelView::new();
        let context = Context::default();
        if let Some(Body::Stream(_)) = &panel.body {
            widget.poll_stream(panel, &context, &host);
        }
        for (width, height) in [(96, 28), (40, 10)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| widget.render(frame, frame.area(), panel, &context, &host))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let output = (0..height)
                .map(|y| {
                    (0..width)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                        .trim_end()
                        .to_owned()
                })
                .collect::<Vec<_>>()
                .join("\n")
                + "\n";
            if width == 96 {
                assert!(
                    output.contains(&panel.title.chars().take(12).collect::<String>()),
                    "{name}: title missing\n{output}"
                );
                if arm == "table" && ["typical", "overflow"].contains(&state) {
                    assert!(output.contains("Member 00"), "{name}\n{output}");
                }
                if ["gallery", "resource_cards"].contains(&arm)
                    && ["typical", "overflow"].contains(&state)
                {
                    assert!(output.contains("Resource 00"), "{name}\n{output}");
                }
                if arm == "detail_header" && ["typical", "overflow"].contains(&state) {
                    assert!(output.contains("Fixture record"), "{name}\n{output}");
                }
                if arm == "chart" && state != "empty" {
                    assert!(output.contains("2026-10-01"), "{name}\n{output}");
                }
                if arm == "form" && ["empty", "typical", "overflow"].contains(&state) {
                    let count = match state {
                        "empty" => 0,
                        "typical" => 2,
                        _ => 30,
                    };
                    assert!(
                        output.contains(&format!("Navigation groups: {count} items")),
                        "{name}\n{output}"
                    );
                }
                if let Some(input) = input {
                    if input["masked"] == true {
                        assert!(
                            !output.contains(input["raw"].as_str().unwrap()),
                            "{name}: concealed default leaked\n{output}"
                        );
                    } else if state.starts_with("read-") {
                        for line in input["expectedRead"].as_str().unwrap().lines() {
                            assert!(
                                output.contains(line),
                                "{name}: read-only formatted value missing: {line:?}\n{output}"
                            );
                        }
                    }
                }
                if state.starts_with("value-") || state.starts_with("typed-") {
                    let source = if state.starts_with("value-") {
                        &values["cases"]
                    } else if constrained["stringArms"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|a| a.as_str() == Some(arm))
                    {
                        &constrained["strings"]
                    } else {
                        &constrained["numbers"]
                    };
                    let prefix = if state.starts_with("value-") {
                        "value"
                    } else {
                        "typed"
                    };
                    let value = source
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|v| format!("{prefix}-{}", v["name"].as_str().unwrap()) == state)
                        .unwrap();
                    let mut remaining = output.as_str();
                    let expected = value["expected"].as_str().unwrap();
                    if expected.contains('\n') {
                        assert!(!output.contains(&expected.replace('\n', "")),
                            "{name}: multiline components must not be concatenated into one row\n{output}");
                    }
                    let slots = match arm {
                        "gallery" => 3,
                        "resource_cards" => 4,
                        _ => 1,
                    };
                    for line in value["expected"].as_str().unwrap().lines() {
                        assert!(
                            output.matches(line).count() >= slots,
                            "{name}: every declared slot must retain {line:?}\n{output}"
                        );
                        let offset = remaining.find(line).unwrap_or_else(|| panic!("{name}: formatter line missing or out of order: {line:?}\n{output}"));
                        remaining = &remaining[offset + line.len()..];
                    }
                }
                if arm == "stream" && state == "overflow" {
                    assert!(output.contains("Stream line 139"), "{name}\n{output}");
                    assert!(!output.contains("Stream line 000"));
                }
            }
            let golden = format!("{arm}/{state}-{width}x{height}.txt");
            expected_goldens.insert(golden.clone());
            let target = golden_root.join(&golden);
            // Keep every viewport row, including blank tail rows, without
            // confusing a meaningful fixed-height buffer with blank EOF noise.
            let snapshot = format!("viewport {width}x{height}\n{output}end viewport\n");
            if recording {
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(&target, &snapshot).unwrap();
            } else {
                let expected = std::fs::read_to_string(&target).unwrap_or_else(|error| {
                    panic!(
                        "missing native golden {golden}: {error}; explicitly re-record and review"
                    )
                });
                assert_eq!(
                    snapshot, expected,
                    "native buffer differs: {name} at {width}x{height}"
                );
            }
        }
        if let Some(input) = input {
            let expected = json!({"value": input["raw"].clone()});
            match panel.body.as_ref().unwrap() {
                Body::Form(form) if state.starts_with("read-") => {
                    assert!(widget
                        .handle_form_key(form, &context, KeyCode::Enter)
                        .is_none());
                }
                Body::Form(form) => assert_eq!(
                    protobuf_json_numbers(
                        widget
                            .handle_form_key(form, &context, KeyCode::Enter)
                            .unwrap_or_else(|| panic!("{name}: valid defaults must submit"))
                            .request
                    ),
                    expected,
                    "{name}"
                ),
                Body::Lro(lro) => assert_eq!(
                    protobuf_json_numbers(
                        widget
                            .handle_lro_key(lro, &context, KeyCode::Enter)
                            .unwrap_or_else(|| panic!("{name}: valid defaults must start"))
                            .request
                    ),
                    expected,
                    "{name}"
                ),
                Body::Prompt(_) | Body::LlmPrompt(_) => {
                    let response = widget
                        .handle_prompt_key(panel, KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE))
                        .unwrap_or_else(|| panic!("{name}: valid defaults must collect"));
                    let values = match response {
                        PanelPromptResponse::Submitted(values) => values,
                        PanelPromptResponse::Preview { slots, .. } => slots,
                        other => panic!("{name}: unexpected response {other:?}"),
                    };
                    assert_eq!(
                        json_struct(values),
                        expected,
                        "{name}: collected protobuf must preserve raw values"
                    );
                }
                _ => panic!("{name}: unexpected input arm"),
            }
            assert!(
                host.calls.borrow().is_empty(),
                "{name}: native collection must not execute a request"
            );
        }
        for key in host
            .responses
            .as_object()
            .unwrap()
            .keys()
            .filter(|key| !key.starts_with("__"))
        {
            assert!(
                host.calls.borrow().contains(key),
                "{name}: failed to consume shared response {key}"
            );
        }
        drop(widget);
        if arm == "stream" {
            assert_eq!(
                host.closed.load(Ordering::SeqCst),
                1,
                "{name}: close stream resource"
            );
        }
    }
    let mut actual_goldens = BTreeSet::new();
    for arm in std::fs::read_dir(&golden_root).unwrap() {
        for entry in std::fs::read_dir(arm.unwrap().path()).unwrap() {
            let path = entry.unwrap().path();
            actual_goldens.insert(format!(
                "{}/{}",
                path.parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_str()
                    .unwrap(),
                path.file_name().unwrap().to_str().unwrap()
            ));
        }
    }
    assert_eq!(
        actual_goldens, expected_goldens,
        "native goldens must have no missing or extra cases; updater does not delete extras"
    );
}

#[test]
fn typed_input_defaults_collect_raw_protobuf_values_without_transport() {
    let root = data_root();
    let inputs = json_struct(
        Struct::decode(
            std::fs::read(root.join("input_values.binpb"))
                .unwrap()
                .as_slice(),
        )
        .unwrap(),
    );
    for input in inputs["cases"].as_array().unwrap() {
        for arm in inputs["arms"].as_array().unwrap() {
            let arm = arm.as_str().unwrap();
            let name = format!("{arm}/input-{}", input["name"].as_str().unwrap());
            let view = ViewDescriptor::decode(
                std::fs::read(root.join(format!("fixtures/{name}.view.binpb")))
                    .unwrap()
                    .as_slice(),
            )
            .unwrap();
            let panel = view.slots[0].panel.as_ref().unwrap();
            let host = CorpusHost {
                responses: json!({}),
                calls: RefCell::new(BTreeSet::new()),
                closed: Arc::new(AtomicUsize::new(0)),
            };
            let context = Context::default();
            let mut widget = PanelView::new();
            let mut terminal = Terminal::new(TestBackend::new(96, 28)).unwrap();
            terminal
                .draw(|frame| widget.render(frame, frame.area(), panel, &context, &host))
                .unwrap();
            let expected = json!({"value": input["raw"].clone()});
            let collected = match panel.body.as_ref().unwrap() {
                Body::Form(form) => {
                    widget
                        .handle_form_key(form, &context, KeyCode::Enter)
                        .unwrap_or_else(|| panic!("{name}: valid defaults must submit"))
                        .request
                }
                Body::Lro(lro) => {
                    widget
                        .handle_lro_key(lro, &context, KeyCode::Enter)
                        .unwrap_or_else(|| panic!("{name}: valid defaults must start"))
                        .request
                }
                Body::Prompt(_) | Body::LlmPrompt(_) => {
                    match widget
                        .handle_prompt_key(panel, KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE))
                        .unwrap_or_else(|| panic!("{name}: valid defaults must collect"))
                    {
                        PanelPromptResponse::Submitted(values) => json_struct(values),
                        PanelPromptResponse::Preview { slots, .. } => json_struct(slots),
                        other => panic!("{name}: unexpected response {other:?}"),
                    }
                }
                _ => panic!("{name}: unexpected input arm"),
            };
            assert_eq!(
                protobuf_json_numbers(collected),
                expected,
                "{name}: defaults must retain their actual protobuf value types"
            );
            assert!(
                host.calls.borrow().is_empty(),
                "{name}: collection must not execute RPCs"
            );
        }
    }
}

#[test]
fn excessive_form_and_lro_default_expansion_fails_visibly_without_execution() {
    let root = data_root();
    for arm in ["form", "lro"] {
        let mut view = ViewDescriptor::decode(
            std::fs::read(root.join(format!("fixtures/{arm}/input-list.view.binpb")))
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        let panel = view.slots[0].panel.as_mut().unwrap();
        let field = match panel.body.as_mut().unwrap() {
            Body::Form(form) => &mut form.fields[0],
            Body::Lro(lro) => &mut lro.inputs[0],
            _ => unreachable!(),
        };
        let Some(meridian_uiview::proto::form_field::Kind::Repeated(repeated)) = &mut field.kind
        else {
            unreachable!()
        };
        repeated.min_items = u32::MAX;
        repeated.max_items = 0;
        let host = CorpusHost {
            responses: json!({}),
            calls: RefCell::new(BTreeSet::new()),
            closed: Arc::new(AtomicUsize::new(0)),
        };
        let context = Context::default();
        let mut widget = PanelView::new();
        let mut terminal = Terminal::new(TestBackend::new(96, 28)).unwrap();
        terminal
            .draw(|frame| widget.render(frame, frame.area(), panel, &context, &host))
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(
            text.contains("1000 value nodes"),
            "{arm}: oversized defaults must explain rejection: {text}"
        );
        match panel.body.as_ref().unwrap() {
            Body::Form(form) => assert!(widget
                .handle_form_key(form, &context, KeyCode::Enter)
                .is_none()),
            Body::Lro(lro) => assert!(widget
                .handle_lro_key(lro, &context, KeyCode::Enter)
                .is_none()),
            _ => unreachable!(),
        }
        assert!(host.calls.borrow().is_empty());
    }
}

#[test]
fn multiline_table_headers_and_cells_reserve_rows_without_losing_following_records() {
    let root = data_root();
    let mut view = ViewDescriptor::decode(
        std::fs::read(root.join("fixtures/table/typical.view.binpb"))
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    let panel = view.slots[0].panel.as_mut().unwrap();
    let Some(Body::Table(table)) = panel.body.as_mut() else {
        panic!("table fixture")
    };
    table.columns[0].header = "Member\nidentity".into();
    table.columns.truncate(1);
    let key = format!(
        "{}.{}",
        table.populate.as_ref().unwrap().service,
        table.populate.as_ref().unwrap().method
    );
    let response =
        json!({table.rows_field.clone(): [{"member": "First\nSecond"}, {"member": "Third"}]});
    let host = CorpusHost {
        responses: json!({key: response}),
        calls: RefCell::new(BTreeSet::new()),
        closed: Arc::new(AtomicUsize::new(0)),
    };
    let mut widget = PanelView::new();
    let mut terminal = Terminal::new(TestBackend::new(64, 14)).unwrap();
    terminal
        .draw(|frame| widget.render(frame, frame.area(), panel, &Context::default(), &host))
        .unwrap();
    let buffer = terminal.backend().buffer();
    for (row, expected) in [
        (3, "Member"),
        (4, "identity"),
        (5, "First"),
        (6, "Second"),
        (7, "Third"),
    ] {
        let line = (0..64)
            .map(|x| buffer[(x, row)].symbol())
            .collect::<String>();
        assert!(
            line.contains(expected),
            "row {row} must retain {expected:?}: {line}"
        );
    }
}

#[test]
fn fetched_stat_is_cached_invalidated_and_reports_transport_failure() {
    use meridian_uiview::proto::{field_binding::Source, FieldBinding};
    use std::cell::Cell;
    struct Metrics {
        count: Cell<usize>,
    }
    impl RpcInvoker for Metrics {
        fn invoke(&self, service: &str, method: &str, request: Json) -> Result<Json, RpcError> {
            assert_eq!((service, method), ("fixture.Metrics", "Get"));
            assert_eq!(request, json!({"tenant": "native"}));
            self.count.set(self.count.get() + 1);
            match self.count.get() {
                1 => {
                    Ok(json!({"value": 0, "previous": 2, "shown": "Server metric", "trend": "up"}))
                }
                2 => Ok(json!({"value": 20, "previous": 5, "shown": "Refreshed metric"})),
                4 => Ok(json!([])),
                _ => Err(RpcError::Transport("unavailable".into())),
            }
        }
    }
    let mut view = ViewDescriptor::decode(
        std::fs::read(data_root().join("fixtures/stat/typed-server-display.view.binpb"))
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    let descriptor = view.slots[0].panel.as_mut().unwrap();
    let Some(Body::Stat(panel)) = descriptor.body.as_mut() else {
        panic!("stat fixture")
    };
    panel
        .populate
        .as_mut()
        .unwrap()
        .bindings
        .push(FieldBinding {
            request_field: "tenant".into(),
            source: Some(Source::Literal("native".into())),
        });
    let host = Metrics {
        count: Cell::new(0),
    };
    let mut widget = PanelView::new();
    let mut terminal = Terminal::new(TestBackend::new(96, 14)).unwrap();
    let mut draw = |widget: &mut PanelView| {
        terminal
            .draw(|frame| {
                widget.render(frame, frame.area(), descriptor, &Context::default(), &host)
            })
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    };
    let first = draw(&mut widget);
    assert!(
        first.contains("Server metric") && first.contains("↓ -2.00"),
        "{first}"
    );
    assert!(draw(&mut widget).contains("Server metric"));
    assert_eq!(host.count.get(), 1);
    widget.invalidate();
    assert!(draw(&mut widget).contains("Refreshed metric"));
    assert_eq!(host.count.get(), 2);
    widget.invalidate();
    let failed = draw(&mut widget);
    assert!(failed.contains("Failed to load metric"));
    assert!(!failed.contains("Refreshed metric"));
    assert_eq!(host.count.get(), 3);
    widget.invalidate();
    assert!(draw(&mut widget).contains("Invalid metric response."));
    assert_eq!(host.count.get(), 4);
}
