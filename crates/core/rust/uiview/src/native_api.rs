//! Bounded in-process C ABI for native renderers. Semantic inputs/results are
//! protobuf bytes; pointers, lengths and status codes are runtime ownership
//! metadata, not an alternate serialized DTO contract.
use crate::proto::ValueDisplay;
use prost::Message;
use serde_json::Value;
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
/// pointer/len must be the exact pair returned by a successful native format
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
    use crate::proto::{FormattedValue, ValueType};

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
