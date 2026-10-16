//! Bounded in-process C ABI for native renderers. Semantic inputs/results are
//! protobuf bytes; pointers, lengths and status codes are runtime ownership
//! metadata, not an alternate serialized DTO contract.
use crate::proto::{ComputedStat, StatPanel, Tone, Trend, ValueDisplay};
use prost::Message;
use serde_json::Value;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

const OK: i32 = 0;
const INVALID_ARGUMENT: i32 = 1;
const INVALID_PAYLOAD: i32 = 2;
const LIMIT_EXCEEDED: i32 = 3;
const INVALID_PATTERN: i32 = 4;
const INTERNAL_FAILURE: i32 = 5;
const MAX_VALUE_BYTES: usize = 1024 * 1024;
const MAX_DECLARATION_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;

#[no_mangle]
pub extern "C" fn meridian_core_abi_version() -> u32 {
    1
}

// The caller guarantees valid readable memory when len > 0. A cap is checked
// BEFORE forming a slice; null + zero denotes an empty protobuf/string.
unsafe fn bytes<'a>(pointer: *const u8, len: usize, cap: usize) -> Result<&'a [u8], i32> {
    if len > cap {
        return Err(LIMIT_EXCEEDED);
    }
    if len == 0 {
        return Ok(&[]);
    }
    if pointer.is_null() {
        return Err(INVALID_ARGUMENT);
    }
    Ok(unsafe { std::slice::from_raw_parts(pointer, len) })
}

fn json(value: prost_types::Value, depth: usize) -> Result<Value, i32> {
    use prost_types::value::Kind;
    if depth > 64 {
        return Err(LIMIT_EXCEEDED);
    }
    Ok(match value.kind {
        None | Some(Kind::NullValue(_)) => Value::Null,
        Some(Kind::BoolValue(value)) => Value::Bool(value),
        Some(Kind::StringValue(value)) => Value::String(value),
        Some(Kind::NumberValue(value)) => {
            // Match serde-wasm-bindgen's Number.isSafeInteger branch, including
            // negative zero. Otherwise JSON/list fallbacks would print "1.0"
            // here while the exact same browser input prints "1".
            if value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
                Value::Number(serde_json::Number::from(value as i64))
            } else {
                Value::Number(serde_json::Number::from_f64(value).ok_or(INVALID_PAYLOAD)?)
            }
        }
        Some(Kind::ListValue(value)) => Value::Array(
            value
                .values
                .into_iter()
                .map(|value| json(value, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
        Some(Kind::StructValue(value)) => Value::Object(
            value
                .fields
                .into_iter()
                .map(|(key, value)| Ok((key, json(value, depth + 1)?)))
                .collect::<Result<_, i32>>()?,
        ),
    })
}

/// Format ValueDisplay + google.protobuf.Value to FormattedValue with the same
/// kernel and explicit-clock semantics as native Rust and the WASM bridge.
///
/// # Safety
/// Nonempty inputs must be valid immutable byte regions for this call. Output
/// pointers must be valid, aligned, writable and nonoverlapping with each other
/// and the inputs. On success, free the returned pointer/length exactly once
/// with meridian_core_buffer_free; never with a foreign allocator.
#[no_mangle]
pub unsafe extern "C" fn meridian_core_format_value(
    display: *const u8,
    display_len: usize,
    value: *const u8,
    value_len: usize,
    has_now: u8,
    now_ms: f64,
    output: *mut *mut u8,
    output_len: *mut usize,
) -> i32 {
    unsafe {
        if !output.is_null() {
            output.write(std::ptr::null_mut());
        }
        if !output_len.is_null() {
            output_len.write(0);
        }
    }
    if output.is_null() || output_len.is_null() {
        return INVALID_ARGUMENT;
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<Box<[u8]>, i32> {
        if has_now > 1 {
            return Err(INVALID_ARGUMENT);
        }
        let display = unsafe { bytes(display, display_len, MAX_DECLARATION_BYTES)? };
        let value = unsafe { bytes(value, value_len, MAX_VALUE_BYTES)? };
        let display = ValueDisplay::decode(display).map_err(|_| INVALID_PAYLOAD)?;
        let value = json(
            prost_types::Value::decode(value).map_err(|_| INVALID_PAYLOAD)?,
            0,
        )?;
        let result = crate::format_display_value_with_context(
            &value,
            &display,
            (has_now == 1).then_some(now_ms),
        )
        .encode_to_vec();
        if result.len() > MAX_RESULT_BYTES {
            return Err(LIMIT_EXCEEDED);
        }
        Ok(result.into_boxed_slice())
    }));
    match result {
        Ok(Ok(result)) => {
            let len = result.len();
            let pointer = Box::into_raw(result) as *mut u8;
            unsafe {
                output.write(pointer);
                output_len.write(len);
            }
            OK
        }
        Ok(Err(status)) => status,
        Err(_) => INTERNAL_FAILURE,
    }
}

/// Compute an authored StatPanel, optionally applying a host-admitted protobuf
/// Value response, using the same Rust kernel as TUI and browser adapters.
/// No RPC, request construction, admission, or fetch occurs in this function.
///
/// # Safety
/// Inputs must be valid immutable byte regions; output slots must be aligned,
/// writable, and nonoverlapping with each other and the inputs. Successful
/// output is a ComputedStat protobuf owned by Rust; free its exact pointer/len
/// once with meridian_core_buffer_free.
#[no_mangle]
pub unsafe extern "C" fn meridian_core_compute_stat(
    panel: *const u8,
    panel_len: usize,
    has_response: u8,
    response: *const u8,
    response_len: usize,
    output: *mut *mut u8,
    output_len: *mut usize,
) -> i32 {
    unsafe {
        if !output.is_null() {
            output.write(std::ptr::null_mut());
        }
        if !output_len.is_null() {
            output_len.write(0);
        }
    }
    if output.is_null() || output_len.is_null() {
        return INVALID_ARGUMENT;
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<Box<[u8]>, i32> {
        if has_response > 1 || (has_response == 0 && response_len != 0) {
            return Err(INVALID_ARGUMENT);
        }
        let panel = StatPanel::decode(unsafe { bytes(panel, panel_len, MAX_VALUE_BYTES)? })
            .map_err(|_| INVALID_PAYLOAD)?;
        if panel
            .value_display
            .as_ref()
            .is_some_and(|display| display.encoded_len() > MAX_DECLARATION_BYTES)
        {
            return Err(LIMIT_EXCEEDED);
        }
        let response = if has_response == 1 {
            Some(json(
                prost_types::Value::decode(unsafe {
                    bytes(response, response_len, MAX_VALUE_BYTES)?
                })
                .map_err(|_| INVALID_PAYLOAD)?,
                0,
            )?)
        } else {
            None
        };
        let computed = crate::compute_stat_with_response(&panel, response.as_ref());
        let result = ComputedStat {
            formatted_value: computed.formatted_value,
            trend: match computed.trend {
                crate::StatTrend::Up => Trend::Up,
                crate::StatTrend::Down => Trend::Down,
                crate::StatTrend::Flat => Trend::Flat,
                crate::StatTrend::None => Trend::Unspecified,
            } as i32,
            formatted_delta: computed.formatted_delta,
            tone: match computed.semantics {
                crate::StatSemantics::Good => Tone::Success,
                crate::StatSemantics::Bad => Tone::Danger,
                crate::StatSemantics::Neutral => Tone::Neutral,
            } as i32,
            series: computed.series,
        }
        .encode_to_vec();
        if result.len() > MAX_RESULT_BYTES {
            return Err(LIMIT_EXCEEDED);
        }
        Ok(result.into_boxed_slice())
    }));
    match result {
        Ok(Ok(result)) => {
            let len = result.len();
            let pointer = Box::into_raw(result) as *mut u8;
            unsafe {
                output.write(pointer);
                output_len.write(len);
            }
            OK
        }
        Ok(Err(status)) => status,
        Err(_) => INTERNAL_FAILURE,
    }
}

fn protobuf_value(value: Value, depth: usize) -> Result<prost_types::Value, i32> {
    use prost_types::value::Kind;
    if depth > 64 {
        return Err(LIMIT_EXCEEDED);
    }
    Ok(prost_types::Value {
        kind: Some(match value {
            Value::Null => Kind::NullValue(0),
            Value::Bool(value) => Kind::BoolValue(value),
            Value::String(value) => Kind::StringValue(value),
            Value::Number(value) => Kind::NumberValue(value.as_f64().ok_or(INVALID_PAYLOAD)?),
            Value::Array(values) => Kind::ListValue(prost_types::ListValue {
                values: values
                    .into_iter()
                    .map(|value| protobuf_value(value, depth + 1))
                    .collect::<Result<_, _>>()?,
            }),
            Value::Object(values) => Kind::StructValue(prost_types::Struct {
                fields: values
                    .into_iter()
                    .map(|(key, value)| Ok((key, protobuf_value(value, depth + 1)?)))
                    .collect::<Result<_, i32>>()?,
            }),
        }),
    })
}

// Bazel's protobuf dependency generates the well-known types in struct_proto;
// Cargo's generator uses prost_types. Cross this seam through their shared wire
// contract instead of assuming Rust type identity between the two producers.
fn context_json(value: impl Message) -> Result<Value, i32> {
    if value.encoded_len() > MAX_VALUE_BYTES {
        return Err(LIMIT_EXCEEDED);
    }
    let value = prost_types::Value::decode(value.encode_to_vec().as_slice())
        .map_err(|_| INVALID_PAYLOAD)?;
    json(value, 0)
}

fn context_bag(entries: Vec<crate::proto::ContextValue>) -> Result<HashMap<String, Value>, i32> {
    let mut result = HashMap::new();
    for entry in entries {
        if result.contains_key(&entry.key) {
            return Err(INVALID_PAYLOAD);
        }
        result.insert(entry.key, context_json(entry.value.unwrap_or_default())?);
    }
    Ok(result)
}

/// RpcCall + RequestContext -> google.protobuf.Value request object, through
/// the existing shared RequestBuilder. Pure assembly, not RPC execution.
///
/// # Safety
/// Borrowed input regions and writable aligned output slots must be valid and
/// nonoverlapping. Free successful output exactly once with buffer_free.
#[no_mangle]
pub unsafe extern "C" fn meridian_core_build_request(
    call: *const u8,
    call_len: usize,
    context: *const u8,
    context_len: usize,
    output: *mut *mut u8,
    output_len: *mut usize,
) -> i32 {
    unsafe {
        if !output.is_null() {
            output.write(std::ptr::null_mut());
        }
        if !output_len.is_null() {
            output_len.write(0);
        }
    }
    if output.is_null() || output_len.is_null() {
        return INVALID_ARGUMENT;
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<Box<[u8]>, i32> {
        let call =
            crate::proto::RpcCall::decode(unsafe { bytes(call, call_len, MAX_DECLARATION_BYTES)? })
                .map_err(|_| INVALID_PAYLOAD)?;
        let context = crate::proto::RequestContext::decode(unsafe {
            bytes(context, context_len, MAX_VALUE_BYTES)?
        })
        .map_err(|_| INVALID_PAYLOAD)?;
        let context = crate::Context {
            current_resource_path: context.current_resource_path,
            ui_identity: context.ui_identity.map(context_json).transpose()?,
            selected_row: context.selected_row.map(context_json).transpose()?,
            form_values: context_bag(context.form_values)?,
            signals: context_bag(context.signals)?,
            selections: context_bag(context.selections)?,
        };
        let request = crate::RequestBuilder::build_for_boundary(&call, &context)
            .map_err(|_| LIMIT_EXCEEDED)?;
        let result = protobuf_value(request, 0)?.encode_to_vec();
        if result.len() > MAX_RESULT_BYTES {
            return Err(LIMIT_EXCEEDED);
        }
        Ok(result.into_boxed_slice())
    }));
    match result {
        Ok(Ok(result)) => {
            let len = result.len();
            let pointer = Box::into_raw(result) as *mut u8;
            unsafe {
                output.write(pointer);
                output_len.write(len);
            }
            OK
        }
        Ok(Err(status)) => status,
        Err(_) => INTERNAL_FAILURE,
    }
}

/// Runtime strings use UTF-8 with explicit lengths, including embedded NULs.
/// No browser regex translation, shell execution, or input-dependent error text.
///
/// # Safety
/// Nonempty input pointers must designate valid immutable byte regions.
/// matched must be aligned/writable and not alias the inputs for this call.
#[no_mangle]
pub unsafe extern "C" fn meridian_core_matches_form_pattern(
    pattern: *const u8,
    pattern_len: usize,
    input: *const u8,
    input_len: usize,
    matched: *mut u8,
) -> i32 {
    if matched.is_null() {
        return INVALID_ARGUMENT;
    }
    unsafe {
        matched.write(0);
    }
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<bool, i32> {
        let pattern = unsafe { bytes(pattern, pattern_len, MAX_DECLARATION_BYTES)? };
        let input = unsafe { bytes(input, input_len, MAX_VALUE_BYTES)? };
        let pattern = std::str::from_utf8(pattern).map_err(|_| INVALID_PAYLOAD)?;
        let input = std::str::from_utf8(input).map_err(|_| INVALID_PAYLOAD)?;
        crate::form_values::matches_pattern(pattern, input).map_err(|_| INVALID_PATTERN)
    }));
    match result {
        Ok(Ok(value)) => {
            unsafe {
                matched.write(u8::from(value));
            }
            OK
        }
        Ok(Err(status)) => status,
        Err(_) => INTERNAL_FAILURE,
    }
}

/// # Safety
/// pointer/len must be the exact pair returned by a successful native result
/// call and not previously freed. Null is accepted as a no-op.
#[no_mangle]
pub unsafe extern "C" fn meridian_core_buffer_free(pointer: *mut u8, len: usize) {
    if !pointer.is_null() {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                pointer, len,
            )));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn well_known_value<T: Message + Default>(value: prost_types::Value) -> T {
        T::decode(value.encode_to_vec().as_slice()).unwrap()
    }
    use crate::proto::{FormattedValue, ValueType};

    unsafe fn request(call: &[u8], context: &[u8]) -> (i32, Option<Value>) {
        let mut pointer = std::ptr::null_mut();
        let mut len = 99;
        let status = unsafe {
            meridian_core_build_request(
                call.as_ptr(),
                call.len(),
                context.as_ptr(),
                context.len(),
                &mut pointer,
                &mut len,
            )
        };
        if status != OK {
            assert!(pointer.is_null());
            assert_eq!(len, 0);
            return (status, None);
        }
        let value = prost_types::Value::decode(unsafe { std::slice::from_raw_parts(pointer, len) })
            .unwrap();
        unsafe {
            meridian_core_buffer_free(pointer, len);
        }
        (status, Some(json(value, 0).unwrap()))
    }

    #[test]
    fn request_bridge_executes_shared_bindings_and_presence() {
        use crate::proto::{
            field_binding::Source, ContextSource, ContextValue, FieldBinding, RequestContext,
            RpcCall,
        };
        let call = RpcCall {
            bindings: vec![
                FieldBinding {
                    request_field: "resource".into(),
                    source: Some(Source::Context(ContextSource::CurrentResourcePath as i32)),
                },
                FieldBinding {
                    request_field: "scope".into(),
                    source: Some(Source::SelectionKey("year".into())),
                },
                FieldBinding {
                    request_field: "signal".into(),
                    source: Some(Source::Signal("brush".into())),
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            unsafe { request(&call.encode_to_vec(), &[]) },
            (OK, Some(serde_json::json!({})))
        );
        let context = RequestContext {
            current_resource_path: Some(String::new()),
            selections: vec![ContextValue {
                key: "year".into(),
                value: Some(well_known_value(prost_types::Value {
                    kind: Some(prost_types::value::Kind::NumberValue(0.0)),
                })),
            }],
            signals: vec![ContextValue {
                key: "brush".into(),
                value: Some(well_known_value(prost_types::Value {
                    kind: Some(prost_types::value::Kind::BoolValue(false)),
                })),
            }],
            ..Default::default()
        };
        assert_eq!(
            unsafe { request(&call.encode_to_vec(), &context.encode_to_vec()) },
            (
                OK,
                Some(serde_json::json!({"resource":"", "scope":0, "signal":false}))
            )
        );
    }

    #[test]
    fn request_context_rejects_exact_duplicates_not_unicode_equivalent_names() {
        use crate::proto::ContextValue;
        let entry = |key: &str| ContextValue {
            key: key.into(),
            value: None,
        };
        assert_eq!(
            context_bag(vec![entry("é"), entry("e\u{301}")])
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            context_bag(vec![entry("same"), entry("same")]).unwrap_err(),
            INVALID_PAYLOAD
        );
        assert_eq!(unsafe { request(&[0xff], &[]) }.0, INVALID_PAYLOAD);
        assert_eq!(unsafe { request(&[], &[0xff]) }.0, INVALID_PAYLOAD);
        assert_eq!(
            unsafe { request(&vec![0; MAX_DECLARATION_BYTES + 1], &[]) }.0,
            LIMIT_EXCEEDED
        );
        assert_eq!(
            unsafe { request(&[], &vec![0; MAX_VALUE_BYTES + 1]) }.0,
            LIMIT_EXCEEDED
        );
        let mut len = 99;
        assert_eq!(
            unsafe {
                meridian_core_build_request(
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(len, 0);
    }

    #[test]
    fn request_bridge_rejects_deep_paths_before_constructing_objects() {
        use crate::proto::{field_binding::Source, FieldBinding, RpcCall};
        let call = RpcCall {
            bindings: vec![FieldBinding {
                request_field: "a.".repeat(32_000) + "leaf",
                source: Some(Source::Literal("value".into())),
            }],
            ..Default::default()
        }
        .encode_to_vec();
        assert!(call.len() < MAX_DECLARATION_BYTES);
        assert_eq!(unsafe { request(&call, &[]) }.0, LIMIT_EXCEEDED);
    }

    #[test]
    fn request_bridge_rejects_copy_amplification_even_when_final_output_would_be_small() {
        use crate::proto::{
            field_binding::Source, ContextSource, FieldBinding, RequestContext, RpcCall,
        };
        let call = RpcCall {
            bindings: (0..10)
                .map(|_| FieldBinding {
                    request_field: "same".into(),
                    source: Some(Source::Context(ContextSource::UiIdentity as i32)),
                })
                .collect(),
            ..Default::default()
        }
        .encode_to_vec();
        let context = RequestContext {
            ui_identity: Some(well_known_value(prost_types::Value {
                kind: Some(prost_types::value::Kind::StringValue("x".repeat(700_000))),
            })),
            ..Default::default()
        }
        .encode_to_vec();
        assert!(context.len() < MAX_VALUE_BYTES);
        assert_eq!(unsafe { request(&call, &context) }.0, LIMIT_EXCEEDED);
    }

    unsafe fn stat(panel: &[u8], response: Option<&[u8]>) -> (i32, Option<ComputedStat>) {
        let mut pointer = std::ptr::null_mut();
        let mut len = 0;
        let status = unsafe {
            meridian_core_compute_stat(
                panel.as_ptr(),
                panel.len(),
                u8::from(response.is_some()),
                response.unwrap_or_default().as_ptr(),
                response.unwrap_or_default().len(),
                &mut pointer,
                &mut len,
            )
        };
        if status != OK {
            assert!(pointer.is_null());
            assert_eq!(len, 0);
            return (status, None);
        }
        let result =
            ComputedStat::decode(unsafe { std::slice::from_raw_parts(pointer, len) }).unwrap();
        unsafe {
            meridian_core_buffer_free(pointer, len);
        }
        (status, Some(result))
    }

    #[test]
    fn stat_bridge_preserves_presence_computation_and_semantic_tone() {
        let panel = StatPanel {
            value: 12.0,
            previous: Some(0.0),
            higher_is_better: Some(false),
            unit: "ms".into(),
            series: vec![0.0, 12.0],
            ..Default::default()
        };
        let (status, result) = unsafe { stat(&panel.encode_to_vec(), None) };
        assert_eq!(status, OK);
        let result = result.unwrap();
        assert_eq!(result.formatted_value, "12 ms");
        assert_eq!(result.formatted_delta.as_deref(), Some("+12"));
        assert_eq!(result.trend, Trend::Up as i32);
        assert_eq!(result.tone, Tone::Danger as i32);
        assert_eq!(result.series, vec![0.0, 12.0]);
        let panel = StatPanel {
            delta_override: Some(String::new()),
            ..Default::default()
        };
        let (_, result) = unsafe { stat(&panel.encode_to_vec(), None) };
        let result = result.unwrap();
        assert_eq!(result.formatted_delta, Some(String::new()));
        assert_eq!(result.trend, Trend::Unspecified as i32);
        assert_eq!(result.tone, Tone::Neutral as i32);
    }

    #[test]
    fn stat_bridge_response_uses_core_paths_and_never_server_trend() {
        let panel = StatPanel {
            value: 7.0,
            previous: Some(3.0),
            higher_is_better: Some(true),
            value_field: "metric.current".into(),
            previous_field: "metric.prior".into(),
            display_field: "shown".into(),
            ..Default::default()
        };
        let response = prost_types::Value {
            kind: Some(prost_types::value::Kind::StructValue(prost_types::Struct {
                fields: [
                    (
                        "metric".into(),
                        prost_types::Value {
                            kind: Some(prost_types::value::Kind::StructValue(
                                prost_types::Struct {
                                    fields: [
                                        (
                                            "current".into(),
                                            prost_types::Value {
                                                kind: Some(prost_types::value::Kind::NumberValue(
                                                    0.0,
                                                )),
                                            },
                                        ),
                                        (
                                            "prior".into(),
                                            prost_types::Value {
                                                kind: Some(prost_types::value::Kind::NumberValue(
                                                    2.0,
                                                )),
                                            },
                                        ),
                                    ]
                                    .into(),
                                },
                            )),
                        },
                    ),
                    (
                        "shown".into(),
                        prost_types::Value {
                            kind: Some(prost_types::value::Kind::StringValue(
                                "Server\0amount".into(),
                            )),
                        },
                    ),
                    (
                        "trend".into(),
                        prost_types::Value {
                            kind: Some(prost_types::value::Kind::StringValue("up".into())),
                        },
                    ),
                ]
                .into(),
            })),
        };
        let (status, result) =
            unsafe { stat(&panel.encode_to_vec(), Some(&response.encode_to_vec())) };
        assert_eq!(status, OK);
        let result = result.unwrap();
        assert_eq!(result.formatted_value, "Server\0amount");
        assert_eq!(result.formatted_delta.as_deref(), Some("-2"));
        assert_eq!(result.trend, Trend::Down as i32);
        assert_eq!(result.tone, Tone::Danger as i32);
    }

    #[test]
    fn stat_bridge_matches_kernel_for_numeric_modes_and_nonfinite_authored_values() {
        for format in [-1, 0, 1, 2, 3, 4, 5, 999] {
            for value in [
                0.0,
                -0.0,
                1234.6,
                -2.675,
                f64::MAX,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NAN,
            ] {
                for declaration in [
                    None,
                    Some(ValueType::Integer),
                    Some(ValueType::Decimal),
                    Some(ValueType::Money),
                    Some(ValueType::Percent),
                    Some(ValueType::Text),
                ] {
                    let panel = StatPanel {
                        value,
                        format,
                        previous: Some(0.0),
                        unit: "units".into(),
                        value_display: declaration.map(|kind| ValueDisplay {
                            r#type: kind as i32,
                            ..Default::default()
                        }),
                        ..Default::default()
                    };
                    let expected = crate::compute_stat(&panel);
                    let (status, actual) = unsafe { stat(&panel.encode_to_vec(), None) };
                    assert_eq!(status, OK);
                    let actual = actual.unwrap();
                    assert_eq!(actual.formatted_value, expected.formatted_value);
                    assert_eq!(actual.formatted_delta, expected.formatted_delta);
                }
            }
        }
    }

    #[test]
    fn stat_bridge_rejects_malformed_and_oversized_inputs_and_resets_slots() {
        assert_eq!(unsafe { stat(&[0xff], None) }.0, INVALID_PAYLOAD);
        assert_eq!(unsafe { stat(&[], Some(&[0xff])) }.0, INVALID_PAYLOAD);
        assert_eq!(
            unsafe { stat(&vec![0; MAX_VALUE_BYTES + 1], None) }.0,
            LIMIT_EXCEEDED
        );
        assert_eq!(
            unsafe { stat(&[], Some(&vec![0; MAX_VALUE_BYTES + 1])) }.0,
            LIMIT_EXCEEDED
        );
        let mut pointer = std::ptr::null_mut();
        let mut len = 99;
        assert_eq!(
            unsafe {
                meridian_core_compute_stat(
                    std::ptr::null(),
                    1,
                    0,
                    std::ptr::null(),
                    0,
                    &mut pointer,
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(len, 0);
        len = 99;
        assert_eq!(
            unsafe {
                meridian_core_compute_stat(
                    std::ptr::null(),
                    0,
                    2,
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(len, 0);
        assert_eq!(
            unsafe {
                meridian_core_compute_stat(
                    std::ptr::null(),
                    0,
                    0,
                    std::ptr::null(),
                    1,
                    &mut pointer,
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert!(pointer.is_null());
        let response = prost_types::Value {
            kind: Some(prost_types::value::Kind::NumberValue(f64::NAN)),
        };
        assert_eq!(
            unsafe { stat(&[], Some(&response.encode_to_vec())) }.0,
            INVALID_PAYLOAD
        );
    }

    unsafe fn format(display: &[u8], value: &[u8], has_now: u8) -> (i32, Vec<u8>) {
        let mut pointer = std::ptr::null_mut();
        let mut len = 0;
        let status = unsafe {
            meridian_core_format_value(
                display.as_ptr(),
                display.len(),
                value.as_ptr(),
                value.len(),
                has_now,
                0.0,
                &mut pointer,
                &mut len,
            )
        };
        let data = if pointer.is_null() {
            Vec::new()
        } else {
            let data = unsafe { std::slice::from_raw_parts(pointer, len).to_vec() };
            unsafe {
                meridian_core_buffer_free(pointer, len);
            }
            data
        };
        (status, data)
    }

    #[test]
    fn native_round_trip_and_errors() {
        let display = ValueDisplay {
            r#type: ValueType::Integer as i32,
            ..Default::default()
        };
        let value = prost_types::Value {
            kind: Some(prost_types::value::Kind::NumberValue(1234.0)),
        };
        let (status, bytes) =
            unsafe { format(&display.encode_to_vec(), &value.encode_to_vec(), 0) };
        assert_eq!(status, OK);
        assert_eq!(
            FormattedValue::decode(bytes.as_slice()).unwrap().text,
            "1,234"
        );
        assert_eq!(unsafe { format(&[0xff], &[], 0) }.0, INVALID_PAYLOAD);
        assert_eq!(unsafe { format(&[], &[0xff], 0) }.0, INVALID_PAYLOAD);
        assert_eq!(unsafe { format(&[], &[], 2) }.0, INVALID_ARGUMENT);
    }

    #[test]
    fn nulls_and_caps_fail_before_dereferencing_inputs() {
        let mut pointer = std::ptr::dangling_mut();
        let mut len = 999;
        assert_eq!(
            unsafe {
                meridian_core_format_value(
                    std::ptr::null(),
                    MAX_DECLARATION_BYTES + 1,
                    std::ptr::null(),
                    0,
                    0,
                    0.0,
                    &mut pointer,
                    &mut len,
                )
            },
            LIMIT_EXCEEDED
        );
        assert!(pointer.is_null());
        assert_eq!(len, 0);
        assert_eq!(
            unsafe {
                meridian_core_format_value(
                    std::ptr::null(),
                    1,
                    std::ptr::null(),
                    0,
                    0,
                    0.0,
                    &mut pointer,
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(len, 0);
        len = 999;
        assert_eq!(
            unsafe {
                meridian_core_format_value(
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                    0,
                    0.0,
                    std::ptr::null_mut(),
                    &mut len,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(len, 0);
        unsafe {
            meridian_core_buffer_free(std::ptr::null_mut(), 0);
        }
    }

    #[test]
    fn regex_contract_and_raw_nul_strings() {
        let mut matched = 99;
        let call = |pattern: &[u8], text: &[u8], matched: &mut u8| unsafe {
            meridian_core_matches_form_pattern(
                pattern.as_ptr(),
                pattern.len(),
                text.as_ptr(),
                text.len(),
                matched,
            )
        };
        assert_eq!(call(br"^\d+$", "١٢".as_bytes(), &mut matched), OK);
        assert_eq!(matched, 1);
        assert_eq!(call(br"a\x00b", b"a\0b", &mut matched), OK);
        assert_eq!(matched, 1);
        assert_eq!(call(b"(?=a)", b"a", &mut matched), INVALID_PATTERN);
        assert_eq!(matched, 0);
        assert_eq!(call(&[0xff], b"a", &mut matched), INVALID_PAYLOAD);
    }

    #[test]
    fn malformed_dynamic_values_fail_without_coercion() {
        use prost_types::value::Kind;
        let nan = prost_types::Value {
            kind: Some(Kind::NumberValue(f64::NAN)),
        }
        .encode_to_vec();
        assert_eq!(unsafe { format(&[], &nan, 0) }.0, INVALID_PAYLOAD);
        let mut value = prost_types::Value {
            kind: Some(Kind::NullValue(0)),
        };
        for _ in 0..66 {
            value = prost_types::Value {
                kind: Some(Kind::ListValue(prost_types::ListValue {
                    values: vec![value],
                })),
            };
        }
        // Each logical list adds both a Value and ListValue wire level, so
        // prost rejects this encoding before the dynamic JSON depth guard.
        assert_eq!(
            unsafe { format(&[], &value.encode_to_vec(), 0) }.0,
            INVALID_PAYLOAD
        );
        assert_eq!(json(value, 0).unwrap_err(), LIMIT_EXCEEDED);
    }

    #[test]
    fn regex_nulls_and_caps_reset_the_result() {
        let mut matched = 99;
        assert_eq!(
            unsafe {
                meridian_core_matches_form_pattern(
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    MAX_VALUE_BYTES + 1,
                    &mut matched,
                )
            },
            LIMIT_EXCEEDED
        );
        assert_eq!(matched, 0);
        assert_eq!(
            unsafe {
                meridian_core_matches_form_pattern(
                    std::ptr::null(),
                    1,
                    std::ptr::null(),
                    0,
                    &mut matched,
                )
            },
            INVALID_ARGUMENT
        );
        assert_eq!(
            unsafe {
                meridian_core_matches_form_pattern(
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                )
            },
            INVALID_ARGUMENT
        );
    }

    #[test]
    fn dynamic_safe_integers_match_wasm_number_representation() {
        for (number, expected) in [(1.0, "1"), (-0.0, "0"), (2.5, "2.5")] {
            let value = prost_types::Value {
                kind: Some(prost_types::value::Kind::NumberValue(number)),
            };
            assert_eq!(json(value, 0).unwrap().to_string(), expected);
        }
    }
}
