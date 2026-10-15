// Standalone prompt renderer for `meridian.ui.v1.PromptPanel`.
//
// Unlike `PanelView` (which renders into a Frame inside a host's
// existing event loop), `render_prompt` is a one-shot helper for
// CLI-shaped tools that just want to collect input and exit. It
// drives crossterm raw mode + an alternate screen internally and
// restores the terminal on every exit path, including panics.
//
// Returns `PromptResponse::Cancelled` on Esc, `Confirmed(bool)` on a
// confirmation panel, or `Submitted(map)` on a form. The submitted
// map is keyed by `FormField.field_id`. Numeric/integer values preserve
// typing via `FieldValue`; repeated arrays and string maps preserve validated
// raw JSON in the existing Text variant so this helper's public response API
// stays stable.

use std::collections::{HashMap, HashSet};
use std::io;

use crossterm::{
    cursor, event,
    event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute, terminal,
};
use meridian_uiview::proto::{
    form_field::Kind, repeated_field::Element, BooleanToggle, FormField, IntegerSpinner,
    KeyValueMapField, MaskedInput, NumberInput, PromptPanel, RepeatedField, TextInput,
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame, Terminal,
};

use crate::theme::Palette;

/// Result of a one-shot prompt rendering. Cancellation is its own
/// variant so the caller distinguishes Esc from a denied confirmation.
#[derive(Debug, Clone)]
pub enum PromptResponse {
    /// Form mode: user pressed Enter on a valid form. Values keyed
    /// by `FormField.field_id`.
    Submitted(HashMap<String, FieldValue>),
    /// Confirmation mode: user picked yes or no.
    Confirmed(bool),
    /// User pressed Esc on either mode.
    Cancelled,
}

/// Typed value collected from one form field.
#[derive(Debug, Clone)]
pub enum FieldValue {
    Text(String),
    Integer(i64),
    Selection(String),
    /// Plaintext value of a masked input. Caller is responsible for
    /// scrubbing it from memory once consumed.
    Masked(String),
    /// BooleanToggle — a checkbox.
    Boolean(bool),
    /// NumberInput — a decimal. Distinct from `Integer` so a caller
    /// marshaling to JSON emits 1.5 rather than truncating to 1.
    Number(f64),
}

impl FieldValue {
    /// Best-effort string view — useful for callers that just want
    /// to substitute the value as a CFN parameter override.
    pub fn as_string(&self) -> String {
        match self {
            FieldValue::Text(s) | FieldValue::Selection(s) | FieldValue::Masked(s) => s.clone(),
            FieldValue::Integer(n) => n.to_string(),
            FieldValue::Boolean(b) => b.to_string(),
            FieldValue::Number(n) => n.to_string(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PromptError {
    #[error("invalid prompt descriptor: {0}")]
    InvalidDescriptor(String),
    #[error("terminal io: {0}")]
    Io(#[from] io::Error),
    #[error("prompt panel has no fields and is_confirmation = false")]
    EmptyPrompt,
    #[error("field {field_id}: unsupported kind (missing FormField.kind oneof)")]
    UnsupportedKind { field_id: String },
    /// Legacy error variant retained for callers. Nested values are now edited
    /// and validated as JSON objects; the one-shot API preserves raw JSON in
    /// Text, while PanelView emits typed protobuf Struct values.
    #[error(
        "field {field_id}: nested sub-forms are not supported by the one-shot prompt renderer"
    )]
    NestedUnsupported { field_id: String },
    /// Missing repeated element declarations remain unsupported. Valid scalar
    /// and object elements use the recursively validated JSON-array editor.
    #[error("field {field_id}: repeated object or missing-element fields are not supported by the one-shot prompt renderer")]
    RepeatedUnsupported { field_id: String },
    /// Legacy source-compatible error variant. Valid `KeyValueMapField`
    /// declarations are now collected through the typed JSON-object editor.
    #[error(
        "field {field_id}: key/value map fields are not supported by the one-shot prompt renderer"
    )]
    KeyValueMapUnsupported { field_id: String },
}

/// Render `panel` in raw mode and return the user's response.
///
/// Drives crossterm directly so the caller doesn't have to manage
/// terminal state. Suitable as a one-shot from a `bazel run` binary.
///
/// All look comes from `palette` (derive it from a `meridian.theme.v1.Theme`
/// via `Palette::from_theme`, or pass `Palette::default()` for the neutral
/// look). No `Color::` / `Style::` literal lives in this renderer.
pub fn render_prompt(
    panel: &PromptPanel,
    palette: &Palette,
) -> Result<PromptResponse, PromptError> {
    if !panel.is_confirmation && panel.fields.is_empty() {
        return Err(PromptError::EmptyPrompt);
    }

    if !panel.is_confirmation {
        validate_supported_fields(&panel.fields)?;
    }

    let mut stdout = io::stdout();
    terminal::enable_raw_mode()?;
    execute!(stdout, terminal::EnterAlternateScreen, cursor::Hide)?;
    let backend = CrosstermBackend::new(stdout);
    let mut term = Terminal::new(backend)?;

    let result = run_state(&mut term, panel, palette);

    // Always restore terminal state, even on Err.
    let _ = execute!(
        term.backend_mut(),
        terminal::LeaveAlternateScreen,
        cursor::Show
    );
    let _ = terminal::disable_raw_mode();

    result
}

/// Reject missing kinds before raw mode. Compound values use recursively
/// validated JSON editors rather than silently dropping nested branches.
fn validate_supported_fields(fields: &[FormField]) -> Result<(), PromptError> {
    let mut identifiers = HashSet::new();
    for field in fields {
        if !identifiers.insert(field.field_id.as_str()) {
            return Err(PromptError::InvalidDescriptor(format!(
                "duplicate field identifier {}",
                field.field_id
            )));
        }
        match field.kind.as_ref() {
            None => {
                return Err(PromptError::UnsupportedKind {
                    field_id: field.field_id.clone(),
                })
            }
            Some(Kind::Nested(spec)) => validate_supported_fields(&spec.fields)?,
            Some(Kind::Repeated(spec)) => validate_repeated_shape(field, spec)?,
            Some(Kind::KeyValueMap(_)) => {}
            Some(_) => {}
        }
    }
    Ok(())
}

fn validate_repeated_shape(field: &FormField, spec: &RepeatedField) -> Result<(), PromptError> {
    match spec.element.as_ref() {
        Some(Element::Scalar(scalar)) => validate_supported_fields(std::slice::from_ref(scalar)),
        Some(Element::Object(object)) => validate_supported_fields(&object.fields),
        None => Err(PromptError::RepeatedUnsupported {
            field_id: field.field_id.clone(),
        }),
    }
}

// ──────────────────────────────────────────────────────────────
// Confirmation mode
// ──────────────────────────────────────────────────────────────

fn run_state<B: ratatui::backend::Backend>(
    term: &mut Terminal<B>,
    panel: &PromptPanel,
    palette: &Palette,
) -> Result<PromptResponse, PromptError> {
    let mut state = PromptState::new(panel)?;
    loop {
        term.draw(|frame| {
            let area = frame.area();
            state.draw(frame, area, palette);
        })?;
        if let Event::Key(key) = event::read()? {
            if let Some(response) = state.handle_key(key) {
                return Ok(response);
            }
        }
    }
}

fn draw_confirmation(
    f: &mut Frame,
    area: Rect,
    panel: &PromptPanel,
    accept: &str,
    cancel: &str,
    palette: &Palette,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(header_body_footer(&panel.detail))
        .split(area);

    draw_header(f, chunks[0], panel, palette);
    if !panel.detail.is_empty() {
        draw_detail(f, chunks[1], &panel.detail);
    }
    let prompt = Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{accept} [y]"), palette.success_style()),
        Span::raw("   "),
        Span::styled(format!("{cancel} [n/Enter]"), palette.danger_style()),
        Span::raw("   "),
        Span::styled("Cancel [Esc]", palette.meta()),
    ]);
    f.render_widget(
        Paragraph::new(prompt).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(palette.border_style()),
        ),
        chunks[chunks.len() - 1],
    );
}

// ──────────────────────────────────────────────────────────────
// Form mode
// ──────────────────────────────────────────────────────────────

/// One field's in-progress edit state.
struct FieldState {
    field: FormField,
    /// Free-form text buffer (used by Text + Masked).
    text: String,
    /// Integer buffer (IntegerSpinner).
    integer: i64,
    /// Decimal buffer (NumberInput).
    number: f64,
    /// Checked state (BooleanToggle).
    boolean: bool,
    /// Selected index into the resolved static enum options.
    selection_index: usize,
    /// Last validation error, displayed under the field.
    error: Option<String>,
}

/// Embeddable local interaction state used by the one-shot driver. It owns no
/// terminal, transport, or serialized response envelope; PanelView can reuse it.
pub(crate) struct PromptState {
    panel: PromptPanel,
    states: Vec<FieldState>,
    focus: usize,
    finished: Option<&'static str>,
    show_details: bool,
    detail_scroll: u16,
    multiline_rows: HashMap<String, u32>,
}

impl PromptState {
    /// Reuse the compound editor without entering raw mode or losing prefill.
    pub(crate) fn edit_compound(
        field: &FormField,
        value: &serde_json::Value,
    ) -> Result<Self, PromptError> {
        let panel = PromptPanel {
            description: format!("Edit {} as JSON · Enter save · Esc cancel", field.label),
            fields: vec![field.clone()],
            ..Default::default()
        };
        let mut state = Self::new(&panel)?;
        state.states[0].text = value.to_string();
        Ok(state)
    }

    pub(crate) fn set_multiline_rows(&mut self, field: &str, rows: i32) {
        self.multiline_rows
            .insert(field.to_string(), if rows > 0 { rows as u32 } else { 4 });
    }
    pub(crate) fn rearm(&mut self) {
        self.finished = None;
    }

    pub(crate) fn insert_line_break(&mut self) {
        if self.finished.is_none()
            && matches!(
                self.states
                    .get(self.focus)
                    .and_then(|state| state.field.kind.as_ref()),
                Some(Kind::Text(_)) | Some(Kind::Masked(_))
            )
        {
            self.states[self.focus].text.push('\n');
        }
    }

    pub(crate) fn focused_field_id(&self) -> Option<&str> {
        self.states
            .get(self.focus)
            .map(|state| state.field.field_id.as_str())
    }

    pub(crate) fn clear_text(&mut self) {
        if self.finished.is_none() {
            if let Some(state) = self.states.get_mut(self.focus) {
                state.text.clear();
            }
        }
    }
    pub(crate) fn new(panel: &PromptPanel) -> Result<Self, PromptError> {
        if !panel.is_confirmation && panel.fields.is_empty() {
            return Err(PromptError::EmptyPrompt);
        }
        let fields = if panel.is_confirmation {
            &[][..]
        } else {
            panel.fields.as_slice()
        };
        validate_supported_fields(fields)?;
        let mut remaining = 1_000usize;
        let states = fields
            .iter()
            .map(|field| {
                let default = prompt_default(field, &mut remaining)
                    .map_err(PromptError::InvalidDescriptor)?;
                let mut state = initial_state(field);
                if matches!(
                    field.kind,
                    Some(Kind::Nested(_)) | Some(Kind::Repeated(_)) | Some(Kind::KeyValueMap(_))
                ) {
                    state.text = default.to_string();
                }
                Ok(state)
            })
            .collect::<Result<Vec<_>, PromptError>>()?;
        Ok(Self {
            panel: panel.clone(),
            states,
            focus: 0,
            finished: None,
            show_details: false,
            detail_scroll: 0,
            multiline_rows: HashMap::new(),
        })
    }

    pub(crate) fn handle_key(&mut self, key: KeyEvent) -> Option<PromptResponse> {
        if self.finished.is_some() || key.kind != KeyEventKind::Press {
            return None;
        }
        if key.code == KeyCode::F(1) {
            self.show_details = !self.show_details;
            self.detail_scroll = 0;
            return None;
        }
        if self.show_details && key.code == KeyCode::PageDown {
            self.detail_scroll = self.detail_scroll.saturating_add(5);
            return None;
        }
        if self.show_details && key.code == KeyCode::PageUp {
            self.detail_scroll = self.detail_scroll.saturating_sub(5);
            return None;
        }
        if self.show_details
            && key.code != KeyCode::Esc
            && !(key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
        {
            return None;
        }
        let response = if key.code == KeyCode::Esc
            || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
        {
            Some(PromptResponse::Cancelled)
        } else if key
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
        {
            None
        } else if self.panel.is_confirmation {
            match key.code {
                KeyCode::Char('y' | 'Y') => Some(PromptResponse::Confirmed(true)),
                KeyCode::Char('n' | 'N') | KeyCode::Enter => Some(PromptResponse::Confirmed(false)),
                _ => None,
            }
        } else {
            match key.code {
                KeyCode::Tab => self.focus = (self.focus + 1) % self.states.len(),
                KeyCode::BackTab => {
                    self.focus = (self.focus + self.states.len() - 1) % self.states.len()
                }
                KeyCode::Down if !is_editing_field(&self.states[self.focus]) => {
                    self.focus = (self.focus + 1) % self.states.len()
                }
                KeyCode::Up if !is_editing_field(&self.states[self.focus]) => {
                    self.focus = (self.focus + self.states.len() - 1) % self.states.len()
                }
                KeyCode::Enter => {
                    if validate_all(&mut self.states) {
                        self.finished = Some("Submitted.");
                        return Some(PromptResponse::Submitted(collect(&self.states)));
                    }
                }
                code => apply_field_input(&mut self.states[self.focus], code),
            }
            None
        };
        if let Some(response) = &response {
            self.finished = Some(if matches!(response, PromptResponse::Cancelled) {
                "Canceled."
            } else {
                "Submitted."
            });
        }
        response
    }

    pub(crate) fn draw(&self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if let Some(status) = self.finished {
            frame.render_widget(Paragraph::new(status).style(palette.text()), area);
        } else if self.show_details {
            let text = format!(
                "{}\n{}\nDetails [F1 to return] · scroll [PageUp/PageDown]",
                self.panel.description, self.panel.detail
            );
            let lines: usize = text
                .lines()
                .map(|line| {
                    Line::raw(line)
                        .width()
                        .max(1)
                        .div_ceil(area.width.max(1) as usize)
                })
                .sum();
            let scroll = self.detail_scroll.min(
                lines
                    .saturating_sub(area.height as usize)
                    .min(u16::MAX as usize) as u16,
            );
            frame.render_widget(
                Paragraph::new(text)
                    .style(palette.text())
                    .wrap(Wrap { trim: false })
                    .scroll((scroll, 0)),
                area,
            );
        } else if self.panel.is_confirmation {
            let accept = if self.panel.accept_label.is_empty() {
                "Yes"
            } else {
                &self.panel.accept_label
            };
            let cancel = if self.panel.cancel_label.is_empty() {
                "No"
            } else {
                &self.panel.cancel_label
            };
            draw_confirmation(frame, area, &self.panel, accept, cancel, palette);
        } else {
            draw_form(
                frame,
                area,
                &self.panel,
                &self.states,
                self.focus,
                palette,
                &self.multiline_rows,
            );
        }
    }
}

// Bound default expansion, especially repeated-of-repeated min_items. Reject
// rather than silently truncating or allocating producer-controlled billions.
fn prompt_default(field: &FormField, remaining: &mut usize) -> Result<serde_json::Value, String> {
    *remaining = remaining
        .checked_sub(1)
        .ok_or_else(|| "default expansion exceeds 1000 value nodes".to_string())?;
    match field.kind.as_ref() {
        Some(Kind::Nested(spec)) => {
            let fields = spec
                .fields
                .iter()
                .map(|field| Ok((field.field_id.clone(), prompt_default(field, remaining)?)))
                .collect::<Result<serde_json::Map<_, _>, String>>()?;
            Ok(serde_json::Value::Object(fields))
        }
        Some(Kind::Repeated(spec)) => {
            if spec.min_items as usize > *remaining {
                return Err("default expansion exceeds 1000 value nodes".into());
            }
            let mut items = Vec::new();
            for _ in 0..spec.min_items {
                let value = match spec.element.as_ref() {
                    Some(Element::Scalar(field)) => prompt_default(field, remaining)?,
                    Some(Element::Object(object)) => prompt_default(
                        &FormField {
                            kind: Some(Kind::Nested(object.clone())),
                            ..Default::default()
                        },
                        remaining,
                    )?,
                    None => return Err("missing repeated element kind".into()),
                };
                items.push(value);
            }
            Ok(serde_json::Value::Array(items))
        }
        _ => {
            Ok(crate::content::form_defaults(std::slice::from_ref(field))[&field.field_id].clone())
        }
    }
}

fn initial_state(f: &FormField) -> FieldState {
    let mut state = FieldState {
        field: f.clone(),
        text: String::new(),
        integer: 0,
        number: 0.0,
        boolean: false,
        selection_index: 0,
        error: None,
    };
    match f.kind.as_ref() {
        Some(Kind::Text(TextInput { default_value, .. }))
        | Some(Kind::Masked(MaskedInput { default_value, .. })) => {
            state.text = default_value.clone();
        }
        Some(Kind::Integer(IntegerSpinner { default_value, .. })) => {
            state.integer = *default_value as i64;
        }
        Some(Kind::Number(NumberInput { default_value, .. })) => {
            state.number = *default_value;
        }
        Some(Kind::Boolean(BooleanToggle { default_value })) => {
            state.boolean = *default_value;
        }
        Some(Kind::EnumSelection(spec)) => {
            state.selection_index = crate::enum_options::options(spec)
                .iter()
                .position(|v| v.0 == spec.default_value)
                .unwrap_or(0);
        }
        Some(Kind::Repeated(_)) => state.text = "[]".to_string(),
        Some(Kind::KeyValueMap(_)) => state.text = "{}".to_string(),
        Some(Kind::Nested(spec)) => {
            state.text = crate::content::form_defaults(&spec.fields).to_string()
        }
        None => {}
    }
    state
}

/// True for fields whose left/right/up/down keys edit them rather
/// than navigate. EnumSelection wants Up/Down to change the choice;
/// IntegerSpinner / NumberInput want Up/Down to increment; BooleanToggle
/// wants Up/Down to flip.
fn is_editing_field(s: &FieldState) -> bool {
    matches!(
        s.field.kind.as_ref(),
        Some(Kind::EnumSelection(_))
            | Some(Kind::Integer(_))
            | Some(Kind::Number(_))
            | Some(Kind::Boolean(_))
    )
}

fn apply_field_input(s: &mut FieldState, code: KeyCode) {
    match s.field.kind.as_ref() {
        Some(Kind::Text(_))
        | Some(Kind::Masked(_))
        | Some(Kind::Repeated(_))
        | Some(Kind::Nested(_))
        | Some(Kind::KeyValueMap(_)) => match code {
            KeyCode::Char(c) => s.text.push(c),
            KeyCode::Backspace => {
                s.text.pop();
            }
            _ => {}
        },
        Some(Kind::Integer(IntegerSpinner { min, max, step, .. })) => {
            let step_v = if *step == 0 { 1 } else { *step as i64 };
            match code {
                KeyCode::Up => {
                    s.integer = s.integer.saturating_add(step_v);
                    if *max != 0 && s.integer > *max as i64 {
                        s.integer = *max as i64;
                    }
                }
                KeyCode::Down => {
                    s.integer = s.integer.saturating_sub(step_v);
                    if *min != 0 && s.integer < *min as i64 {
                        s.integer = *min as i64;
                    }
                }
                _ => {}
            }
        }
        Some(Kind::Number(NumberInput { min, max, step, .. })) => {
            // step == 0 means "renderer default" (proto3 omits a zero scalar).
            let step_v = if *step == 0.0 { 1.0 } else { *step };
            match code {
                KeyCode::Up => {
                    s.number += step_v;
                    if *max != 0.0 && s.number > *max {
                        s.number = *max;
                    }
                }
                KeyCode::Down => {
                    s.number -= step_v;
                    if *min != 0.0 && s.number < *min {
                        s.number = *min;
                    }
                }
                _ => {}
            }
        }
        Some(Kind::Boolean(_)) => match code {
            KeyCode::Up | KeyCode::Down | KeyCode::Left | KeyCode::Right | KeyCode::Char(' ') => {
                s.boolean = !s.boolean;
            }
            _ => {}
        },
        Some(Kind::EnumSelection(spec)) => {
            let allowed_values = crate::enum_options::options(spec);
            if allowed_values.is_empty() {
                return;
            }
            match code {
                KeyCode::Up | KeyCode::Left => {
                    s.selection_index =
                        (s.selection_index + allowed_values.len() - 1) % allowed_values.len();
                }
                KeyCode::Down | KeyCode::Right => {
                    s.selection_index = (s.selection_index + 1) % allowed_values.len();
                }
                _ => {}
            }
        }
        None => {}
    }
}

/// Validate every field; populate `state.error` on the first failure
/// per field. Returns true iff every field is valid.
fn validate_all(states: &mut [FieldState]) -> bool {
    let mut all_ok = true;
    for s in states.iter_mut() {
        s.error = validate_one(s);
        if s.error.is_some() {
            all_ok = false;
        }
    }
    all_ok
}

fn validate_one(s: &FieldState) -> Option<String> {
    match s.field.kind.as_ref() {
        Some(Kind::Text(TextInput {
            pattern,
            pattern_error_msg,
            min_length,
            max_length,
            ..
        }))
        | Some(Kind::Masked(MaskedInput {
            pattern,
            pattern_error_msg,
            min_length,
            max_length,
            ..
        })) => length_and_pattern(
            &s.text,
            *min_length,
            *max_length,
            pattern,
            pattern_error_msg,
        ),
        Some(Kind::Integer(IntegerSpinner { min, max, .. })) => {
            if s.integer.unsigned_abs() > 9_007_199_254_740_991 {
                Some("integer cannot be represented exactly by protobuf Value".into())
            } else if *max != 0 && s.integer > *max as i64 {
                Some(format!("value must be ≤ {max}"))
            } else if *min != 0 && s.integer < *min as i64 {
                Some(format!("value must be ≥ {min}"))
            } else {
                None
            }
        }
        Some(Kind::Number(NumberInput { min, max, .. })) => {
            if !s.number.is_finite() {
                Some("value must be a finite number".into())
            } else if *max != 0.0 && s.number > *max {
                Some(format!("value must be ≤ {max}"))
            } else if *min != 0.0 && s.number < *min {
                Some(format!("value must be ≥ {min}"))
            } else {
                None
            }
        }
        Some(Kind::Repeated(spec)) => parse_repeated_text(spec, &s.text).err(),
        Some(Kind::KeyValueMap(spec)) => parse_key_value_map_text(spec, &s.text).err(),
        Some(Kind::Nested(spec)) => serde_json::from_str(&s.text)
            .map_err(|error| format!("invalid JSON object: {error}"))
            .and_then(|value| validate_object(&spec.fields, &value))
            .err(),
        Some(Kind::EnumSelection(spec)) => crate::enum_options::options(spec)
            .get(s.selection_index)
            .is_none()
            .then(|| "select an allowed option".into()),
        Some(Kind::Boolean(_)) => None,
        None => Some("unsupported field kind".into()),
    }
}

fn parse_key_value_map_text(spec: &KeyValueMapField, text: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| format!("invalid JSON object: {error}"))?;
    let entries = value
        .as_object()
        .ok_or_else(|| "value must be a JSON object".to_string())?;
    if spec.max_items > 0 && entries.len() > spec.max_items as usize {
        let noun = if spec.max_items == 1 {
            "entry"
        } else {
            "entries"
        };
        return Err(format!("must contain at most {} {noun}", spec.max_items));
    }
    for (key, value) in entries {
        if !value.is_string() {
            return Err(format!("value for key {key:?} must be a string"));
        }
    }
    Ok(())
}

fn parse_repeated_text(spec: &RepeatedField, text: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| format!("invalid JSON array: {error}"))?;
    parse_repeated_value(spec, &value)
}

fn parse_repeated_value(spec: &RepeatedField, value: &serde_json::Value) -> Result<(), String> {
    let items = value
        .as_array()
        .ok_or_else(|| "value must be a JSON array".to_string())?;
    if spec.min_items > 0 && items.len() < spec.min_items as usize {
        let noun = if spec.min_items == 1 { "item" } else { "items" };
        return Err(format!("must contain at least {} {noun}", spec.min_items));
    }
    if spec.max_items > 0 && items.len() > spec.max_items as usize {
        let noun = if spec.max_items == 1 { "item" } else { "items" };
        return Err(format!("must contain at most {} {noun}", spec.max_items));
    }
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let result = match spec.element.as_ref() {
                Some(Element::Scalar(field)) => parse_repeated_item(field, item),
                Some(Element::Object(object)) => validate_object(&object.fields, item),
                None => Err("missing repeated element kind".into()),
            };
            result.map_err(|error| format!("item {}: {error}", index + 1))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|_| ())
}

fn validate_object(fields: &[FormField], value: &serde_json::Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "must be a JSON object".to_string())?;
    if object
        .keys()
        .any(|key| !fields.iter().any(|field| &field.field_id == key))
    {
        return Err("unknown object field".into());
    }
    for field in fields {
        let value = object
            .get(&field.field_id)
            .ok_or_else(|| format!("missing field {}", field.field_id))?;
        parse_repeated_item(field, value)
            .map_err(|error| format!("{}: {error}", field.field_id))?;
    }
    Ok(())
}

pub(crate) fn has_masked_field(field: &FormField) -> bool {
    match field.kind.as_ref() {
        Some(Kind::Masked(_)) => true,
        Some(Kind::Nested(spec)) => spec.fields.iter().any(has_masked_field),
        Some(Kind::Repeated(spec)) => match spec.element.as_ref() {
            Some(Element::Scalar(field)) => has_masked_field(field),
            Some(Element::Object(object)) => object.fields.iter().any(has_masked_field),
            None => false,
        },
        _ => false,
    }
}

fn parse_repeated_item(field: &FormField, value: &serde_json::Value) -> Result<(), String> {
    match field.kind.as_ref() {
        Some(Kind::Text(input)) => {
            let value = value
                .as_str()
                .ok_or_else(|| "must be a string".to_string())?;
            length_and_pattern(
                value,
                input.min_length,
                input.max_length,
                &input.pattern,
                &input.pattern_error_msg,
            )
            .map_or(Ok(()), Err)
        }
        Some(Kind::Masked(input)) => {
            let value = value
                .as_str()
                .ok_or_else(|| "must be a string".to_string())?;
            length_and_pattern(
                value,
                input.min_length,
                input.max_length,
                &input.pattern,
                &input.pattern_error_msg,
            )
            .map_or(Ok(()), Err)
        }
        Some(Kind::Integer(input)) => {
            let value = value
                .as_i64()
                .ok_or_else(|| "must be an integer".to_string())?;
            if value.unsigned_abs() > 9_007_199_254_740_991 {
                Err("integer cannot be represented exactly by protobuf Value".into())
            } else if input.max != 0 && value > input.max as i64 {
                Err(format!("value must be ≤ {}", input.max))
            } else if input.min != 0 && value < input.min as i64 {
                Err(format!("value must be ≥ {}", input.min))
            } else {
                Ok(())
            }
        }
        Some(Kind::Number(input)) => {
            let value = value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(|| "must be a finite number".to_string())?;
            if input.max != 0.0 && value > input.max {
                Err(format!("value must be ≤ {}", input.max))
            } else if input.min != 0.0 && value < input.min {
                Err(format!("value must be ≥ {}", input.min))
            } else {
                Ok(())
            }
        }
        Some(Kind::Boolean(_)) => value
            .as_bool()
            .map(|_| ())
            .ok_or_else(|| "must be true or false".to_string()),
        Some(Kind::EnumSelection(spec)) => {
            let value = value
                .as_str()
                .ok_or_else(|| "must be a string token".to_string())?;
            let options = crate::enum_options::options(spec);
            if !options.iter().any(|option| option.0 == value) {
                Err(format!("unknown option {value:?}"))
            } else {
                Ok(())
            }
        }
        Some(Kind::Repeated(nested)) => parse_repeated_value(nested, value),
        Some(Kind::Nested(spec)) => validate_object(&spec.fields, value),
        Some(Kind::KeyValueMap(spec)) => parse_key_value_map_text(spec, &value.to_string()),
        None => Err("unsupported repeated element kind".to_string()),
    }
}

fn length_and_pattern(
    value: &str,
    min_length: i32,
    max_length: i32,
    pattern: &str,
    pattern_error_msg: &str,
) -> Option<String> {
    if min_length > 0 && (value.chars().count() as i32) < min_length {
        return Some(format!("must be at least {min_length} characters"));
    }
    if max_length > 0 && (value.chars().count() as i32) > max_length {
        return Some(format!("must be at most {max_length} characters"));
    }
    if !pattern.is_empty() {
        // Anchor the pattern unless the author already did — CFN
        // semantics are "the whole value must match," matching
        // `Regex::is_match` is "contains a match," so we wrap.
        let anchored = match (pattern.starts_with('^'), pattern.ends_with('$')) {
            (true, true) => pattern.to_string(),
            (true, false) => format!("{pattern}$"),
            (false, true) => format!("^{pattern}"),
            (false, false) => format!("^{pattern}$"),
        };
        match regex::Regex::new(&anchored) {
            Ok(re) => {
                if !re.is_match(value) {
                    return Some(if pattern_error_msg.is_empty() {
                        format!("must match {pattern}")
                    } else {
                        pattern_error_msg.to_string()
                    });
                }
            }
            Err(e) => return Some(format!("invalid pattern: {e}")),
        }
    }
    None
}

fn collect(states: &[FieldState]) -> HashMap<String, FieldValue> {
    let mut out = HashMap::with_capacity(states.len());
    for s in states {
        let value = match s.field.kind.as_ref() {
            Some(Kind::Text(_)) => FieldValue::Text(s.text.clone()),
            Some(Kind::Masked(_)) => FieldValue::Masked(s.text.clone()),
            Some(Kind::Integer(_)) => FieldValue::Integer(s.integer),
            Some(Kind::Number(_)) => FieldValue::Number(s.number),
            Some(Kind::Boolean(_)) => FieldValue::Boolean(s.boolean),
            Some(Kind::EnumSelection(spec)) => FieldValue::Selection(
                crate::enum_options::options(spec)
                    .get(s.selection_index)
                    .map(|option| option.0.to_string())
                    .unwrap_or_default(),
            ),
            Some(Kind::Repeated(_)) | Some(Kind::KeyValueMap(_)) | Some(Kind::Nested(_)) => {
                FieldValue::Text(s.text.clone())
            }
            None => FieldValue::Text(String::new()),
        };
        out.insert(s.field.field_id.clone(), value);
    }
    out
}

// ──────────────────────────────────────────────────────────────
// Drawing
// ──────────────────────────────────────────────────────────────

fn header_body_footer(detail: &str) -> Vec<Constraint> {
    if detail.is_empty() {
        vec![
            Constraint::Length(3),
            Constraint::Min(1),
            Constraint::Length(3),
        ]
    } else {
        vec![
            Constraint::Length(3),
            Constraint::Min(3),
            Constraint::Length(3),
        ]
    }
}

fn draw_header(f: &mut Frame, area: Rect, panel: &PromptPanel, palette: &Palette) {
    let text = if panel.description.is_empty() {
        Span::styled("Prompt", palette.title())
    } else {
        Span::styled(
            panel.description.lines().next().unwrap_or("").to_string(),
            palette.title(),
        )
    };
    f.render_widget(
        Paragraph::new(Line::from(text)).block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(palette.border_style()),
        ),
        area,
    );
}

fn draw_detail(f: &mut Frame, area: Rect, detail: &str) {
    f.render_widget(Paragraph::new(detail).wrap(Wrap { trim: false }), area);
}

fn draw_form(
    f: &mut Frame,
    area: Rect,
    panel: &PromptPanel,
    states: &[FieldState],
    focus: usize,
    palette: &Palette,
    multiline_rows: &HashMap<String, u32>,
) {
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if panel.description.is_empty() {
                0
            } else if area.height >= 8 {
                3
            } else {
                1
            }),
            Constraint::Min(1),
            Constraint::Length(if area.height >= 8 { 2 } else { 1 }),
        ])
        .split(area);

    if !panel.description.is_empty() {
        if outer[0].height > 1 {
            draw_header(f, outer[0], panel, palette);
        } else {
            f.render_widget(
                Paragraph::new(panel.description.lines().next().unwrap_or(""))
                    .style(palette.title()),
                outer[0],
            );
        }
    }

    // Page by focus so a host's smaller content Rect never traps editing offscreen.
    let field_height = |state: &FieldState| -> u16 {
        let overhead = 2 + u16::from(state.error.is_some());
        let lines = if let Some(rows) = multiline_rows.get(&state.field.field_id) {
            (*rows).min(outer[1].height.saturating_sub(overhead).max(1) as u32) as u16
        } else if matches!(state.field.kind, Some(Kind::Text(_))) {
            state.text.split('\n').count().clamp(1, 6) as u16
        } else {
            1
        };
        lines.saturating_add(overhead)
    };
    let mut start = 0;
    let mut used = 0u16;
    for index in 0..=focus.min(states.len().saturating_sub(1)) {
        used = used.saturating_add(field_height(&states[index]));
        while used > outer[1].height && start < index {
            used = used.saturating_sub(field_height(&states[start]));
            start += 1;
        }
    }
    let mut end = start;
    used = 0;
    while end < states.len()
        && (end == start || used.saturating_add(field_height(&states[end])) <= outer[1].height)
    {
        used = used.saturating_add(field_height(&states[end]));
        end += 1;
    }
    let visible = &states[start..end];
    let mut field_constraints = Vec::with_capacity(states.len());
    for s in visible {
        field_constraints.push(Constraint::Length(field_height(s)));
    }
    field_constraints.push(Constraint::Min(0)); // filler
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints(field_constraints)
        .split(outer[1]);

    for (i, s) in visible.iter().enumerate() {
        draw_field(f, rows[i], s, i + start == focus, palette);
    }

    let accept = if panel.accept_label.is_empty() {
        "Submit"
    } else {
        &panel.accept_label
    };
    let cancel = if panel.cancel_label.is_empty() {
        "Cancel"
    } else {
        &panel.cancel_label
    };
    let footer = Line::from(vec![
        Span::styled(format!(" {accept} [Enter] "), palette.success_style()),
        Span::raw(" "),
        Span::styled(format!(" {cancel} [Esc] "), palette.meta()),
        Span::raw(" "),
        Span::styled(" Navigate [Tab / Shift+Tab] ", palette.meta()),
        Span::raw(" Details [F1] "),
        Span::raw(format!(" Field {}/{}", focus + 1, states.len())),
    ]);
    let footer = Paragraph::new(footer);
    let footer = if outer[2].height > 1 {
        footer.block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(palette.border_style()),
        )
    } else {
        footer
    };
    f.render_widget(footer, outer[2]);
}

fn draw_field(f: &mut Frame, area: Rect, s: &FieldState, focused: bool, palette: &Palette) {
    let marker = if focused { "▶ " } else { "  " };
    let label_style = if focused {
        palette.focused()
    } else {
        palette.text()
    };

    let value_str = if has_masked_field(&s.field) {
        "******".to_string()
    } else {
        match s.field.kind.as_ref() {
            Some(Kind::Text(_)) => s.text.clone(),
            Some(Kind::Masked(_)) => "*".repeat(s.text.chars().count()),
            Some(Kind::Integer(_)) => format!("{}  (↑ / ↓)", s.integer),
            Some(Kind::Number(_)) => format!("{}  (↑ / ↓)", s.number),
            Some(Kind::Boolean(_)) => {
                format!("[{}]  (space)", if s.boolean { "x" } else { " " })
            }
            Some(Kind::EnumSelection(spec)) => {
                let allowed_values = crate::enum_options::options(spec);
                let current = allowed_values
                    .get(s.selection_index)
                    .map(|option| option.1)
                    .unwrap_or_default();
                format!(
                    "{current}    [{}/{}]",
                    s.selection_index + 1,
                    allowed_values.len()
                )
            }
            Some(Kind::Repeated(_)) => format!("{}  (JSON array)", s.text),
            Some(Kind::KeyValueMap(_)) => format!("{}  (JSON object)", s.text),
            Some(Kind::Nested(_)) => format!("{}  (JSON object)", s.text),
            None => String::new(),
        }
    };

    let mut lines = vec![Line::from(vec![
        Span::styled(marker, label_style),
        Span::styled(&s.field.label, label_style),
        if !s.field.description.is_empty() {
            Span::styled(format!("  — {}", s.field.description), palette.meta())
        } else {
            Span::raw("")
        },
    ])];
    let normalized = value_str.replace("\r\n", "\n").replace('\r', "\n");
    let value_lines: Vec<_> = normalized.split('\n').collect();
    let capacity = area.height.saturating_sub(2 + u16::from(s.error.is_some())) as usize;
    for line in &value_lines[value_lines.len().saturating_sub(capacity)..] {
        let style = match s.field.kind.as_ref() {
            Some(Kind::EnumSelection(spec)) => crate::enum_options::style(
                crate::enum_options::options(spec)
                    .get(s.selection_index)
                    .map_or(0, |option| option.2),
                palette,
            ),
            _ => palette.value(),
        };
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(line.to_string(), style),
        ]));
    }
    if let Some(err) = &s.error {
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(format!("✗ {err}"), palette.danger_style()),
        ]));
    }

    f.render_widget(Paragraph::new(lines), area);
}

#[cfg(test)]
mod shared_state_tests {
    use super::*;
    use ratatui::{backend::TestBackend, Terminal};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }
    fn panel(fields: Vec<FormField>) -> PromptPanel {
        PromptPanel {
            fields,
            ..Default::default()
        }
    }
    fn text() -> FormField {
        FormField {
            field_id: "text".into(),
            label: "Text".into(),
            kind: Some(Kind::Text(TextInput::default())),
            ..Default::default()
        }
    }

    #[test]
    fn reusable_state_collects_unicode_once_without_a_terminal_driver() {
        let mut state = PromptState::new(&panel(vec![text()])).unwrap();
        let mut release = key(KeyCode::Char('x'));
        release.kind = KeyEventKind::Release;
        assert!(state.handle_key(release).is_none());
        state.handle_key(key(KeyCode::Char('🦀')));
        state.handle_key(key(KeyCode::Char('z')));
        state.handle_key(key(KeyCode::Backspace));
        let Some(PromptResponse::Submitted(values)) = state.handle_key(key(KeyCode::Enter)) else {
            panic!("expected submission")
        };
        assert_eq!(values["text"].as_string(), "🦀");
        assert!(state.handle_key(key(KeyCode::Enter)).is_none());
        assert!(state.handle_key(key(KeyCode::Esc)).is_none());
    }

    #[test]
    fn tab_leaves_numeric_and_boolean_editors_while_arrows_edit_them() {
        let fields = vec![
            FormField {
                field_id: "integer".into(),
                kind: Some(Kind::Integer(IntegerSpinner::default())),
                ..Default::default()
            },
            FormField {
                field_id: "boolean".into(),
                kind: Some(Kind::Boolean(BooleanToggle::default())),
                ..Default::default()
            },
        ];
        let mut state = PromptState::new(&panel(fields)).unwrap();
        state.handle_key(key(KeyCode::Up));
        state.handle_key(key(KeyCode::Tab));
        assert_eq!(state.focus, 1);
        state.handle_key(key(KeyCode::Char(' ')));
        state.handle_key(key(KeyCode::BackTab));
        assert_eq!(state.focus, 0);
        let Some(PromptResponse::Submitted(values)) = state.handle_key(key(KeyCode::Enter)) else {
            panic!("expected submission")
        };
        assert!(matches!(values["integer"], FieldValue::Integer(1)));
        assert!(matches!(values["boolean"], FieldValue::Boolean(true)));
    }

    #[test]
    fn validation_preserves_edits_and_masks_values_in_an_embedded_rect() {
        let field = FormField {
            field_id: "secret".into(),
            label: "Secret".into(),
            kind: Some(Kind::Masked(MaskedInput {
                default_value: "secret".into(),
                min_length: 7,
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut state = PromptState::new(&panel(vec![field])).unwrap();
        assert!(state.handle_key(key(KeyCode::Enter)).is_none());
        assert!(state.states[0].error.is_some());
        assert_eq!(state.states[0].text, "secret");
        let mut terminal = Terminal::new(TestBackend::new(60, 20)).unwrap();
        let area = Rect::new(3, 2, 50, 14);
        terminal
            .draw(|frame| state.draw(frame, area, &Palette::default()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        let mut rendered = String::new();
        for y in 0..20 {
            for x in 0..60 {
                let symbol = buffer[(x, y)].symbol();
                rendered.push_str(symbol);
                if x < area.x || x >= area.right() || y < area.y || y >= area.bottom() {
                    assert_eq!(symbol, " ");
                }
            }
        }
        assert!(rendered.contains("Secret"));
        assert!(!rendered.contains("secret"));
        assert!(rendered.contains("******"));
        state.handle_key(key(KeyCode::Char('🦀')));
        let Some(PromptResponse::Submitted(values)) = state.handle_key(key(KeyCode::Enter)) else {
            panic!("expected repaired submission")
        };
        assert!(matches!(&values["secret"], FieldValue::Masked(value) if value == "secret🦀"));
    }

    #[test]
    fn confirmation_default_no_and_cancellation_remain_distinct_and_one_shot() {
        let panel = PromptPanel {
            is_confirmation: true,
            ..Default::default()
        };
        let mut no = PromptState::new(&panel).unwrap();
        assert!(no
            .handle_key(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL))
            .is_none());
        assert!(matches!(
            no.handle_key(key(KeyCode::Enter)),
            Some(PromptResponse::Confirmed(false))
        ));
        assert!(no.handle_key(key(KeyCode::Char('y'))).is_none());
        let mut canceled = PromptState::new(&panel).unwrap();
        assert!(matches!(
            canceled.handle_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Some(PromptResponse::Cancelled)
        ));
    }
}

#[cfg(test)]
mod enum_tests {
    use super::*;
    use meridian_uiview::proto::{EnumOption, EnumSelection, FormPanel, ValueTone};
    use prost::Message;
    use ratatui::{backend::TestBackend, Terminal};

    #[test]
    fn labeled_enum_wire_selection_renders_labels_and_submits_tokens() {
        let field = FormField {
            field_id: "state".into(),
            label: "State".into(),
            kind: Some(Kind::EnumSelection(EnumSelection {
                allowed_values: vec!["ignored".into()],
                default_value: "ok".into(),
                options: vec![
                    EnumOption {
                        value: "bad".into(),
                        label: "Needs attention".into(),
                        tone: ValueTone::Danger as i32,
                    },
                    EnumOption {
                        value: "ok".into(),
                        label: "Approved".into(),
                        tone: ValueTone::Success as i32,
                    },
                    EnumOption {
                        value: "other".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            })),
            ..Default::default()
        };
        let field = FormField::decode(field.encode_to_vec().as_slice()).unwrap();
        let mut state = initial_state(&field);
        assert_eq!(state.selection_index, 1);
        let palette = Palette::default();
        let mut terminal = Terminal::new(TestBackend::new(60, 8)).unwrap();
        terminal
            .draw(|f| draw_field(f, f.area(), &state, true, &palette))
            .unwrap();
        assert_eq!(terminal.backend().buffer()[(4, 1)].fg, palette.success);
        let text = format!("{:?}", terminal.backend().buffer());
        assert!(text.contains("Approved"));
        assert_eq!(
            collect(std::slice::from_ref(&state))["state"].as_string(),
            "ok"
        );
        apply_field_input(&mut state, KeyCode::Right);
        assert_eq!(
            collect(std::slice::from_ref(&state))["state"].as_string(),
            "other"
        );
        apply_field_input(&mut state, KeyCode::Right);
        assert_eq!(
            collect(std::slice::from_ref(&state))["state"].as_string(),
            "bad"
        );
        apply_field_input(&mut state, KeyCode::Left);
        assert_eq!(state.selection_index, 2);
        let panel = FormPanel {
            fields: vec![field],
            ..Default::default()
        };
        terminal
            .draw(|f| {
                crate::content::render_form(
                    f,
                    f.area(),
                    &panel,
                    &serde_json::json!({"state":"bad"}),
                    &palette,
                    0,
                )
            })
            .unwrap();
        assert!(format!("{:?}", terminal.backend().buffer()).contains("Needs attention"));
    }

    #[test]
    fn legacy_and_empty_enum_options_remain_supported() {
        let mut field = FormField {
            field_id: "state".into(),
            kind: Some(Kind::EnumSelection(EnumSelection {
                allowed_values: vec!["a".into(), "b".into()],
                default_value: "b".into(),
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut state = initial_state(&field);
        assert_eq!(
            collect(std::slice::from_ref(&state))["state"].as_string(),
            "b"
        );
        apply_field_input(&mut state, KeyCode::Right);
        assert_eq!(collect(&[state])["state"].as_string(), "a");
        field.kind = Some(Kind::EnumSelection(EnumSelection::default()));
        let mut state = initial_state(&field);
        apply_field_input(&mut state, KeyCode::Left);
        assert_eq!(collect(&[state])["state"].as_string(), "");
    }
}

#[cfg(test)]
mod repeated_tests {
    use super::*;
    use meridian_uiview::proto::{form_field, repeated_field, BooleanToggle, NestedForm};
    use ratatui::{backend::TestBackend, Terminal};

    fn repeated_field(element: FormField, min_items: u32, max_items: u32) -> FormField {
        FormField {
            field_id: "ports".into(),
            label: "Ports".into(),
            kind: Some(Kind::Repeated(Box::new(RepeatedField {
                element: Some(repeated_field::Element::Scalar(Box::new(element))),
                min_items,
                max_items,
                ..Default::default()
            }))),
            ..Default::default()
        }
    }

    #[test]
    fn repeated_integer_json_edits_validate_and_submit_raw_array() {
        let field = repeated_field(
            FormField {
                kind: Some(Kind::Integer(IntegerSpinner {
                    min: 1,
                    max: 65535,
                    ..Default::default()
                })),
                ..Default::default()
            },
            1,
            3,
        );
        validate_supported_fields(std::slice::from_ref(&field)).unwrap();
        let mut state = initial_state(&field);
        assert_eq!(state.text, "[]");
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("must contain at least 1 item")
        );

        apply_field_input(&mut state, KeyCode::Backspace);
        apply_field_input(&mut state, KeyCode::Backspace);
        for ch in "[443,8443]".chars() {
            apply_field_input(&mut state, KeyCode::Char(ch));
        }
        assert_eq!(validate_one(&state), None);
        let submitted = collect(std::slice::from_ref(&state));
        assert!(matches!(&submitted["ports"], FieldValue::Text(value) if value == "[443,8443]"));
        assert_eq!(submitted["ports"].as_string(), "[443,8443]");

        let palette = Palette::default();
        let mut terminal = Terminal::new(TestBackend::new(70, 6)).unwrap();
        terminal
            .draw(|frame| draw_field(frame, frame.area(), &state, true, &palette))
            .unwrap();
        let text = format!("{:?}", terminal.backend().buffer());
        assert!(text.contains("Ports"));
        assert!(text.contains("[443,8443]  (JSON array)"));
    }

    #[test]
    fn repeated_values_reject_malformed_json_types_constraints_and_unknown_options() {
        let text_field = repeated_field(
            FormField {
                kind: Some(Kind::Text(TextInput {
                    min_length: 2,
                    ..Default::default()
                })),
                ..Default::default()
            },
            0,
            2,
        );
        let mut state = initial_state(&text_field);
        state.text = "[".into();
        assert!(validate_one(&state)
            .unwrap()
            .starts_with("invalid JSON array:"));
        state.text = "[1]".into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("item 1: must be a string")
        );
        state.text = "[\"a\"]".into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("item 1: must be at least 2 characters")
        );
        state.text = "[\"aa\",\"bb\",\"cc\"]".into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("must contain at most 2 items")
        );

        let enum_field = repeated_field(
            FormField {
                kind: Some(Kind::EnumSelection(meridian_uiview::proto::EnumSelection {
                    allowed_values: vec!["dev".into(), "prod".into()],
                    ..Default::default()
                })),
                ..Default::default()
            },
            0,
            0,
        );
        let mut state = initial_state(&enum_field);
        state.text = "[\"staging\"]".into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("item 1: unknown option \"staging\"")
        );
    }

    #[test]
    fn nested_scalar_arrays_and_object_rows_validate_without_dropping_nested_fields() {
        let inner = repeated_field(
            FormField {
                kind: Some(Kind::Boolean(BooleanToggle::default())),
                ..Default::default()
            },
            0,
            0,
        );
        let outer = repeated_field(inner, 0, 0);
        validate_supported_fields(std::slice::from_ref(&outer)).unwrap();
        let mut state = initial_state(&outer);
        state.text = "[[true,false],[false]]".into();
        assert_eq!(validate_one(&state), None);
        assert_eq!(
            collect(&[state])["ports"].as_string(),
            "[[true,false],[false]]"
        );

        let object_rows = FormField {
            field_id: "objects".into(),
            kind: Some(Kind::Repeated(Box::new(RepeatedField {
                element: Some(repeated_field::Element::Object(NestedForm::default())),
                ..Default::default()
            }))),
            ..Default::default()
        };
        validate_supported_fields(std::slice::from_ref(&object_rows)).unwrap();
        let mut state = initial_state(&object_rows);
        state.text = "[{}]".into();
        assert_eq!(validate_one(&state), None);
        state.text = "[false]".into();
        assert!(validate_one(&state).is_some());

        let nested = FormField {
            field_id: "nested".into(),
            kind: Some(form_field::Kind::Nested(NestedForm::default())),
            ..Default::default()
        };
        validate_supported_fields(std::slice::from_ref(&nested)).unwrap();
        let mut state = initial_state(&nested);
        assert_eq!(state.text, "{}");
        assert_eq!(validate_one(&state), None);
        state.text = "[]".into();
        assert!(validate_one(&state).is_some());
    }
}

#[cfg(test)]
mod map_tests {
    use super::*;
    use ratatui::{backend::TestBackend, Terminal};

    fn map_field(max_items: u32) -> FormField {
        FormField {
            field_id: "labels".into(),
            label: "Labels".into(),
            kind: Some(Kind::KeyValueMap(KeyValueMapField {
                key_label: "Key".into(),
                value_label: "Value".into(),
                add_label: "Add label".into(),
                max_items,
            })),
            ..Default::default()
        }
    }

    #[test]
    fn map_json_edits_validate_render_and_submit_raw_object() {
        let field = map_field(3);
        validate_supported_fields(std::slice::from_ref(&field)).unwrap();
        let mut state = initial_state(&field);
        assert_eq!(state.text, "{}");
        assert_eq!(validate_one(&state), None);

        apply_field_input(&mut state, KeyCode::Backspace);
        apply_field_input(&mut state, KeyCode::Backspace);
        let raw = r#"{"env":"prod","owner":"platform"}"#;
        for ch in raw.chars() {
            apply_field_input(&mut state, KeyCode::Char(ch));
        }
        assert_eq!(validate_one(&state), None);
        let submitted = collect(std::slice::from_ref(&state));
        assert!(matches!(&submitted["labels"], FieldValue::Text(value) if value == raw));
        assert_eq!(submitted["labels"].as_string(), raw);

        let palette = Palette::default();
        let mut terminal = Terminal::new(TestBackend::new(80, 6)).unwrap();
        terminal
            .draw(|frame| draw_field(frame, frame.area(), &state, true, &palette))
            .unwrap();
        let text = format!("{:?}", terminal.backend().buffer());
        assert!(text.contains("Labels"));
        assert!(text.contains(r#"{"env":"prod","owner":"platform"}  (JSON object)"#));
    }

    #[test]
    fn map_values_reject_malformed_non_object_non_string_and_excess_entries() {
        let field = map_field(1);
        let mut state = initial_state(&field);

        state.text = "{".into();
        assert!(validate_one(&state)
            .unwrap()
            .starts_with("invalid JSON object:"));
        state.text = "[]".into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("value must be a JSON object")
        );
        state.text = r#"{"port":443}"#.into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("value for key \"port\" must be a string")
        );
        state.text = r#"{"env":"prod","owner":"platform"}"#.into();
        assert_eq!(
            validate_one(&state).as_deref(),
            Some("must contain at most 1 entry")
        );

        state.text = r#"{"producer-defined-key":"value"}"#.into();
        assert_eq!(validate_one(&state), None);
    }
}
