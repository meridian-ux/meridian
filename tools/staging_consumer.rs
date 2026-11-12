use meridian_tui::ratatui::{backend::TestBackend, style::Color, Terminal};
use meridian_tui::{serde_json::Value, Mode, Palette, PanelView, RpcError, RpcInvoker};
use meridian_uiview::proto::{PanelDescriptor, ViewDescriptor};
use meridian_uiview::{static_view_text, Context};
use theme_proto::meridian::theme::v1::{Palette as ThemePalette, Theme};

struct NoRpc;

impl RpcInvoker for NoRpc {
    fn invoke(&self, service: &str, method: &str, _: Value) -> Result<Value, RpcError> {
        panic!("unexpected RPC {service}/{method}");
    }
}

fn main() {
    assert!(static_view_text(&ViewDescriptor::default())
        .unwrap()
        .contains("No sections"));
    let theme = Theme {
        light: Some(ThemePalette {
            accent: "#123456".into(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let palette = Palette::from_theme(&theme, Mode::Dark);
    assert_eq!(palette.accent, Color::Rgb(0x12, 0x34, 0x56));

    let mut view = PanelView::with_palette(palette);
    let mut terminal = Terminal::new(TestBackend::new(80, 12)).unwrap();
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &PanelDescriptor::default(),
                &Context::default(),
                &NoRpc,
            );
        })
        .unwrap();
    let text: String = terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(text.contains("Unsupported or unset panel shape"));
    println!("Staged Rust core text, theme palette, and TUI render passed.");
}
