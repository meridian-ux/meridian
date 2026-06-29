// meridian-tui theme binding — maps a `meridian.theme.v1.Theme` to a ratatui
// style palette. This is the TUI half of meridian's orthogonal style layer:
// the renderer emits semantics-only widgets and sources EVERY color/modifier
// from a `Palette` derived here, the same way the web binding maps a Theme to
// `--mer-*` custom properties. One Theme drives every renderer; this is its
// terminal expression.
//
// Two compilation paths for the proto types, mirroring meridian-uiview:
//   * Bazel — the `theme_proto` sibling crate (rules_rust_prost over
//     //proto:theme_proto), re-exported via the `bazel_proto` feature.
//   * cargo (default) — build.rs runs prost-build over ../../proto/theme.proto
//     and emits meridian.theme.v1.rs into OUT_DIR.

use ratatui::style::{Color, Modifier, Style};

/// prost-generated types for meridian.theme.v1.
pub mod proto {
    #[cfg(feature = "bazel_proto")]
    pub use theme_proto::meridian::theme::v1::*;

    #[cfg(not(feature = "bazel_proto"))]
    include!(concat!(env!("OUT_DIR"), "/meridian.theme.v1.rs"));
}

// Re-export the wire types the TUI binding consumes. `Typography` and
// `Metrics` (fonts, radii, spacing) carry no terminal mapping, so they aren't
// re-exported here — reach them via `theme::proto::*` if needed.
pub use proto::{Palette as ProtoPalette, Theme};

/// Which sub-palette of a Theme to render with. A Theme always carries
/// `light`; `dark` is optional and falls back to `light` when unset (matching
/// the web binding's `paletteFor`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Light,
    Dark,
}

/// A renderer-ready palette: the Theme's hex color roles resolved to ratatui
/// `Color`s, plus a handful of pre-composed `Style`s the widgets reach for.
/// Built once from a `Theme` (or `Palette::default()` for an un-themed run)
/// and threaded through the render calls so NO color literal lives in the
/// widget code.
#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub surface: Color,
    pub fg: Color,
    pub muted: Color,
    pub border: Color,
    pub accent: Color,
    pub accent_strong: Color,
    pub on_accent: Color,
    pub danger: Color,
    pub success: Color,
    pub code_bg: Color,
    pub code_fg: Color,
}

impl Palette {
    /// Resolve a `meridian.theme.v1.Theme` for `mode` into a ratatui palette.
    /// Empty / unparseable hex roles fall back to the corresponding
    /// `Palette::default()` role, so a partial Theme still renders.
    pub fn from_theme(theme: &Theme, mode: Mode) -> Self {
        let proto = match mode {
            // `dark` is a separate message; fall back to `light` when unset.
            Mode::Dark => theme.dark.as_ref().or(theme.light.as_ref()),
            Mode::Light => theme.light.as_ref(),
        };
        match proto {
            Some(p) => Self::from_proto_palette(p),
            None => Self::default(),
        }
    }

    /// Resolve a single `meridian.theme.v1.Palette` message, role by role.
    pub fn from_proto_palette(p: &ProtoPalette) -> Self {
        let d = Self::default();
        Self {
            bg: parse_hex(&p.bg).unwrap_or(d.bg),
            surface: parse_hex(&p.surface).unwrap_or(d.surface),
            fg: parse_hex(&p.fg).unwrap_or(d.fg),
            muted: parse_hex(&p.muted).unwrap_or(d.muted),
            border: parse_hex(&p.border).unwrap_or(d.border),
            accent: parse_hex(&p.accent).unwrap_or(d.accent),
            accent_strong: parse_hex(&p.accent_strong).unwrap_or(d.accent_strong),
            on_accent: parse_hex(&p.on_accent).unwrap_or(d.on_accent),
            danger: parse_hex(&p.danger).unwrap_or(d.danger),
            success: parse_hex(&p.success).unwrap_or(d.success),
            code_bg: parse_hex(&p.code_bg).unwrap_or(d.code_bg),
            code_fg: parse_hex(&p.code_fg).unwrap_or(d.code_fg),
        }
    }

    // ── Pre-composed styles the widgets source from (no literal Style:: /
    //    Color:: outside this module) ──────────────────────────────────────

    /// Primary body text on the canvas background.
    pub fn text(&self) -> Style {
        Style::default().fg(self.fg)
    }

    /// Section / panel titles — accent-colored and bold.
    pub fn title(&self) -> Style {
        Style::default().fg(self.accent).add_modifier(Modifier::BOLD)
    }

    /// Table header row — strong foreground, bold.
    pub fn header(&self) -> Style {
        Style::default().fg(self.fg).add_modifier(Modifier::BOLD)
    }

    /// Secondary / meta text (row counts, hints, descriptions).
    pub fn meta(&self) -> Style {
        Style::default().fg(self.muted)
    }

    /// Hairlines, table borders, block frames.
    pub fn border_style(&self) -> Style {
        Style::default().fg(self.border)
    }

    /// Selected / highlighted row — accent fill with on-accent text.
    pub fn selection(&self) -> Style {
        Style::default()
            .fg(self.on_accent)
            .bg(self.accent)
            .add_modifier(Modifier::BOLD)
    }

    /// Affirmative action / accept label.
    pub fn success_style(&self) -> Style {
        Style::default().fg(self.success)
    }

    /// Destructive / cancel / error.
    pub fn danger_style(&self) -> Style {
        Style::default().fg(self.danger)
    }

    /// Focused field label (accent + bold).
    pub fn focused(&self) -> Style {
        Style::default()
            .fg(self.accent)
            .add_modifier(Modifier::BOLD)
    }

    /// An entered field value / code.
    pub fn value(&self) -> Style {
        Style::default().fg(self.code_fg)
    }
}

impl Default for Palette {
    /// A warm neutral dark palette so meridian renders presentably un-skinned
    /// (the terminal analog of meridian.css's neutral fallbacks). Intentionally
    /// brand-neutral — the fastverk look ships from @brand as a Theme.
    fn default() -> Self {
        Self {
            bg: Color::Rgb(0x14, 0x16, 0x18),
            surface: Color::Rgb(0x1c, 0x1e, 0x24),
            fg: Color::Rgb(0xE6, 0xE6, 0xE6),
            muted: Color::Rgb(0x9A, 0x9A, 0x9A),
            border: Color::Rgb(0x3A, 0x3A, 0x3A),
            accent: Color::Rgb(0x6C, 0x9C, 0xE6),
            accent_strong: Color::Rgb(0x4A, 0x7A, 0xC4),
            on_accent: Color::Rgb(0x10, 0x12, 0x16),
            danger: Color::Rgb(0xE0, 0x6C, 0x6C),
            success: Color::Rgb(0x6C, 0xC4, 0x86),
            code_bg: Color::Rgb(0x20, 0x22, 0x28),
            code_fg: Color::Rgb(0xD8, 0xD2, 0xC4),
        }
    }
}

/// Parse a CSS-style `#RRGGBB` (or `#RRGGBBAA`, alpha ignored — terminals are
/// opaque) hex string into a ratatui `Color::Rgb`. Returns `None` for empty or
/// malformed input so callers can fall back to a default role.
pub fn parse_hex(s: &str) -> Option<Color> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 && h.len() != 8 {
        return None;
    }
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some(Color::Rgb(r, g, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_six_digit_hex() {
        assert_eq!(parse_hex("#15161A"), Some(Color::Rgb(0x15, 0x16, 0x1A)));
    }

    #[test]
    fn parses_eight_digit_hex_ignoring_alpha() {
        assert_eq!(parse_hex("#F2C46AFF"), Some(Color::Rgb(0xF2, 0xC4, 0x6A)));
    }

    #[test]
    fn rejects_malformed_hex() {
        assert_eq!(parse_hex(""), None);
        assert_eq!(parse_hex("F2C46A"), None); // missing '#'
        assert_eq!(parse_hex("#xyz"), None);
        assert_eq!(parse_hex("#12345"), None);
    }

    #[test]
    fn partial_palette_falls_back_to_default_roles() {
        let proto = ProtoPalette {
            accent: "#F2C46A".into(),
            ..Default::default()
        };
        let pal = Palette::from_proto_palette(&proto);
        assert_eq!(pal.accent, Color::Rgb(0xF2, 0xC4, 0x6A));
        // Unset role keeps the default.
        assert_eq!(pal.fg, Palette::default().fg);
    }

    #[test]
    fn dark_falls_back_to_light_when_unset() {
        let theme = Theme {
            light: Some(ProtoPalette {
                bg: "#FFFFFF".into(),
                ..Default::default()
            }),
            dark: None,
            ..Default::default()
        };
        let pal = Palette::from_theme(&theme, Mode::Dark);
        assert_eq!(pal.bg, Color::Rgb(0xFF, 0xFF, 0xFF));
    }
}
