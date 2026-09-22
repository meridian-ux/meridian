//! Static enum realization. Hosts resolve options_source before native rendering.
use crate::theme::Palette;
use meridian_uiview::proto::{EnumSelection, ValueTone};
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
    match ValueTone::try_from(tone) {
        Ok(ValueTone::Success) => Style::default().fg(palette.success),
        Ok(ValueTone::Danger) => palette.danger_style(),
        Ok(ValueTone::Info | ValueTone::Accent) => Style::default().fg(palette.accent),
        // The native palette has no warning role; retain emphasis without a literal color.
        Ok(ValueTone::Warning) => palette.value().add_modifier(ratatui::style::Modifier::BOLD),
        _ => palette.value(),
    }
}
