//! Validate native form input without coercing transport values. This is the
//! platform-neutral twin of schemas/src/uiview/form_values.ts.
use crate::proto::{form_field::Kind, repeated_field::Element, FormField};
use serde_json::Value;
use std::collections::HashSet;

/// Validate all declared fields before returning a request to a host. Undeclared
/// prefill properties may be retained, but never substitute for missing fields.
pub fn validate_form_values(fields: &[FormField], values: &Value) -> Result<(), String> {
    validate_object(fields, values, 0)
}

/// One Rust Unicode regex contract for native fields and the browser WASM bridge.
/// Default regex compilation limits reject unsupported or excessive patterns.
pub(crate) fn matches_pattern(pattern: &str, value: &str) -> Result<bool, regex::Error> {
    regex::Regex::new(pattern).map(|regex| regex.is_match(value))
}

fn validate_object(fields: &[FormField], values: &Value, depth: usize) -> Result<(), String> {
    if depth > 64 {
        return Err("form nesting exceeds 64 levels".into());
    }
    let object = values.as_object().ok_or("invalid object")?;
    let mut names = HashSet::new();
    for field in fields {
        if field.field_id.is_empty() || !names.insert(&field.field_id) {
            return Err("field identifiers must be nonempty and unique".into());
        }
        validate(
            field,
            object.get(&field.field_id).unwrap_or(&Value::Null),
            depth,
        )
        .map_err(|error| format!("{}: {error}", field.field_id))?;
    }
    Ok(())
}

fn text(value: &Value, min: i32, max: i32, pattern: &str, message: &str) -> Result<(), String> {
    let value = value.as_str().ok_or("invalid text")?;
    // JS string length counts UTF-16 code units; preserve the same contract.
    let length = value.encode_utf16().count();
    if (min > 0 && length < min as usize) || (max > 0 && length > max as usize) {
        return Err("invalid length".into());
    }
    if !pattern.is_empty() && !matches_pattern(pattern, value).map_err(|_| "invalid pattern")? {
        return Err(if message.is_empty() {
            "invalid value"
        } else {
            message
        }
        .into());
    }
    Ok(())
}

fn number(value: &Value, min: f64, max: f64, integer: bool) -> Result<(), String> {
    let value = value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or("invalid number")?;
    if (integer && (value.fract() != 0.0 || value.abs() > 9_007_199_254_740_991.0))
        || (min != 0.0 && value < min)
        || (max != 0.0 && value > max)
    {
        return Err("invalid number".into());
    }
    Ok(())
}

fn validate(field: &FormField, value: &Value, depth: usize) -> Result<(), String> {
    if depth > 64 {
        return Err("form nesting exceeds 64 levels".into());
    }
    match field.kind.as_ref() {
        Some(Kind::Text(spec)) => text(
            value,
            spec.min_length,
            spec.max_length,
            &spec.pattern,
            &spec.pattern_error_msg,
        ),
        Some(Kind::Masked(spec)) => text(
            value,
            spec.min_length,
            spec.max_length,
            &spec.pattern,
            &spec.pattern_error_msg,
        ),
        Some(Kind::Integer(spec)) => number(value, spec.min as f64, spec.max as f64, true),
        Some(Kind::Number(spec)) => number(value, spec.min, spec.max, false),
        Some(Kind::Boolean(_)) => value.as_bool().map(|_| ()).ok_or("invalid boolean".into()),
        Some(Kind::EnumSelection(spec)) => {
            let token = value.as_str().ok_or("invalid enum token")?;
            let allowed = if spec.options.is_empty() {
                spec.allowed_values.iter().any(|option| option == token)
            } else {
                spec.options.iter().any(|option| option.value == token)
            };
            if allowed {
                Ok(())
            } else {
                Err("select an allowed value".into())
            }
        }
        Some(Kind::Nested(spec)) => validate_object(&spec.fields, value, depth + 1),
        Some(Kind::Repeated(spec)) => {
            let items = value.as_array().ok_or("invalid array")?;
            if items.len() < spec.min_items as usize
                || (spec.max_items > 0 && items.len() > spec.max_items as usize)
            {
                return Err("invalid item count".into());
            }
            let element = spec
                .element
                .as_ref()
                .ok_or("unsupported repeated element")?;
            for (index, item) in items.iter().enumerate() {
                match element {
                    Element::Scalar(field) => validate(field, item, depth + 1),
                    Element::Object(object) => validate_object(&object.fields, item, depth + 1),
                }
                .map_err(|error| format!("item {}: {error}", index + 1))?;
            }
            Ok(())
        }
        Some(Kind::KeyValueMap(spec)) => {
            let entries = value.as_object().ok_or("invalid map")?;
            if entries.values().any(|value| !value.is_string())
                || (spec.max_items > 0 && entries.len() > spec.max_items as usize)
            {
                Err("invalid map".into())
            } else {
                Ok(())
            }
        }
        None => Err("unsupported field kind".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::{
        BooleanToggle, EnumOption, EnumSelection, IntegerSpinner, KeyValueMapField, NestedForm,
        NumberInput, RepeatedField, TextInput,
    };
    use serde_json::json;
    fn field(kind: Kind) -> FormField {
        FormField {
            field_id: "value".into(),
            kind: Some(kind),
            ..Default::default()
        }
    }
    fn check(kind: Kind, value: Value) -> Result<(), String> {
        validate_form_values(&[field(kind)], &json!({"value": value}))
    }
    #[test]
    fn scalar_values_are_not_coerced_or_rounded() {
        for (kind, valid, bad) in [
            (
                Kind::Boolean(BooleanToggle::default()),
                json!(false),
                json!("false"),
            ),
            (
                Kind::Integer(IntegerSpinner::default()),
                json!(0),
                json!(1.5),
            ),
            (
                Kind::Number(NumberInput::default()),
                json!(0.25),
                json!("0.25"),
            ),
            (Kind::Text(TextInput::default()), json!(""), json!(false)),
        ] {
            assert!(check(kind.clone(), valid).is_ok());
            assert!(check(kind, bad).is_err());
        }
        assert!(check(
            Kind::Integer(IntegerSpinner::default()),
            json!(9_007_199_254_740_992_u64)
        )
        .is_err());
    }
    #[test]
    fn bounds_patterns_and_utf16_lengths_match_browser_contract() {
        assert!(check(
            Kind::Text(TextInput {
                min_length: 2,
                max_length: 2,
                ..Default::default()
            }),
            json!("🦀")
        )
        .is_ok());
        assert!(check(
            Kind::Text(TextInput {
                pattern: "[".into(),
                ..Default::default()
            }),
            json!("text")
        )
        .unwrap_err()
        .contains("invalid pattern"));
        assert!(check(
            Kind::Text(TextInput {
                pattern: "ready".into(),
                ..Default::default()
            }),
            json!("already ready")
        )
        .is_ok());
        assert!(check(
            Kind::Number(NumberInput {
                min: 1.0,
                max: 2.0,
                ..Default::default()
            }),
            json!(0)
        )
        .is_err());
    }
    #[test]
    fn enum_options_take_precedence_over_legacy_tokens() {
        let kind = Kind::EnumSelection(EnumSelection {
            allowed_values: vec!["legacy".into()],
            options: vec![EnumOption {
                value: "new".into(),
                ..Default::default()
            }],
            ..Default::default()
        });
        assert!(check(kind.clone(), json!("new")).is_ok());
        assert!(check(kind, json!("legacy")).is_err());
    }
    #[test]
    fn nested_arrays_and_maps_validate_recursively() {
        let leaf = field(Kind::Boolean(BooleanToggle::default()));
        let nested = Kind::Nested(NestedForm {
            fields: vec![leaf.clone()],
        });
        assert!(check(nested.clone(), json!({"value": false})).is_ok());
        assert!(check(nested, json!({"value": "false"})).is_err());
        let repeated = Kind::Repeated(Box::new(RepeatedField {
            min_items: 1,
            max_items: 2,
            element: Some(Element::Object(NestedForm { fields: vec![leaf] })),
            ..Default::default()
        }));
        assert!(check(repeated.clone(), json!([{ "value": false }])).is_ok());
        assert!(check(repeated.clone(), json!([])).is_err());
        assert!(check(repeated, json!([{ "value": "false" }])).is_err());
        assert!(check(
            Kind::KeyValueMap(KeyValueMapField::default()),
            json!({"zero": "0", "empty": ""})
        )
        .is_ok());
        assert!(check(
            Kind::KeyValueMap(KeyValueMapField::default()),
            json!({"bad": 0})
        )
        .is_err());
    }
    #[test]
    fn missing_duplicate_and_unsupported_fields_fail_closed() {
        let leaf = field(Kind::Text(TextInput::default()));
        assert!(validate_form_values(std::slice::from_ref(&leaf), &json!({})).is_err());
        assert!(validate_form_values(&[leaf.clone(), leaf], &json!({"value": ""})).is_err());
        assert!(validate_form_values(
            &[FormField {
                field_id: "unset".into(),
                ..Default::default()
            }],
            &json!({"unset": null})
        )
        .is_err());
        assert!(check(Kind::Repeated(Box::default()), json!([])).is_err());
    }

    #[test]
    fn recursion_limit_applies_to_each_kind_of_compound_value() {
        for shape in ["nested", "scalar", "object"] {
            for (levels, empty, valid) in [(64, false, true), (65, false, false), (64, true, false)]
            {
                let mut leaf = field(if empty {
                    Kind::Nested(NestedForm::default())
                } else {
                    Kind::Text(TextInput::default())
                });
                let mut value = if empty { json!({}) } else { json!("") };
                for _ in 0..levels {
                    if shape == "nested" {
                        leaf = field(Kind::Nested(NestedForm { fields: vec![leaf] }));
                        value = json!({"value": value});
                    } else {
                        let element = if shape == "scalar" {
                            Element::Scalar(Box::new(leaf))
                        } else {
                            Element::Object(NestedForm { fields: vec![leaf] })
                        };
                        leaf = field(Kind::Repeated(Box::new(RepeatedField {
                            element: Some(element),
                            ..Default::default()
                        })));
                        value = if shape == "scalar" {
                            json!([value])
                        } else {
                            json!([{ "value": value }])
                        };
                    }
                }
                let result = validate_form_values(&[leaf], &json!({"value": value}));
                assert_eq!(
                    result.is_ok(),
                    valid,
                    "{shape}, {levels}, empty={empty}: {result:?}"
                );
                if !valid {
                    assert!(result.unwrap_err().contains("64"));
                }
            }
        }
    }

    #[test]
    fn object_identity_rules_do_not_apply_to_positional_scalar_elements() {
        let leaf = field(Kind::Text(TextInput::default()));
        for fields in [
            vec![leaf.clone(), leaf],
            vec![FormField {
                field_id: String::new(),
                kind: Some(Kind::Text(TextInput::default())),
                ..Default::default()
            }],
        ] {
            let nested = Kind::Nested(NestedForm {
                fields: fields.clone(),
            });
            assert!(check(nested, json!({"value": "", "": ""})).is_err());
            let repeated = Kind::Repeated(Box::new(RepeatedField {
                element: Some(Element::Object(NestedForm { fields })),
                ..Default::default()
            }));
            assert!(check(repeated, json!([{ "value": "", "": "" }])).is_err());
        }
        let scalar = Kind::Repeated(Box::new(RepeatedField {
            element: Some(Element::Scalar(Box::new(FormField {
                kind: Some(Kind::Text(TextInput::default())),
                ..Default::default()
            }))),
            ..Default::default()
        }));
        assert!(check(scalar, json!([""])).is_ok());
    }
}
