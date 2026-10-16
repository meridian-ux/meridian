//! Shared proto-defined corpus, also consumed through the actual WASM bridge.
//! Expectations are committed data, never derived from the implementation.
use crate::proto::{FormattedValue, GalleryPanel, RpcCall, TablePanel, ValueDisplay};
use crate::{Context, PayloadBudget, PayloadLimitExceeded, ProtoPaths, RequestBuilder};
use prost::Message;
use serde_json::{json, Value};

fn corpus() -> Value {
    serde_json::from_str(include_str!("../../../../../schemas/conformance/core.json")).unwrap()
}

// Read proto3 JSON's bytes representation without adding a production dependency
// for test data. The corpus writer validates the generated envelope in CI.
fn wire(value: &Value) -> Vec<u8> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = Vec::new();
    let mut bits = 0u32;
    let mut available = 0;
    for byte in value.as_str().unwrap().bytes().take_while(|b| *b != b'=') {
        let digit = alphabet
            .iter()
            .position(|c| *c == byte)
            .expect("base64 digit") as u32;
        bits = (bits << 6) | digit;
        available += 6;
        if available >= 8 {
            available -= 8;
            result.push((bits >> available) as u8);
            bits &= (1 << available) - 1;
        }
    }
    result
}

fn context(value: &Value) -> Context {
    let optional = |key: &str| value.get(key).filter(|v| !v.is_null()).cloned();
    let map = |key: &str| {
        value[key]
            .as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default()
    };
    Context {
        current_resource_path: value["currentResourcePath"].as_str().map(str::to_owned),
        ui_identity: optional("uiIdentity"),
        selected_row: optional("selectedRow"),
        form_values: map("formValues"),
        selections: map("selections"),
        signals: Default::default(),
    }
}

#[test]
fn shared_core_paths() {
    for case in corpus()["paths"].as_array().unwrap() {
        assert_eq!(
            ProtoPaths::get(&case["input"], case["path"].as_str().unwrap()),
            &case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn shared_core_requests() {
    for case in corpus()["requests"].as_array().unwrap() {
        let call = RpcCall::decode(wire(&case["rpc"]).as_slice()).unwrap();
        assert_eq!(
            RequestBuilder::build(&call, &context(&case["context"])),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn shared_core_tables() {
    for case in corpus()["tables"].as_array().unwrap() {
        let table = TablePanel::decode(wire(&case["table"]).as_slice()).unwrap();
        let rows: Vec<_> = crate::render_table(&case["response"], &table)
            .into_iter()
            .map(|r| json!({"raw": r.raw, "cells": r.cells}))
            .collect();
        assert_eq!(json!(rows), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn shared_core_clocked_value_formats() {
    for case in corpus()["valueFormats"].as_array().unwrap() {
        let display = ValueDisplay::decode(wire(&case["display"]).as_slice()).unwrap();
        let expected = FormattedValue::decode(wire(&case["expected"]).as_slice()).unwrap();
        let now = case.get("nowMs").map(|now| {
            now.as_f64()
                .unwrap_or_else(|| now.as_str().unwrap().parse().unwrap())
        });
        assert_eq!(
            crate::format_display_value_with_context(&case["input"], &display, now),
            expected,
            "{}",
            case["name"]
        );
        assert_eq!(
            crate::format_display_value_with_metadata(&case["input"], &display),
            crate::format_display_value_with_context(&case["input"], &display, None)
        );
    }
}

#[test]
fn shared_core_galleries() {
    for case in corpus()["galleries"].as_array().unwrap() {
        let gallery = GalleryPanel::decode(wire(&case["gallery"]).as_slice()).unwrap();
        let cards: Vec<_> = crate::render_gallery(&case["response"], &gallery)
            .into_iter()
            .map(|c| {
                json!({
                    "raw": c.raw, "title": c.title, "subtitle": c.subtitle, "icon": c.icon,
                    "status": c.status, "href": c.href, "action_label": c.action_label,
                })
            })
            .collect();
        assert_eq!(json!(cards), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn shared_core_metadata() {
    for case in corpus()["metadata"].as_array().unwrap() {
        assert_eq!(
            crate::format_lro_metadata(&case["input"]),
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn shared_core_payload_budgets() {
    for case in corpus()["budgets"].as_array().unwrap() {
        let mut budget = PayloadBudget::new(
            case["maxBytes"].as_u64().unwrap(),
            case["maxRate"].as_u64().unwrap(),
        );
        let mut start = None;
        for frame in case["frames"].as_array().unwrap() {
            let now = frame["now"]
                .as_f64()
                .unwrap_or_else(|| frame["now"].as_str().unwrap().parse().unwrap());
            let elapsed = if now.is_finite() && now >= 0.0 {
                crate::payload_budget::elapsed_from_monotonic_millis(*start.get_or_insert(now), now)
            } else {
                None
            };
            let actual = match elapsed
                .map(|elapsed| budget.admit(frame["bytes"].as_u64().unwrap() as usize, elapsed))
            {
                None | Some(Err(PayloadLimitExceeded::InvalidClock)) => 3,
                Some(Ok(())) => 0,
                Some(Err(PayloadLimitExceeded::SessionBytes)) => 1,
                Some(Err(PayloadLimitExceeded::Rate)) => 2,
            };
            assert_eq!(
                actual,
                frame["expected"].as_u64().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn shared_core_corpus_keeps_every_operation_and_unique_names() {
    let corpus = corpus();
    for (operation, count) in [
        ("paths", 7),
        ("requests", 6),
        ("tables", 18),
        ("galleries", 4),
        ("metadata", 5),
        ("budgets", 4),
        ("valueFormats", 138),
    ] {
        let cases = corpus[operation].as_array().unwrap();
        assert_eq!(cases.len(), count, "{operation}");
        let names: std::collections::BTreeSet<_> =
            cases.iter().map(|c| c["name"].as_str().unwrap()).collect();
        assert_eq!(names.len(), cases.len(), "duplicate {operation} case");
    }
}
