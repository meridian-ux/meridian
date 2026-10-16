//! Static enum realization. Hosts resolve options_source before native rendering.
use crate::theme::Palette;
use meridian_uiview::proto::{EnumSelection, Tone};
use ratatui::style::Style;

pub(crate) fn options(spec: &EnumSelection) -> Vec<(&str, &str, i32)> {
    if spec.options.is_empty() {
        spec.allowed_values
            .iter()
            .map(|v| (v.as_str(), v.as_str(), 0))
            .collect()
    } else {
        spec.options
            .iter()
            .map(|o| {
                (
                    o.value.as_str(),
                    if o.label.is_empty() {
                        o.value.as_str()
                    } else {
                        o.label.as_str()
                    },
                    o.tone,
                )
            })
            .collect()
    }
}

pub(crate) fn style(tone: i32, palette: &Palette) -> Style {
    // ValueTone's existing wire numbers deliberately match shared Tone. Keep
    // old field/JSON names; adapt only at the runtime presentation boundary.
    palette.tone_style(Tone::try_from(tone).unwrap_or(Tone::Unspecified))
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::ValueTone;
    use ratatui::style::Color;

    #[test]
    fn legacy_enum_tones_resolve_shared_roles_without_invented_emphasis() {
        let palette = Palette::from_proto_palette(&crate::theme::ProtoPalette {
            warning: "#123456".into(),
            info: "#654321".into(),
            ..Default::default()
        });
        assert_eq!(
            style(ValueTone::Warning as i32, &palette),
            Style::default().fg(Color::Rgb(0x12, 0x34, 0x56))
        );
        assert_eq!(
            style(ValueTone::Info as i32, &palette),
            Style::default().fg(Color::Rgb(0x65, 0x43, 0x21))
        );
        assert_eq!(
            style(ValueTone::Unspecified as i32, &palette),
            palette.value()
        );
        assert_eq!(style(999, &palette), palette.value());
    }
}
