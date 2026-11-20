//! In-browser host for the real terminal renderer. The site supplies static
//! protobuf fixtures. Keyboard input only updates local panel state.

use std::fmt::Write as _;

use meridian_uiview::{
    proto::{panel_descriptor::Body, PanelDescriptor, RpcCall},
    Context,
};
use prost::Message;
use prost_types::{value::Kind, Struct, Value};
use ratatui::{
    backend::TestBackend,
    style::{Color, Modifier},
    Terminal,
};
use serde_json::Value as Json;
use unicode_width::UnicodeWidthStr;
use wasm_bindgen::prelude::*;

use crate::{
    keys::{KeyCode, KeyEvent, KeyModifiers},
    PanelView, RpcError, RpcInvoker,
};

#[derive(Default)]
struct RecordedRead {
    response: Option<(String, String, Json)>,
}

impl RpcInvoker for RecordedRead {
    fn invoke(&self, service: &str, method: &str, _: Json) -> Result<Json, RpcError> {
        if let Some((expected_service, expected_method, payload)) = &self.response {
            if expected_service == service && expected_method == method {
                return Ok(payload.clone());
            }
        }
        Err(RpcError::Transport(
            "No recorded response for this preview.".into(),
        ))
    }
}

fn json(value: Value) -> Json {
    match value.kind {
        None | Some(Kind::NullValue(_)) => Json::Null,
        Some(Kind::BoolValue(value)) => Json::Bool(value),
        Some(Kind::NumberValue(value)) => Json::from(value),
        Some(Kind::StringValue(value)) => Json::String(value),
        Some(Kind::ListValue(value)) => Json::Array(value.values.into_iter().map(json).collect()),
        Some(Kind::StructValue(value)) => Json::Object(
            value
                .fields
                .into_iter()
                .map(|(key, value)| (key, json(value)))
                .collect(),
        ),
    }
}

fn recorded_call(descriptor: &PanelDescriptor) -> Option<&RpcCall> {
    match descriptor.body.as_ref()? {
        Body::Table(panel) => panel.populate.as_ref(),
        Body::Gallery(panel) => panel.populate.as_ref(),
        Body::ResourceCards(panel) => panel.populate.as_ref(),
        _ => None,
    }
}

#[wasm_bindgen]
pub struct BrowserPanel {
    descriptor: PanelDescriptor,
    panel: PanelView,
    recording: RecordedRead,
}

#[wasm_bindgen]
impl BrowserPanel {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<BrowserPanel, JsError> {
        let descriptor = PanelDescriptor::decode(bytes)
            .map_err(|_| JsError::new("Invalid preview descriptor."))?;
        Ok(Self {
            descriptor,
            panel: PanelView::new(),
            recording: RecordedRead::default(),
        })
    }

    /// Supply a recorded protobuf response for the panel's declared populate RPC.
    pub fn set_recording(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        let call = recorded_call(&self.descriptor)
            .ok_or_else(|| JsError::new("This preview has no supported populate call."))?;
        if bytes.len() > 64 * 1024 {
            return Err(JsError::new("Preview recording is too large."));
        }
        let value =
            Struct::decode(bytes).map_err(|_| JsError::new("Invalid preview recording."))?;
        let payload = json(Value {
            kind: Some(Kind::StructValue(value)),
        });
        self.recording.response = Some((call.service.clone(), call.method.clone(), payload));
        self.panel = PanelView::new();
        Ok(())
    }

    pub fn key(&mut self, key: &str, shift: bool, control: bool) -> bool {
        let code = match key {
            "ArrowUp" => KeyCode::Up,
            "ArrowDown" => KeyCode::Down,
            "ArrowLeft" => KeyCode::Left,
            "ArrowRight" => KeyCode::Right,
            "Backspace" => KeyCode::Backspace,
            "Enter" => KeyCode::Enter,
            "PageUp" => KeyCode::PageUp,
            "PageDown" => KeyCode::PageDown,
            "Escape" => KeyCode::Esc,
            "F1" => KeyCode::F(1),
            _ => {
                let mut chars = key.chars();
                match (chars.next(), chars.next()) {
                    (Some(value), None) if !value.is_control() => KeyCode::Char(value),
                    _ => return false,
                }
            }
        };
        let mut modifiers = KeyModifiers::NONE;
        if shift {
            modifiers = modifiers | KeyModifiers::SHIFT;
        }
        if control {
            modifiers = modifiers | KeyModifiers::CONTROL;
        }
        self.panel
            .handle_prompt_key(&self.descriptor, KeyEvent::new(code, modifiers));
        true
    }

    pub fn frame(&mut self, columns: u16, rows: u16) -> Result<String, JsError> {
        let columns = columns.clamp(1, 160);
        let rows = rows.clamp(1, 48);
        let mut terminal = Terminal::new(TestBackend::new(columns, rows))
            .map_err(|_| JsError::new("Could not initialize the terminal buffer."))?;
        terminal
            .draw(|frame| {
                self.panel.render(
                    frame,
                    frame.area(),
                    &self.descriptor,
                    &Context::default(),
                    &self.recording,
                );
            })
            .map_err(|_| JsError::new("Could not draw the preview."))?;
        let buffer = terminal.backend().buffer();
        let mut ansi = String::from("\x1b[?25l\x1b[?7l\x1b[0m\x1b[2J");
        let mut current_style = None;
        for y in 0..rows {
            write!(ansi, "\x1b[{};1H", y + 1).unwrap();
            let mut x = 0;
            while x < columns {
                let cell = &buffer[(x, y)];
                let style = (cell.fg, cell.bg, cell.modifier);
                if current_style != Some(style) {
                    ansi.push_str("\x1b[0m");
                    color(&mut ansi, cell.fg, false);
                    color(&mut ansi, cell.bg, true);
                    for (flag, code) in [
                        (Modifier::BOLD, 1),
                        (Modifier::DIM, 2),
                        (Modifier::ITALIC, 3),
                        (Modifier::UNDERLINED, 4),
                        (Modifier::REVERSED, 7),
                        (Modifier::CROSSED_OUT, 9),
                    ] {
                        if cell.modifier.contains(flag) {
                            write!(ansi, "\x1b[{code}m").unwrap();
                        }
                    }
                    current_style = Some(style);
                }
                let symbol = cell.symbol();
                if symbol.chars().any(char::is_control) {
                    ansi.push(' ');
                    x += 1;
                } else {
                    ansi.push_str(symbol);
                    x += symbol.width().max(1) as u16;
                }
            }
        }
        ansi.push_str("\x1b[0m\x1b[?7h\x1b[H");
        Ok(ansi)
    }
}

fn color(output: &mut String, color: Color, background: bool) {
    let channel = if background { 48 } else { 38 };
    let offset = if background { 10 } else { 0 };
    let standard = match color {
        Color::Reset => 39,
        Color::Black => 30,
        Color::Red => 31,
        Color::Green => 32,
        Color::Yellow => 33,
        Color::Blue => 34,
        Color::Magenta => 35,
        Color::Cyan => 36,
        Color::Gray => 37,
        Color::DarkGray => 90,
        Color::LightRed => 91,
        Color::LightGreen => 92,
        Color::LightYellow => 93,
        Color::LightBlue => 94,
        Color::LightMagenta => 95,
        Color::LightCyan => 96,
        Color::White => 97,
        Color::Rgb(r, g, b) => {
            write!(output, "\x1b[{channel};2;{r};{g};{b}m").unwrap();
            return;
        }
        Color::Indexed(index) => {
            write!(output, "\x1b[{channel};5;{index}m").unwrap();
            return;
        }
    };
    write!(output, "\x1b[{}m", standard + offset).unwrap();
}
