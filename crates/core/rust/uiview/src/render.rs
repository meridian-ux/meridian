use crate::paths::ProtoPaths;
use crate::proto::{
    value_display, ColumnFormat, GalleryPanel, NumberOptions, TableColumn, TablePanel,
    ValueDisplay, ValueType,
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
    let slot = |row: &Value, path: &str| -> String {
        if path.is_empty() {
            return String::new();
        }
        match ProtoPaths::get(row, path) {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            v => v.to_string(),
        }
    };
    rows.iter()
        .map(|row| RenderedCard {
            title: slot(row, &card.title_field),
            subtitle: slot(row, &card.subtitle_field),
            icon: slot(row, &card.icon_field),
            status: slot(row, &card.status_field),
            href: slot(row, &card.href_field),
            action_label: slot(row, &card.action_label_field),
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
/// display is surface-specific (links, rich principals, and localized temporal
/// labels) retain their wire text here; a renderer can add decoration without
/// changing the value's meaning.
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
        ValueType::Unspecified
        | ValueType::Text
        | ValueType::MultilineText
        | ValueType::Enum
        | ValueType::Date
        | ValueType::DateTime
        | ValueType::Time
        | ValueType::Duration
        | ValueType::Principal
        | ValueType::Email
        | ValueType::Url
        | ValueType::Identifier => format_display_scalar(value),
    }
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
        if fraction_digits >= 0 {
            return format!("{:.*}", fraction_digits as usize, number);
        }
    }
    format_display_scalar(value)
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
    use crate::proto::value_display;
    use serde_json::json;

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
            }),
            ..Default::default()
        };
        assert_eq!(format_cell(&json!(true), &column), "Yes");
    }

    #[test]
    fn value_display_formats_lists_and_declared_precision() {
        let list = ValueDisplay {
            r#type: ValueType::List as i32,
            options: None,
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
        };
        assert_eq!(format_display_value(&json!(1.236), &decimal), "1.24");
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
