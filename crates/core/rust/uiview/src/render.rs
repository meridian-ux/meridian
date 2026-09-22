use crate::paths::ProtoPaths;
use crate::proto::{
    value_display, ColumnFormat, GalleryPanel, NumberOptions, PrincipalDisplay, PrincipalOptions,
    TableColumn, TablePanel, TemporalPrecision, ValueDisplay, ValueType,
};
use serde_json::Value;

// One rendered row in the table. Each element of `cells` corresponds
// 1:1 to the column at the same index in the TablePanel's columns
// list. `raw` carries the source JSON object (so row actions can
// resolve row.field_path bindings against it).
pub struct RenderedRow {
    pub raw: Value,
    pub cells: Vec<String>,
}

/// Renders the `rows_field` of a JSON response into a sequence of
/// `RenderedRow`. Each row is paired with its rendered column cells
/// formatted per the TableColumn.format.
///
/// Mirrors the per-cell formatting in
/// meridian.ui.javafx.DescribedTableCard.renderValue, so the JavaFX
/// and TUI / web outputs match.
pub fn render_table(response: &Value, table: &TablePanel) -> Vec<RenderedRow> {
    let rows = ProtoPaths::rows(response, &table.rows_field);
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let cells: Vec<String> = table
            .columns
            .iter()
            .map(|col| format_cell(ProtoPaths::get(row, &col.field_path), col))
            .collect();
        out.push(RenderedRow {
            raw: row.clone(),
            cells,
        });
    }
    out
}

// One rendered card in a gallery. `raw` carries the source JSON object (so
// click/navigation can resolve against it); the slots are pre-formatted strings
// the host drops into the card chrome. `icon` is a key the host maps to a glyph.
pub struct RenderedCard {
    pub raw: Value,
    pub title: String,
    pub subtitle: String,
    pub icon: String,
    pub status: String,
    pub href: String,
    pub action_label: String,
}

/// Renders the `rows_field` of a JSON response into a sequence of `RenderedCard`,
/// mapping each row's fields to card slots per the GalleryPanel's CardSpec.
pub fn render_gallery(response: &Value, gallery: &GalleryPanel) -> Vec<RenderedCard> {
    let rows = ProtoPaths::rows(response, &gallery.rows_field);
    let card = gallery.card.clone().unwrap_or_default();
    // Read a dotted path as a display string; empty path or null -> "".
    let slot = |row: &Value, path: &str, display: Option<&ValueDisplay>| -> String {
        if path.is_empty() {
            return String::new();
        }
        let value = ProtoPaths::get(row, path);
        if let Some(display) = display {
            return format_display_value(value, display);
        }
        match value {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            v => v.to_string(),
        }
    };
    rows.iter()
        .map(|row| RenderedCard {
            title: slot(row, &card.title_field, card.title_display.as_ref()),
            subtitle: slot(row, &card.subtitle_field, card.subtitle_display.as_ref()),
            icon: slot(row, &card.icon_field, None),
            status: slot(row, &card.status_field, card.status_display.as_ref()),
            href: slot(row, &card.href_field, None),
            action_label: slot(row, &card.action_label_field, None),
            raw: (*row).clone(),
        })
        .collect()
}

/// Formats one JSON value per a TableColumn's format directive.
pub fn format_cell(value: &Value, column: &TableColumn) -> String {
    if let Some(display) = column.value_display.as_ref() {
        return format_display_value(value, display);
    }
    let format = ColumnFormat::try_from(column.format).unwrap_or(ColumnFormat::Unspecified);
    format_value(value, format)
}

/// Formats a table cell according to the shared `ValueDisplay` contract.
///
/// `ValueDisplay` is additive to the older `ColumnFormat`: callers that do not
/// declare it retain the legacy formatter byte-for-byte, while the web WASM
/// path and the native TUI now read the same semantic declaration. Types whose
/// decoration is surface-specific (links and principal email titles) return
/// readable text here; a renderer can add decoration without changing the
/// value's meaning.
pub fn format_display_value(value: &Value, display: &ValueDisplay) -> String {
    const EMPTY: &str = "—";
    if value.is_null() {
        return EMPTY.to_string();
    }

    let value_type = ValueType::try_from(display.r#type).unwrap_or(ValueType::Unspecified);
    match value_type {
        ValueType::Boolean => value
            .as_bool()
            .map(|value| if value { "Yes" } else { "No" }.to_string())
            .unwrap_or_else(|| format_display_scalar(value)),
        ValueType::List => match value {
            Value::Array(items) if items.is_empty() => EMPTY.to_string(),
            Value::Array(items) => items
                .iter()
                .map(format_display_scalar)
                .collect::<Vec<_>>()
                .join(", "),
            _ => format_display_scalar(value),
        },
        ValueType::Integer | ValueType::Decimal | ValueType::Money | ValueType::Percent => {
            let options = match display.options.as_ref() {
                Some(value_display::Options::Number(options)) => Some(options),
                _ => None,
            };
            format_display_number(value, options)
        }
        ValueType::Json => match value {
            Value::String(value) => value.clone(),
            _ => serde_json::to_string(value).unwrap_or_else(|_| value.to_string()),
        },
        ValueType::Principal => {
            let options = match display.options.as_ref() {
                Some(value_display::Options::Principal(options)) => Some(options),
                _ => None,
            };
            format_principal_value(value, options, PrincipalDisplay::Unspecified)
        }
        ValueType::Email => {
            let options = match display.options.as_ref() {
                Some(value_display::Options::Principal(options)) => Some(options),
                _ => None,
            };
            format_principal_value(value, options, PrincipalDisplay::Email)
        }
        ValueType::Unspecified
        | ValueType::Text
        | ValueType::MultilineText
        | ValueType::Enum
        | ValueType::Date
        | ValueType::DateTime
        | ValueType::Time
        | ValueType::Duration
        | ValueType::Url
        | ValueType::Identifier => {
            let text = value.as_str();
            match value_type {
                ValueType::Date | ValueType::DateTime => text
                    .and_then(|text| format_temporal(text, value_type))
                    .unwrap_or_else(|| format_display_scalar(value)),
                ValueType::Time => {
                    let precision = match display.options.as_ref() {
                        Some(value_display::Options::Temporal(options)) => {
                            TemporalPrecision::try_from(options.precision)
                                .unwrap_or(TemporalPrecision::Unspecified)
                        }
                        _ => TemporalPrecision::Unspecified,
                    };
                    text.and_then(|text| format_time(text, precision))
                        .unwrap_or_else(|| format_display_scalar(value))
                }
                _ => format_display_scalar(value),
            }
        }
    }
}

/// Format the scalar principal label shared by native read surfaces.
///
/// The wire-compatible rich form is `Name <email>`; a plain name or address
/// remains a valid fallback. Native surfaces cannot attach a browser title, so
/// NAME_WITH_EMAIL_TITLE uses the name as its visible text and preserves the
/// same readable fallback as NAME.
fn format_principal_value(
    value: &Value,
    options: Option<&PrincipalOptions>,
    default_display: PrincipalDisplay,
) -> String {
    let text = format_display_scalar(value);
    if text.is_empty() {
        return "—".to_string();
    }
    let is_email = |email: &str| {
        let Some((local, domain)) = email.split_once('@') else {
            return false;
        };
        !local.is_empty()
            && !domain.is_empty()
            && !domain.contains('@')
            && !email
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, '<' | '>'))
    };
    let (name, email) = if let Some(open) = text.find('<') {
        if text.ends_with('>') && open > 0 {
            let name = text[..open].trim();
            let email = &text[open + 1..text.len() - 1];
            if !name.is_empty() && !name.contains('>') && is_email(email) {
                (name.to_string(), Some(email.to_string()))
            } else {
                (text.clone(), None)
            }
        } else {
            (text.clone(), None)
        }
    } else if is_email(&text) {
        (text.clone(), Some(text.clone()))
    } else {
        (text, None)
    };

    let display = options
        .and_then(|value| PrincipalDisplay::try_from(value.display).ok())
        .unwrap_or(default_display);
    if display == PrincipalDisplay::Email {
        return email.unwrap_or(name);
    }
    name
}

fn format_temporal(text: &str, value_type: ValueType) -> Option<String> {
    let bytes = text.as_bytes();
    if bytes.len() < 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let year = text[0..4].parse::<u16>().ok()?;
    let month = text[5..7].parse::<u8>().ok()?;
    let day = text[8..10].parse::<u8>().ok()?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    if value_type == ValueType::Date || text.len() == 10 {
        return Some(format!(
            "{} {}, {}",
            months[(month - 1) as usize],
            day,
            year
        ));
    }
    if text.len() < 16 || !matches!(text.as_bytes().get(10), Some(b'T' | b' ')) {
        return None;
    }
    let hour = text[11..13].parse::<u8>().ok()?;
    let minute = text[14..16].parse::<u8>().ok()?;
    if hour > 23 || minute > 59 || text.as_bytes()[13] != b':' {
        return None;
    }
    let suffix = if hour >= 12 { "PM" } else { "AM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    Some(format!(
        "{} {}, {}, {}:{:02} {} UTC",
        months[(month - 1) as usize],
        day,
        year,
        display_hour,
        minute,
        suffix
    ))
}

fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn format_time(text: &str, precision: TemporalPrecision) -> Option<String> {
    let bytes = text.as_bytes();
    if bytes.len() != 5 && bytes.len() != 8 {
        return None;
    }
    if bytes[2] != b':' || !bytes[..2].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let hour = text[0..2].parse::<u8>().ok()?;
    let minute = text[3..5].parse::<u8>().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    let second = if bytes.len() == 8 {
        if bytes[5] != b':' || !bytes[6..8].iter().all(u8::is_ascii_digit) {
            return None;
        }
        let second = text[6..8].parse::<u8>().ok()?;
        if second > 59 {
            return None;
        }
        Some(second)
    } else {
        None
    };
    let suffix = if hour >= 12 { "PM" } else { "AM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    let seconds = if precision == TemporalPrecision::Second {
        second
            .map(|value| format!(":{:02}", value))
            .unwrap_or_default()
    } else {
        String::new()
    };
    Some(format!(
        "{}:{:02}{} {} UTC",
        display_hour, minute, seconds, suffix
    ))
}

fn format_display_scalar(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Null => "—".to_string(),
        _ => value.to_string(),
    }
}

fn format_display_number(value: &Value, options: Option<&NumberOptions>) -> String {
    let Some(number) = value.as_f64() else {
        return format_display_scalar(value);
    };
    if let Some(fraction_digits) = options.and_then(|options| options.fraction_digits) {
        // The same bound as the browser formatter: never allocate a
        // descriptor-controlled number of digits outside the supported range.
        if (0..=100).contains(&fraction_digits) {
            return format_declared_fixed(number, fraction_digits as usize);
        }
    }
    format_display_scalar(value)
}

/// Fixed precision rounds the stored binary64 value to nearest, with exact
/// ties away from zero (ECMAScript toFixed). Legacy ColumnFormat is unchanged.
fn format_declared_fixed(number: f64, digits: usize) -> String {
    // Negative zero itself has no sign in toFixed; negative nonzero values that
    // round to zero still do. Rust's formatter otherwise handles sign/precision.
    let number = if number == 0.0 { 0.0 } else { number };
    let mut text = format!("{number:.digits$}");
    let bits = number.abs().to_bits();
    let biased_exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1u64 << 52) - 1)) | if biased_exponent == 0 { 0 } else { 1u64 << 52 };
    if mantissa == 0 || biased_exponent == 0x7ff {
        return text;
    }
    // x = odd * 2^exponent. Multiplication by 10^digits contributes
    // 2^digits * 5^digits. A half-integer occurs exactly when exponent+digits
    // is -1. Since 5^digits == 1 (mod 4), odd == 1 (mod 4) identifies the
    // ties Rust rounded DOWN to even; the other ties already rounded up.
    // This avoids double rounding/overflow from multiplying x by 10^digits.
    let zeros = mantissa.trailing_zeros();
    let odd = mantissa >> zeros;
    let exponent = biased_exponent.max(1) - 1023 - 52 + zeros as i32;
    if exponent + digits as i32 == -1 && odd % 4 == 1 {
        // A down-rounded even last digit is in 0,2,4,6,8; no carry is needed.
        let last = text.pop().expect("fixed decimal is nonempty");
        text.push(char::from(last as u8 + 1));
    }
    text
}

/// Standalone formatter — also used by wasm wrappers that want to
/// format a single value without a TableColumn handy.
pub fn format_value(value: &Value, format: ColumnFormat) -> String {
    if value.is_null() {
        return String::new();
    }
    match format {
        ColumnFormat::Float2dp => value
            .as_f64()
            .map(|n| format!("{:.2}", n))
            .unwrap_or_else(|| value.to_string()),
        ColumnFormat::Integer => value
            .as_i64()
            .map(|n| n.to_string())
            .unwrap_or_else(|| value.to_string()),
        ColumnFormat::EnumName | ColumnFormat::String | ColumnFormat::Unspecified => match value {
            Value::String(s) => s.clone(),
            _ => value.to_string(),
        },
        ColumnFormat::StringList => match value {
            Value::Array(items) => items
                .iter()
                .map(|item| match item {
                    Value::String(s) => s.clone(),
                    _ => item.to_string(),
                })
                .collect::<Vec<_>>()
                .join(", "),
            _ => value.to_string(),
        },
        ColumnFormat::Timestamp => match value {
            Value::String(s) => s.clone(),
            _ => value.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_value_type_conformance_corpus() {
        use prost::Message;
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../../schemas/conformance/value_types.json"
        ))
        .unwrap();
        let mut covered = std::collections::BTreeSet::new();
        for entry in corpus["cases"].as_array().unwrap() {
            let kind = entry["type"].as_i64().unwrap() as i32;
            let display = ValueDisplay {
                r#type: kind,
                options: entry["digits"].as_i64().map(|digits| {
                    value_display::Options::Number(crate::proto::NumberOptions {
                        fraction_digits: Some(digits as i32),
                        ..Default::default()
                    })
                }),
                ..Default::default()
            };
            let bytes = display.encode_to_vec();
            let decoded = ValueDisplay::decode(bytes.as_slice()).unwrap();
            let raw = entry["raw"].clone();
            assert_eq!(
                format_display_value(&raw, &decoded),
                entry["expected"].as_str().unwrap(),
                "{}",
                entry["name"]
            );
            assert_eq!(format_display_value(&Value::Null, &decoded), "—");
            assert_eq!(raw, entry["raw"]);
            assert_eq!(decoded.encode_to_vec(), bytes);
            if kind > 0 && ValueType::try_from(kind).is_ok() {
                covered.insert(kind);
            }
        }
        let declared: std::collections::BTreeSet<_> = (1..)
            .take_while(|kind| ValueType::try_from(*kind).is_ok())
            .collect();
        assert_eq!(covered, declared);
    }
    use crate::proto::value_display;
    use serde_json::json;

    #[test]
    fn gallery_wire_displays_preserve_raw_rows_and_navigation() {
        use crate::proto::CardSpec;
        use prost::Message;

        let panel = GalleryPanel {
            rows_field: "items".into(),
            card: Some(CardSpec {
                title_field: "created".into(),
                title_display: Some(ValueDisplay {
                    r#type: ValueType::Date as i32,
                    ..Default::default()
                }),
                subtitle_field: "amount".into(),
                subtitle_display: Some(ValueDisplay {
                    r#type: ValueType::Decimal as i32,
                    options: Some(value_display::Options::Number(NumberOptions {
                        fraction_digits: Some(2),
                        ..Default::default()
                    })),
                    ..Default::default()
                }),
                status_field: "active".into(),
                status_display: Some(ValueDisplay {
                    r#type: ValueType::Boolean as i32,
                    ..Default::default()
                }),
                href_field: "href".into(),
                action_label_field: "action".into(),
                image_field: "image".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut panel = GalleryPanel::decode(panel.encode_to_vec().as_slice()).unwrap();
        let response = json!({"items": [{
            "created": "2026-03-29", "amount": -1.125, "active": false,
            "href": "/runs/123", "action": "Manage", "image": "slide.png"
        }]});
        let cards = render_gallery(&response, &panel);
        assert_eq!(cards[0].title, "Mar 29, 2026");
        assert_eq!(cards[0].subtitle, "-1.13");
        assert_eq!(cards[0].status, "No");
        assert_eq!(cards[0].href, "/runs/123");
        assert_eq!(cards[0].action_label, "Manage");
        assert_eq!(cards[0].raw, response["items"][0]);
        assert_eq!(panel.card.as_ref().unwrap().image_field, "image");

        let card = panel.card.as_mut().unwrap();
        card.title_display = None;
        card.subtitle_display = None;
        card.status_display = None;
        let legacy = render_gallery(&response, &panel);
        assert_eq!(legacy[0].title, "2026-03-29");
        assert_eq!(legacy[0].subtitle, "-1.125");
        assert_eq!(legacy[0].status, "false");

        let card = panel.card.as_mut().unwrap();
        card.title_field.clear();
        card.title_display = Some(ValueDisplay::default());
        card.subtitle_field = "missing".into();
        let empty = render_gallery(&response, &panel);
        assert_eq!(empty[0].title, "");
        assert_eq!(empty[0].subtitle, "");
    }

    #[test]
    fn formats_float_two_dp() {
        assert_eq!(format_value(&json!(0.954), ColumnFormat::Float2dp), "0.95");
    }

    #[test]
    fn formats_string_list() {
        assert_eq!(
            format_value(&json!(["a", "b", "c"]), ColumnFormat::StringList),
            "a, b, c",
        );
    }

    #[test]
    fn value_display_overrides_legacy_column_format() {
        let column = TableColumn {
            format: ColumnFormat::Float2dp as i32,
            value_display: Some(ValueDisplay {
                r#type: ValueType::Boolean as i32,
                options: None,
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(format_cell(&json!(true), &column), "Yes");
    }

    #[test]
    fn declared_numeric_rounding_matches_browser_after_wire_decode() {
        use crate::proto::StatPanel;
        use crate::stat::compute_stat;
        use prost::Message;
        // Paired with value_display.test.ts. Include ties rounded down/up by
        // nearest-even, adjacent binary values, signs and the precision limit.
        for (value, digits, expected) in [
            (12.5, 0, "13"), (-12.5, 0, "-13"), (13.5, 0, "14"),
            (1.125, 2, "1.13"), (-1.125, 2, "-1.13"), (1.375, 2, "1.38"),
            (9.5, 0, "10"), (2.675, 2, "2.67"), (1.005, 2, "1.00"),
            (0.49999999999999994, 0, "0"), (0.5000000000000001, 0, "1"),
            (-0.0, 2, "0.00"), (-0.01, 0, "-0"),
            (2.0_f64.powi(-101), 100,
             "0.0000000000000000000000000000003944304526105059027058642826413931148366032175545115023851394653320313"),
        ] {
            for kind in [ValueType::Integer, ValueType::Decimal, ValueType::Money, ValueType::Percent] {
                let display = ValueDisplay {
                    r#type: kind as i32,
                    options: Some(value_display::Options::Number(NumberOptions {
                        fraction_digits: Some(digits), ..Default::default()
                    })), ..Default::default()
                };
                let display = ValueDisplay::decode(display.encode_to_vec().as_slice()).unwrap();
                assert_eq!(format_display_value(&json!(value), &display), expected, "{value}, {digits}");
                let table = TablePanel { rows_field: "rows".into(), columns: vec![TableColumn {
                    field_path: "value".into(), value_display: Some(display.clone()),
                    format: ColumnFormat::Float2dp as i32, ..Default::default()
                }], ..Default::default() };
                assert_eq!(render_table(&json!({"rows": [{"value": value}]}), &table)[0].cells, [expected]);
                let stat = StatPanel { value, value_display: Some(display), ..Default::default() };
                let stat = StatPanel::decode(stat.encode_to_vec().as_slice()).unwrap();
                assert_eq!(compute_stat(&stat).formatted_value, expected);
            }
        }
        // The additive ValueDisplay change must not silently migrate old columns.
        assert_eq!(format_value(&json!(1.125), ColumnFormat::Float2dp), "1.12");
        assert_eq!(
            format_declared_fixed(f64::from_bits(1), 100),
            format!("0.{}", "0".repeat(100))
        );
    }

    #[test]
    fn numeric_precision_is_bounded_after_wire_decode() {
        use prost::Message;
        // Paired with the browser formatter's precision conformance cases.
        let at_limit = format!("1.125{}", "0".repeat(97));
        for value_type in [
            ValueType::Integer,
            ValueType::Decimal,
            ValueType::Money,
            ValueType::Percent,
        ] {
            for (digits, expected) in [
                (None, "1.125"),
                (Some(0), "1"),
                (Some(3), "1.125"),
                (Some(100), at_limit.as_str()),
                (Some(-1), "1.125"),
                (Some(i32::MIN), "1.125"),
                (Some(101), "1.125"),
                (Some(i32::MAX), "1.125"),
            ] {
                let display = ValueDisplay {
                    r#type: value_type as i32,
                    options: Some(value_display::Options::Number(NumberOptions {
                        fraction_digits: digits,
                        ..Default::default()
                    })),
                    ..Default::default()
                };
                let display = ValueDisplay::decode(display.encode_to_vec().as_slice()).unwrap();
                let table = TablePanel {
                    rows_field: "rows".into(),
                    columns: vec![TableColumn {
                        field_path: "amount".into(),
                        format: ColumnFormat::Float2dp as i32,
                        value_display: Some(display),
                        ..Default::default()
                    }],
                    ..Default::default()
                };
                let rows = render_table(
                    &json!({"rows": [{"amount": 1.125}, {"amount": "001.125"}, {"amount": null}]}),
                    &table,
                );
                assert_eq!(rows[0].cells, [expected], "{value_type:?}: {digits:?}");
                assert_eq!(rows[1].cells, ["001.125"]);
                assert_eq!(rows[2].cells, ["—"]);
            }
        }
    }

    #[test]
    fn value_display_formats_lists_and_declared_precision() {
        let list = ValueDisplay {
            r#type: ValueType::List as i32,
            options: None,
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!(["one", "two"]), &list),
            "one, two"
        );

        let decimal = ValueDisplay {
            r#type: ValueType::Decimal as i32,
            options: Some(value_display::Options::Number(NumberOptions {
                fraction_digits: Some(2),
                ..Default::default()
            })),
            ..Default::default()
        };
        assert_eq!(format_display_value(&json!(1.236), &decimal), "1.24");
    }

    #[test]
    fn value_display_formats_principal_name_and_email_modes() {
        let name = ValueDisplay {
            r#type: ValueType::Principal as i32,
            options: None,
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!("Ruchi Sharma <ruchi@example.com>"), &name),
            "Ruchi Sharma"
        );

        let email = ValueDisplay {
            r#type: ValueType::Principal as i32,
            options: Some(value_display::Options::Principal(PrincipalOptions {
                display: PrincipalDisplay::Email as i32,
                ..Default::default()
            })),
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!("Ruchi Sharma <ruchi@example.com>"), &email),
            "ruchi@example.com"
        );
        assert_eq!(
            format_display_value(&json!("ruchi@example.com"), &name),
            "ruchi@example.com"
        );
        let address = ValueDisplay {
            r#type: ValueType::Email as i32,
            options: None,
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!("Ruchi Sharma <ruchi@example.com>"), &address),
            "ruchi@example.com"
        );
    }

    #[test]
    fn principal_modes_preserve_malformed_labels_and_handle_empty_values() {
        for mode in [
            PrincipalDisplay::Unspecified as i32,
            PrincipalDisplay::Name as i32,
            PrincipalDisplay::Email as i32,
            PrincipalDisplay::NameWithEmailTitle as i32,
            99,
        ] {
            let display = ValueDisplay {
                r#type: ValueType::Principal as i32,
                options: Some(value_display::Options::Principal(PrincipalOptions {
                    display: mode,
                    ..Default::default()
                })),
                ..Default::default()
            };
            for value in [
                "Ruchi Sharma",
                "ruchi@example.com",
                "Name <@example.com>",
                "Name <user@>",
                "Name <user@@example.com>",
                "Name < user@example.com>",
                "Name <<user@example.com>>",
                " <user@example.com>",
                "Name <user@example.com> trailing",
                "Name <user@example.com>\n",
                "Name <user\u{0085}@example.com>",
            ] {
                assert_eq!(
                    format_display_value(&json!(value), &display),
                    value,
                    "mode {mode}"
                );
            }
            assert_eq!(format_display_value(&Value::Null, &display), "—");
            assert_eq!(format_display_value(&json!(""), &display), "—");
            let expected = if mode == PrincipalDisplay::Email as i32 {
                "ruchi@example.com"
            } else {
                "Ruchi Sharma"
            };
            assert_eq!(
                format_display_value(&json!("Ruchi Sharma <ruchi@example.com>"), &display),
                expected
            );
        }
        assert_eq!(
            format_cell(
                &json!("Ruchi Sharma <ruchi@example.com>"),
                &TableColumn::default()
            ),
            "Ruchi Sharma <ruchi@example.com>"
        );
    }

    #[test]
    fn value_display_formats_declared_temporal_values_deterministically() {
        let date = ValueDisplay {
            r#type: ValueType::Date as i32,
            options: None,
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!("2026-03-29"), &date),
            "Mar 29, 2026"
        );

        let date_time = ValueDisplay {
            r#type: ValueType::DateTime as i32,
            options: None,
            ..Default::default()
        };
        assert_eq!(
            format_display_value(&json!("2026-03-21T09:14:00Z"), &date_time),
            "Mar 21, 2026, 9:14 AM UTC"
        );
        assert_eq!(
            format_display_value(&json!("not-a-date"), &date_time),
            "not-a-date"
        );

        let time = ValueDisplay {
            r#type: ValueType::Time as i32,
            options: Some(value_display::Options::Temporal(
                crate::proto::TemporalOptions {
                    precision: TemporalPrecision::Minute as i32,
                    ..Default::default()
                },
            )),
            ..Default::default()
        };
        assert_eq!(format_display_value(&json!("09:14"), &time), "9:14 AM UTC");
        let seconds = ValueDisplay {
            options: Some(value_display::Options::Temporal(
                crate::proto::TemporalOptions {
                    precision: TemporalPrecision::Second as i32,
                    ..Default::default()
                },
            )),
            ..time.clone()
        };
        assert_eq!(
            format_display_value(&json!("21:14:07"), &seconds),
            "9:14:07 PM UTC"
        );
        assert_eq!(
            format_display_value(&json!("2026-02-29"), &date),
            "2026-02-29"
        );
    }

    #[test]
    fn render_table_maps_rows_to_cells() {
        let response = json!({
            "claims": [
                {"confidence": 0.95, "text": "fast-setting"},
                {"confidence": 0.78, "text": "non-shrink"},
            ]
        });
        let table = TablePanel {
            populate: None,
            rows_field: "claims".into(),
            item_noun: "claims".into(),
            placeholder: String::new(),
            columns: vec![
                TableColumn {
                    header: "confidence".into(),
                    field_path: "confidence".into(),
                    format: ColumnFormat::Float2dp as i32,
                    // `..Default::default()` rather than an exhaustive list: the
                    // schema grows additively (value_display arrived in 0.22.0),
                    // and a fixture that enumerates every field breaks on each
                    // new one while testing nothing about it.
                    ..Default::default()
                },
                TableColumn {
                    header: "claim".into(),
                    field_path: "text".into(),
                    format: ColumnFormat::String as i32,
                    ..Default::default()
                },
            ],
            actions: vec![],
            pagination: None,
        };
        let rendered = render_table(&response, &table);
        assert_eq!(rendered.len(), 2);
        assert_eq!(rendered[0].cells, vec!["0.95", "fast-setting"]);
        assert_eq!(rendered[1].cells, vec!["0.78", "non-shrink"]);
    }
}
