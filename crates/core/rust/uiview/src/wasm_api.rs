// wasm-bindgen surface for the TS web renderer.
//
// The web side imports this module via wasm-bindgen's generated bindings and
// uses the same proto-walking / request-building logic the Rust TUI uses. DOM
// rendering stays on the JS side; this crate handles the descriptor-driven
// plumbing once.
//
// Surface design: proto descriptors cross the boundary as protobuf BINARY
// (`prost::Message::decode`), not JSON. The TS side encodes them with
// protobuf-es `toBinary(...)`. This keeps the prost types free of serde derives
// — so meridian-schemas stays rust-free — and removes any camelCase/snake_case
// translation. RPC responses and runtime context are arbitrary JSON and still
// cross as JS values; rendered outputs (this crate's own structs) cross as JS
// values too.

use crate::paths::ProtoPaths;
use crate::payload_budget::{elapsed_from_monotonic_millis, PayloadBudget};
use crate::proto::{GalleryPanel, PanelDescriptor, RpcCall, TablePanel, ValueDisplay};
use crate::request::{Context, RequestBuilder};
use crate::{admit_formatted_value, render_gallery_bounded, render_table_bounded};
use prost::Message;
use serde_json::Value;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "staticViewText")]
pub fn static_view_text(bytes: &[u8]) -> Result<String, JsError> {
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(JsError::new("view declaration rejected"));
    }
    let view = crate::proto::ViewDescriptor::decode(bytes)
        .map_err(|_| JsError::new("view declaration rejected"))?;
    crate::static_view_text(&view).map_err(|_| JsError::new("static view construction rejected"))
}

/// Pure selected-row predicate, not host admission or an execution capability.
#[wasm_bindgen(js_name = "matchesRowFilter")]
pub fn matches_row_filter(bytes: &[u8], row: JsValue) -> Result<bool, JsError> {
    if bytes.len() > 64 * 1024 {
        return Err(JsError::new("predicate declaration rejected"));
    }
    let filter = crate::proto::RowFilter::decode(bytes)
        .map_err(|_| JsError::new("predicate declaration rejected"))?;
    crate::row_filter_matches(&filter, &value_input(row)?)
        .map_err(|_| JsError::new("predicate input rejected"))
}

/// Pattern and input are runtime strings, never a JavaScript regex or callback.
/// Invalid/unsupported patterns fail closed without exposing submitted values.
#[wasm_bindgen(js_name = "matchesFormPattern")]
pub fn matches_form_pattern(pattern: &str, value: &str) -> Result<bool, JsError> {
    crate::form_values::matches_pattern(pattern, value).map_err(|_| JsError::new("invalid pattern"))
}

#[wasm_bindgen(js_name = "formatInferredValue")]
pub fn format_inferred_value(value: JsValue) -> Result<String, JsError> {
    let value = value_input(value)?;
    admit_formatted_value(&value).map_err(|_| JsError::new("render construction rejected"))?;
    bounded_text(crate::render::format_inferred_value(&value))
}

#[wasm_bindgen(js_name = "formatTimestamp")]
pub fn format_timestamp(text: &str) -> Option<String> {
    crate::render::try_format_timestamp(text)
}

#[wasm_bindgen(js_name = "formatRelativeTime")]
pub fn format_relative_time(text: &str, now_ms: f64) -> Option<String> {
    crate::render::try_format_relative_timestamp(text, now_ms)
}

#[wasm_bindgen(js_name = "formatStatNumber")]
pub fn format_stat_number(number: f64, format: i32) -> String {
    crate::stat::format_stat_number(number, format)
}

#[wasm_bindgen(js_name = "formatLegacyNumber")]
pub fn format_legacy_number(number: f64, format: i32) -> String {
    crate::format_value(
        &serde_json::json!(number),
        crate::proto::ColumnFormat::try_from(format).unwrap_or_default(),
    )
}

/// Standalone declared-value formatting without constructing a table. Raw RPC
/// data uses the bridge's existing JSON value layer; the declaration and rich
/// result are protobuf wire messages (ValueDisplay -> FormattedValue).
#[wasm_bindgen(js_name = "formatValueDisplay")]
pub fn format_value_display(display: &[u8], value: JsValue) -> Result<Vec<u8>, JsError> {
    format_value_display_impl(display, value, None)
}

/// Separate capability so an older initialized module cannot silently ignore
/// an explicit clock argument intended for a newer formatter.
#[wasm_bindgen(js_name = "formatValueDisplayAt")]
pub fn format_value_display_at(
    display: &[u8],
    value: JsValue,
    now_ms: f64,
) -> Result<Vec<u8>, JsError> {
    format_value_display_impl(display, value, Some(now_ms))
}

fn format_value_display_impl(
    display: &[u8],
    value: JsValue,
    now_ms: Option<f64>,
) -> Result<Vec<u8>, JsError> {
    if display.len() > 64 * 1024 {
        return Err(JsError::new("display declaration rejected"));
    }
    let display =
        ValueDisplay::decode(display).map_err(|_| JsError::new("display declaration rejected"))?;
    let value = value_input(value)?;
    admit_formatted_value(&value).map_err(|_| JsError::new("render construction rejected"))?;
    let formatted = crate::format_display_value_with_context(&value, &display, now_ms);
    if formatted.encoded_len() > 4 * 1024 * 1024 {
        return Err(JsError::new("render output rejected"));
    }
    Ok(formatted.encode_to_vec())
}

/// Stateful JavaScript handle backed by the same payload policy used by native
/// stream consumers. A separate instance is used for each direction/session.
#[wasm_bindgen]
pub struct WasmPayloadBudget {
    inner: PayloadBudget,
    started_at_ms: Option<f64>,
}

#[wasm_bindgen]
impl WasmPayloadBudget {
    #[wasm_bindgen(constructor)]
    pub fn new(max_bytes: u32, max_rate: u32) -> Self {
        Self {
            inner: PayloadBudget::new(u64::from(max_bytes), u64::from(max_rate)),
            started_at_ms: None,
        }
    }

    /// Returns 0 when admitted, 1 for the session-byte ceiling, 2 for the
    /// rolling one-second rate ceiling, and 3 for an invalid monotonic clock.
    #[wasm_bindgen(js_name = admit)]
    pub fn admit(&mut self, payload_bytes: u32, now_ms: f64) -> u8 {
        if !now_ms.is_finite() || now_ms < 0.0 {
            return 3;
        }
        let started_at_ms = *self.started_at_ms.get_or_insert(now_ms);
        let Some(elapsed) = elapsed_from_monotonic_millis(started_at_ms, now_ms) else {
            return 3;
        };
        match self.inner.admit(payload_bytes as usize, elapsed) {
            Ok(()) => 0,
            Err(crate::PayloadLimitExceeded::SessionBytes) => 1,
            Err(crate::PayloadLimitExceeded::Rate) => 2,
            Err(crate::PayloadLimitExceeded::InvalidClock) => 3,
        }
    }
}

/// Serialize a Rust value for JS as PLAIN OBJECTS, not `Map`s.
///
/// serde-wasm-bindgen's DEFAULT turns a `serde_json::Value::Object` — and any
/// Rust map — into a JS `Map`. That is the correct default for a lossless
/// round-trip (a Map can key on non-strings), but it is the WRONG one for this
/// surface, which is a JSON-shaped API consumed by ordinary JavaScript. The
/// difference is invisible until it isn't:
///
///     raw.name                                  → undefined  (needs raw.get)
///     JSON.stringify(new Map([["name","x"]]))   → "{}"
///     Object.entries(new Map([["name","x"]]))   → []
///
/// Both failures shipped. The TS `UiviewWasm` interface declares
/// `raw: Record<string, unknown>` and `buildRequest(): object`; TypeScript
/// cannot check across an FFI boundary, so those declarations were simply
/// false. Every binding-populated request serialized to nothing — a bound GET
/// sent no query params, a bound POST an empty body — with no error anywhere.
///
/// So: one serializer, used by EVERY js-facing return, that makes the declared
/// types true.
// Request maps may contain literal data keys such as __proto__. The ordinary
// indexing setter in serde-wasm-bindgen would invoke Object.prototype's setter
// and silently drop that own property. JSON.parse creates inert own data keys.
fn request_to_js(value: &Value) -> Result<JsValue, JsError> {
    bounded_json_output(value, "request output rejected")
}

fn to_js<T: serde::Serialize + ?Sized>(value: &T) -> Result<JsValue, JsError> {
    bounded_json_output(value, "render output rejected")
}

struct JsonOutput(Vec<u8>);
impl std::io::Write for JsonOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|n| n > 4 * 1024 * 1024)
        {
            return Err(std::io::Error::other("JSON output limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn bounded_json_output<T: serde::Serialize + ?Sized>(
    value: &T,
    message: &str,
) -> Result<JsValue, JsError> {
    let mut output = JsonOutput(Vec::new());
    serde_json::to_writer(&mut output, value).map_err(|_| JsError::new(message))?;
    let json = String::from_utf8(output.0).map_err(|_| JsError::new(message))?;
    js_sys::JSON::parse(&json).map_err(|_| JsError::new(message))
}

fn value_input(value: JsValue) -> Result<Value, JsError> {
    crate::wasm_input::InputBudget::new()
        .decode(value)
        .map_err(|_| JsError::new("render input rejected"))
}

fn bounded_text(text: String) -> Result<String, JsError> {
    if text.len() > 4 * 1024 * 1024 {
        return Err(JsError::new("render output rejected"));
    }
    Ok(text)
}

/// Reads a field from a JSON-shaped object by dotted path. Mirrors
/// meridian.ui.descriptors.ProtoPaths.get. Used by the web renderer
/// to extract column cell values from response objects.
#[wasm_bindgen(js_name = "readPath")]
pub fn read_path(value: JsValue, path: &str) -> Result<JsValue, JsError> {
    if path.len() > 64 * 1024 {
        return Err(JsError::new("path declaration rejected"));
    }
    let json = value_input(value)?;
    let result = ProtoPaths::get(&json, path);
    admit_formatted_value(result).map_err(|_| JsError::new("render construction rejected"))?;
    to_js(result)
}

/// Renders a TablePanel against a JSON response value.
///
/// Inputs:
///   descriptor — a protobuf-binary `PanelDescriptor` (body.table populated),
///                produced by protobuf-es `toBinary(PanelDescriptorSchema, …)`.
///   response   — the JSON-shaped response from the populate RPC.
///
/// Output: an array of `{ raw, cells }` JS objects mirroring the Rust
/// `RenderedRow`.
#[wasm_bindgen(js_name = "renderTable")]
pub fn render_table_wasm(descriptor: &[u8], response: JsValue) -> Result<JsValue, JsError> {
    if descriptor.len() > 1024 * 1024 {
        return Err(JsError::new("panel declaration rejected"));
    }
    let d = PanelDescriptor::decode(descriptor).map_err(|e| JsError::new(&e.to_string()))?;
    let table = match d.body {
        Some(crate::proto::panel_descriptor::Body::Table(t)) => t,
        _ => return Err(JsError::new("descriptor body is not TABLE")),
    };
    let response_json = value_input(response)?;
    let rows = render_table_bounded(&response_json, &table)
        .map_err(|_| JsError::new("render construction rejected"))?;
    let serializable: Vec<RenderedRowJs> = rows
        .into_iter()
        .map(|r| RenderedRowJs {
            raw: r.raw,
            cells: r.cells,
        })
        .collect();
    to_js(&serializable)
}

/// Build FormPanel/LroPanel submission bindings and automatic fields together.
#[wasm_bindgen(js_name = "buildSubmissionRequest")]
pub fn build_submission_request(
    descriptor: &[u8],
    context_value: JsValue,
    form_values: JsValue,
) -> Result<JsValue, JsError> {
    if descriptor.len() > 1024 * 1024 {
        return Err(JsError::new("submission declaration exceeds limits"));
    }
    let panel = PanelDescriptor::decode(descriptor)
        .map_err(|_| JsError::new("invalid submission descriptor"))?;
    let (call, fields, kind) = match panel.body {
        Some(crate::proto::panel_descriptor::Body::Form(panel)) => {
            (panel.submit, panel.fields, crate::SubmissionKind::Form)
        }
        Some(crate::proto::panel_descriptor::Body::Lro(panel)) => {
            (panel.start, panel.inputs, crate::SubmissionKind::Lro)
        }
        _ => return Err(JsError::new("not a submission panel")),
    };
    let call = call.ok_or_else(|| JsError::new("submission RPC missing"))?;
    let mut input = crate::wasm_input::InputBudget::new();
    let context: ContextJs = input.decode(context_value)?;
    let values: Value = input.decode(form_values)?;
    let request =
        RequestBuilder::build_submission(&call, &context.into_context(), &fields, &values, kind)
            .map_err(|_| JsError::new("request construction limit exceeded"))?;
    request_to_js(&request)
}

/// Builds the JSON request object for a TablePanel's populate RPC.
/// Hosts pass the runtime context as a JS object:
///
///   {
///     currentResourcePath: string | null,
///     uiIdentity: object | null,
///     selectedRow: object | null,
///     formValues: { [fieldId: string]: any }
///   }
///
/// `descriptor` is a protobuf-binary `PanelDescriptor`. The returned JS object
/// is the JSON-shaped request the host should submit through its RPC transport.
#[wasm_bindgen(js_name = "buildPopulateRequest")]
pub fn build_populate_request(
    descriptor: &[u8],
    context_value: JsValue,
) -> Result<JsValue, JsError> {
    if descriptor.len() > 1024 * 1024 {
        return Err(JsError::new("descriptor exceeds request limits"));
    }
    let d = PanelDescriptor::decode(descriptor).map_err(|e| JsError::new(&e.to_string()))?;
    let table = match d.body {
        Some(crate::proto::panel_descriptor::Body::Table(t)) => t,
        _ => return Err(JsError::new("descriptor body is not TABLE")),
    };
    let populate = table
        .populate
        .ok_or_else(|| JsError::new("TablePanel has no populate RpcCall"))?;
    let ctx_in: ContextJs = crate::wasm_input::InputBudget::new().decode(context_value)?;
    if populate.encoded_len() > 64 * 1024 {
        return Err(JsError::new("RPC declaration exceeds limits"));
    }
    let request = RequestBuilder::build_for_boundary(&populate, &ctx_in.into_context())
        .map_err(|_| JsError::new("request construction limit exceeded"))?;
    request_to_js(&request)
}

/// Renders a GalleryPanel against a JSON response value. `gallery_panel` is a
/// protobuf-binary `GalleryPanel`. Returns an array of
/// `{ raw, title, subtitle, icon, status, href, action_label }` — one per row —
/// which the host drops into card chrome (resolving `icon` to a vector glyph).
#[wasm_bindgen(js_name = "renderGalleryPanel")]
pub fn render_gallery_panel_wasm(
    gallery_panel: &[u8],
    response: JsValue,
) -> Result<JsValue, JsError> {
    if gallery_panel.len() > 1024 * 1024 {
        return Err(JsError::new("gallery declaration rejected"));
    }
    let gallery = GalleryPanel::decode(gallery_panel).map_err(|e| JsError::new(&e.to_string()))?;
    let response_json = value_input(response)?;
    let cards = render_gallery_bounded(&response_json, &gallery)
        .map_err(|_| JsError::new("render construction rejected"))?;
    let serializable: Vec<RenderedCardJs> = cards
        .into_iter()
        .map(|c| RenderedCardJs {
            raw: c.raw,
            title: c.title,
            subtitle: c.subtitle,
            icon: c.icon,
            status: c.status,
            href: c.href,
            action_label: c.action_label,
        })
        .collect();
    to_js(&serializable)
}

#[derive(serde::Serialize)]
struct RenderedRowJs {
    raw: Value,
    cells: Vec<String>,
}

#[derive(serde::Serialize)]
struct RenderedCardJs {
    raw: Value,
    title: String,
    subtitle: String,
    icon: String,
    status: String,
    href: String,
    action_label: String,
}

#[derive(serde::Deserialize)]
struct ContextJs {
    #[serde(rename = "currentResourcePath")]
    current_resource_path: Option<String>,
    #[serde(rename = "uiIdentity")]
    ui_identity: Option<Value>,
    #[serde(rename = "selectedRow")]
    selected_row: Option<Value>,
    #[serde(rename = "formValues")]
    form_values: Option<HashMap<String, Value>>,
    /// The view's selection bag, keyed by selection key. Optional: a host with
    /// no scope pickers omits it and every `selection_key` binding is inert.
    selections: Option<HashMap<String, Value>>,
    /// Live grammar values supplied by the host at activation, never authored.
    signals: Option<HashMap<String, Value>>,
}

impl ContextJs {
    fn into_context(self) -> Context {
        Context {
            current_resource_path: self.current_resource_path,
            ui_identity: self.ui_identity,
            selected_row: self.selected_row,
            form_values: self.form_values.unwrap_or_default(),
            signals: self.signals.unwrap_or_default(),
            // View-level selection scope, unlike signals, IS a property of the
            // render context, so it crosses here.
            selections: self.selections.unwrap_or_default(),
        }
    }
}

// ----------------------------------------------------------------------------
// Generic primitives used by LRO + future panel shapes. The
// descriptor-specific helpers above are thin wrappers on top of these;
// hosts orchestrating multi-step flows (LRO start → poll → finalize)
// reach for these directly.
// ----------------------------------------------------------------------------

/// Builds the JSON request for any RpcCall, given a runtime context.
/// `rpc_call` is a protobuf-binary `RpcCall`. Same machinery TablePanel's
/// `populate` uses, exposed standalone so hosts can drive LroPanel.start,
/// LroPanel.finalize, and RowAction RPCs without each shape needing its own
/// wasm-bindgen wrapper.
#[wasm_bindgen(js_name = "buildRequest")]
pub fn build_request_wasm(rpc_call: &[u8], context_value: JsValue) -> Result<JsValue, JsError> {
    if rpc_call.len() > 64 * 1024 {
        return Err(JsError::new("RPC declaration exceeds limits"));
    }
    let call = RpcCall::decode(rpc_call).map_err(|e| JsError::new(&e.to_string()))?;
    let ctx_in: ContextJs = crate::wasm_input::InputBudget::new().decode(context_value)?;
    let request = RequestBuilder::build_for_boundary(&call, &ctx_in.into_context())
        .map_err(|_| JsError::new("request construction limit exceeded"))?;
    request_to_js(&request)
}

/// Renders any TablePanel against any JSON response value. The existing
/// `renderTable` works on a full PanelDescriptor (extracting `descriptor.body.table`
/// internally); this variant takes a protobuf-binary `TablePanel` directly so
/// callers can render LroPanel.result with the same code path.
#[wasm_bindgen(js_name = "renderTablePanel")]
pub fn render_table_panel_wasm(table_panel: &[u8], response: JsValue) -> Result<JsValue, JsError> {
    if table_panel.len() > 1024 * 1024 {
        return Err(JsError::new("table declaration rejected"));
    }
    let table = TablePanel::decode(table_panel).map_err(|e| JsError::new(&e.to_string()))?;
    let response_json = value_input(response)?;
    let rows = render_table_bounded(&response_json, &table)
        .map_err(|_| JsError::new("render construction rejected"))?;
    let serializable: Vec<RenderedRowJs> = rows
        .into_iter()
        .map(|r| RenderedRowJs {
            raw: r.raw,
            cells: r.cells,
        })
        .collect();
    to_js(&serializable)
}

/// Convention-based LRO metadata formatter. Mirrors JavaFX's
/// `DescribedLroCard.renderMetadata`: extracts `state` (rendered as
/// `[STATE_NAME]`) and `status_message`, returning the concatenation.
/// Falls back to the raw JSON if neither field is present. Hosts
/// display this on a status line while polling WaitOperation.
#[wasm_bindgen(js_name = "formatLroMetadata")]
pub fn format_lro_metadata(metadata: JsValue) -> Result<String, JsError> {
    let value = value_input(metadata)?;
    admit_formatted_value(&value).map_err(|_| JsError::new("render construction rejected"))?;
    bounded_text(crate::format_lro_metadata(&value))
}

// NOTE: bundle decoding (formerly `decodePanelBundle`) now lives on the TS side —
// it uses protobuf-es `fromBinary(PanelBundleSchema, bytes)` to split a
// PanelBundle into its PanelDescriptors, then re-encodes each with `toBinary`
// and feeds them to the render functions above. Keeping (de)serialization in TS
// (which already has @savvifi/meridian-proto-ts) lets the prost types stay
// serde-free and the wasm own only the render/request logic.
