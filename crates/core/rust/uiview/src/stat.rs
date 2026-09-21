//! Shared StatPanel computation — the ONE Rust implementation of a KPI tile's
//! delta / trend / formatting, mirroring the TypeScript `computeStat`
//! (@savvifi/meridian-schemas/uiview stat.ts) EXACTLY so the tui and the web
//! renderers never diverge. A parity test in each language asserts identical
//! output for identical input.
//!
//! The delta/trend is COMPUTED from the data (previous / series), never trusted
//! from an author-marked direction. Semantic good/bad color applies ONLY when
//! `higher_is_better` is explicitly set. Legacy number formatting uses
//! deterministic integer math; numeric ValueDisplay uses the read-surface formatter.

use crate::proto::{value_display, StatPanel, ValueDisplay, ValueType};
use crate::render::format_display_value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatTrend {
    Up,
    Down,
    Flat,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatSemantics {
    Good,
    Bad,
    Neutral,
}

/// The computed view of a StatPanel: formatted value, trend, formatted delta,
/// semantic color, and the sparkline series.
#[derive(Debug, Clone, PartialEq)]
pub struct StatComputed {
    pub formatted_value: String,
    pub trend: StatTrend,
    pub formatted_delta: Option<String>,
    pub semantics: StatSemantics,
    pub series: Vec<f64>,
}

// Decompose |round(n, 2dp)| into (negative, integer part, frac 0..99).
fn parts(n: f64) -> (bool, u64, u64) {
    let scaled = ((n.abs() * 100.0) + 1e-9).round() as i64 * if n < 0.0 { -1 } else { 1 };
    let neg = scaled < 0;
    let a = scaled.unsigned_abs();
    (neg, a / 100, a % 100)
}

fn group(int: u64) -> String {
    let s = int.to_string();
    let mut out = String::new();
    let len = s.len();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (len - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

fn trim_num(n: f64, grouped: bool) -> String {
    let (neg, int, frac) = parts(n);
    let mut s = if grouped { group(int) } else { int.to_string() };
    if frac != 0 {
        let mut f = format!("{frac:02}");
        while f.ends_with('0') {
            f.pop();
        }
        if f.is_empty() {
            f.push('0');
        }
        s = format!("{s}.{f}");
    }
    if neg && !(int == 0 && frac == 0) {
        format!("-{s}")
    } else {
        s
    }
}

fn currency(n: f64) -> String {
    let (neg, int, frac) = parts(n);
    let s = format!("${}.{:02}", group(int), frac);
    if neg && !(int == 0 && frac == 0) {
        format!("-{s}")
    } else {
        s
    }
}

fn compact(n: f64) -> String {
    let a = n.abs();
    for (div, suffix) in [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")] {
        if a >= div {
            return format!("{}{}", trim_num(n / div, false), suffix);
        }
    }
    trim_num(n, false)
}

/// Format a raw number per a ValueFormat enum value (0/1 number, 2 percent,
/// 3 currency, 4 compact, 5 plain). Deterministic.
pub fn format_stat_number(n: f64, format: i32) -> String {
    match format {
        2 => format!("{}%", trim_num(n, false)),
        3 => currency(n),
        4 => compact(n),
        5 => trim_num(n, false),
        _ => trim_num(n, true),
    }
}

/// The arrow glyph for a trend (shared so web + tui match).
pub fn trend_arrow(trend: StatTrend) -> &'static str {
    match trend {
        StatTrend::Up => "↑",
        StatTrend::Down => "↓",
        StatTrend::Flat => "→",
        StatTrend::None => "",
    }
}

fn map_trend(override_val: i32) -> StatTrend {
    match override_val {
        1 => StatTrend::Up,
        2 => StatTrend::Down,
        3 => StatTrend::Flat,
        _ => StatTrend::None,
    }
}

fn format_stat_display_value(value: f64, display: &ValueDisplay) -> String {
    if let Some(value_display::Options::Number(options)) = display.options.as_ref() {
        if options.fraction_digits == Some(0) {
            // JavaScript's toFixed(0), used by the browser formatters, rounds
            // half away from zero; Rust's format! uses ties-to-even.
            let rounded = if value.is_sign_negative() {
                (value - 0.5).ceil()
            } else {
                (value + 0.5).floor()
            };
            return rounded.to_string();
        }
    }
    format_display_value(&serde_json::json!(value), display)
}

/// Compute a StatPanel's value/delta/trend/semantics — the parity-critical core.
pub fn compute_stat(panel: &StatPanel) -> StatComputed {
    let display = panel.value_display.as_ref().filter(|display| {
        matches!(
            ValueType::try_from(display.r#type),
            Ok(ValueType::Integer | ValueType::Decimal | ValueType::Money | ValueType::Percent)
        )
    });
    let format_value = |value: f64| match display {
        Some(display) => format_stat_display_value(value, display),
        None => format_stat_number(value, panel.format),
    };
    let unit_suppressed = match display {
        Some(display) => matches!(
            ValueType::try_from(display.r#type),
            Ok(ValueType::Percent | ValueType::Money)
        ),
        None => panel.format == 2 || panel.format == 3,
    };
    let unit_suffix = if !panel.unit.is_empty() && !unit_suppressed {
        format!(" {}", panel.unit)
    } else {
        String::new()
    };
    let formatted_value = format!("{}{}", format_value(panel.value), unit_suffix);

    // Raw delta: value − previous, else last − first of series.
    let raw: Option<f64> = if let Some(p) = panel.previous {
        Some(panel.value - p)
    } else if panel.series.len() >= 2 {
        Some(panel.series[panel.series.len() - 1] - panel.series[0])
    } else {
        None
    };

    let computed_trend = match raw {
        None => StatTrend::None,
        Some(r) if r > 0.0 => StatTrend::Up,
        Some(r) if r < 0.0 => StatTrend::Down,
        Some(_) => StatTrend::Flat,
    };
    let trend = if panel.trend_override != 0 {
        map_trend(panel.trend_override)
    } else {
        computed_trend
    };

    let formatted_delta = if let Some(d) = &panel.delta_override {
        Some(d.clone())
    } else {
        raw.map(|r| {
            format!(
                "{}{}",
                if r >= 0.0 { "+" } else { "-" },
                format_value(r.abs())
            )
        })
    };

    let semantics = match panel.higher_is_better {
        Some(hib) if trend == StatTrend::Up || trend == StatTrend::Down => {
            if (trend == StatTrend::Up) == hib {
                StatSemantics::Good
            } else {
                StatSemantics::Bad
            }
        }
        _ => StatSemantics::Neutral,
    };

    let series = if panel.series.len() >= 2 {
        panel.series.clone()
    } else {
        Vec::new()
    };

    StatComputed {
        formatted_value,
        trend,
        formatted_delta,
        semantics,
        series,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::{value_display, NumberOptions, StatPanel, ValueDisplay, ValueType};
    use prost::Message;

    fn stat(value: f64, format: i32) -> StatPanel {
        StatPanel {
            label: "m".into(),
            value,
            format,
            // See the note in render.rs: additive schema growth (populate /
            // previous_field / display_field landed after 0.18.0) should not
            // break a fixture that cares about three fields.
            ..Default::default()
        }
    }

    // ── PARITY VECTORS — these exact (input → expected) rows are duplicated in
    //    the TypeScript parity test (meridian-web-react tests/stat_parity.test.ts).
    //    Both languages must produce identical strings/trends. ──────────────────

    #[test]
    fn format_parity_vectors() {
        assert_eq!(format_stat_number(1234.5, 1), "1,234.5"); // NUMBER grouped
        assert_eq!(format_stat_number(1234.0, 5), "1234"); // PLAIN
        assert_eq!(format_stat_number(87.5, 2), "87.5%"); // PERCENT
        assert_eq!(format_stat_number(1234.0, 3), "$1,234.00"); // CURRENCY
        assert_eq!(format_stat_number(1500000.0, 4), "1.5M"); // COMPACT
        assert_eq!(format_stat_number(1200.0, 4), "1.2K");
        assert_eq!(format_stat_number(-5.0, 3), "-$5.00");
        assert_eq!(format_stat_number(12.567, 1), "12.57"); // rounds to 2dp
    }

    #[test]
    fn computes_delta_from_previous_with_semantic_color() {
        // 120 vs previous 150, higher_is_better → a decline is BAD.
        let mut p = stat(120.0, 1);
        p.previous = Some(150.0);
        p.higher_is_better = Some(true);
        let c = compute_stat(&p);
        assert_eq!(c.formatted_value, "120");
        assert_eq!(c.trend, StatTrend::Down);
        assert_eq!(c.formatted_delta.as_deref(), Some("-30"));
        assert_eq!(c.semantics, StatSemantics::Bad);
    }

    #[test]
    fn computes_trend_from_series_catching_a_declining_mismark() {
        // A declining series that a bad dashboard would mark "up" — computation
        // says DOWN. No higher_is_better → neutral (honest).
        let mut p = stat(5.0, 5);
        p.series = vec![10.0, 8.0, 6.0, 5.0];
        let c = compute_stat(&p);
        assert_eq!(c.trend, StatTrend::Down);
        assert_eq!(c.formatted_delta.as_deref(), Some("-5")); // 5 − 10
        assert_eq!(c.semantics, StatSemantics::Neutral);
        assert_eq!(c.series.len(), 4); // sparkline available
    }

    #[test]
    fn no_semantic_color_without_higher_is_better() {
        let mut p = stat(200.0, 1);
        p.previous = Some(150.0);
        let c = compute_stat(&p);
        assert_eq!(c.trend, StatTrend::Up);
        assert_eq!(c.semantics, StatSemantics::Neutral); // up ≠ good unless declared
    }

    #[test]
    fn declared_value_display_overrides_legacy_stat_format() {
        let panel = StatPanel {
            label: "Revenue".into(),
            value: 1234.4,
            format: 2,
            unit: "USD".into(),
            previous: Some(1000.0),
            value_display: Some(ValueDisplay {
                r#type: ValueType::Money as i32,
                options: Some(value_display::Options::Number(NumberOptions {
                    fraction_digits: Some(0),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            ..Default::default()
        };
        let computed = compute_stat(&panel);
        assert_eq!(computed.formatted_value, "1234");
        assert_eq!(computed.formatted_delta.as_deref(), Some("+234"));
    }

    fn numeric_display(kind: ValueType, digits: Option<i32>) -> ValueDisplay {
        ValueDisplay {
            r#type: kind as i32,
            options: Some(value_display::Options::Number(NumberOptions {
                fraction_digits: digits,
                ..Default::default()
            })),
            ..Default::default()
        }
    }

    #[test]
    fn numeric_display_survives_wire_decode_for_value_and_delta() {
        // The same vectors as the TypeScript stat suite. Precision validation
        // belongs to ValueDisplay; invalid precision cannot select legacy USD.
        for kind in [
            ValueType::Integer,
            ValueType::Decimal,
            ValueType::Money,
            ValueType::Percent,
        ] {
            for digits in [
                None,
                Some(0),
                Some(3),
                Some(100),
                Some(-1),
                Some(i32::MIN),
                Some(101),
                Some(i32::MAX),
            ] {
                let panel = StatPanel {
                    value: 12.625,
                    previous: Some(10.25),
                    format: 3,
                    unit: "items".into(),
                    value_display: Some(numeric_display(kind, digits)),
                    ..Default::default()
                };
                let decoded = StatPanel::decode(panel.encode_to_vec().as_slice()).unwrap();
                let computed = compute_stat(&decoded);
                let (value, delta) = match digits {
                    Some(0) => ("13".into(), "+2".into()),
                    Some(100) => (
                        format!("12.625{}", "0".repeat(97)),
                        format!("+2.375{}", "0".repeat(97)),
                    ),
                    _ => ("12.625".into(), "+2.375".into()),
                };
                let suffix = if matches!(kind, ValueType::Money | ValueType::Percent) {
                    ""
                } else {
                    " items"
                };
                assert_eq!(
                    computed.formatted_value,
                    format!("{value}{suffix}"),
                    "{kind:?}/{digits:?}"
                );
                assert_eq!(computed.formatted_delta, Some(delta), "{kind:?}/{digits:?}");
                assert_eq!(computed.trend, StatTrend::Up);
            }
        }
    }

    #[test]
    fn invalid_decimal_precision_does_not_restore_legacy_currency() {
        let panel = StatPanel {
            value: 12.5,
            previous: Some(10.25),
            format: 3,
            unit: "items".into(),
            value_display: Some(numeric_display(ValueType::Decimal, Some(i32::MAX))),
            ..Default::default()
        };
        let computed = compute_stat(&panel);
        assert_eq!(computed.formatted_value, "12.5 items");
        assert_eq!(computed.formatted_delta.as_deref(), Some("+2.25"));
    }

    #[test]
    fn declared_rounding_matches_other_native_read_surfaces() {
        // StatPanel must not introduce its own rounding policy at tie values.
        for (value, digits) in [(12.5, 0), (-12.5, 0), (1.125, 2), (-1.125, 2)] {
            let display = numeric_display(ValueType::Decimal, Some(digits));
            let expected = format_display_value(&serde_json::json!(value), &display);
            let panel = StatPanel {
                value,
                value_display: Some(display),
                ..Default::default()
            };
            assert_eq!(compute_stat(&panel).formatted_value, expected);
        }
    }

    #[test]
    fn unsupported_display_keeps_legacy_stat_format() {
        for kind in [
            None,
            Some(ValueType::Unspecified as i32),
            Some(ValueType::Text as i32),
            Some(999),
        ] {
            let panel = StatPanel {
                value: 12.5,
                previous: Some(10.25),
                format: 3,
                unit: "ignored".into(),
                value_display: kind.map(|kind| ValueDisplay {
                    r#type: kind,
                    ..Default::default()
                }),
                ..Default::default()
            };
            let computed = compute_stat(&panel);
            assert_eq!(computed.formatted_value, "$12.50");
            assert_eq!(computed.formatted_delta.as_deref(), Some("+$2.25"));
        }
    }

    #[test]
    fn declared_display_preserves_series_overrides_and_direction() {
        let mut panel = StatPanel {
            value: -2.25,
            format: 2,
            series: vec![10.25, 12.5],
            higher_is_better: Some(false),
            value_display: Some(numeric_display(ValueType::Decimal, Some(3))),
            ..Default::default()
        };
        let computed = compute_stat(&panel);
        assert_eq!(computed.formatted_value, "-2.250");
        assert_eq!(computed.formatted_delta.as_deref(), Some("+2.250"));
        assert_eq!(computed.semantics, StatSemantics::Bad);
        panel.previous = Some(0.0);
        let computed = compute_stat(&panel);
        assert_eq!(computed.formatted_delta.as_deref(), Some("-2.250"));
        assert_eq!(computed.trend, StatTrend::Down);
        assert_eq!(computed.semantics, StatSemantics::Good);
        for text in ["pending", ""] {
            panel.delta_override = Some(text.into());
            assert_eq!(compute_stat(&panel).formatted_delta.as_deref(), Some(text));
        }
        panel.previous = None;
        panel.series.clear();
        panel.delta_override = None;
        assert_eq!(compute_stat(&panel).formatted_delta, None);
    }
}
