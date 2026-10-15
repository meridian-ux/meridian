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
    assert_eq!(
        cases.len(),
        98,
        "all 23 arms × 3 states and 29 formatter cases"
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
                if ["gallery", "resource_cards"].contains(&arm) && state != "empty" {
                    assert!(output.contains("Resource 00"), "{name}\n{output}");
                }
                if arm == "detail_header" && state != "empty" {
                    assert!(output.contains("Fixture record"), "{name}\n{output}");
                }
                if arm == "chart" && state != "empty" {
                    assert!(output.contains("2026-10-01"), "{name}\n{output}");
                }
                if arm == "form" {
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
                if state.starts_with("value-") {
                    let value = values["cases"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|v| format!("value-{}", v["name"].as_str().unwrap()) == state)
                        .unwrap();
                    let mut remaining = output.as_str();
                    for line in value["expected"].as_str().unwrap().lines() {
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
