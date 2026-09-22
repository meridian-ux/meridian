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

use std::collections::HashMap;
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
    #[error("terminal io: {0}")]
    Io(#[from] io::Error),
    #[error("prompt panel has no fields and is_confirmation = false")]
    EmptyPrompt,
    #[error("field {field_id}: unsupported kind (missing FormField.kind oneof)")]
    UnsupportedKind { field_id: String },
    /// `NestedFields` describes a sub-object, but `PromptResponse::Submitted` is
    /// flat (keyed by `field_id`), so there is nowhere to put the children's
    /// values. Rejected up front rather than rendered as a form that silently
    /// drops a whole branch of the request.
    #[error(
        "field {field_id}: nested sub-forms are not supported by the one-shot prompt renderer"
    )]
    NestedUnsupported { field_id: String },
    /// Scalar repeated fields use a typed JSON-array editor. Object rows and
    /// malformed repeated declarations remain unsupported because the one-shot
    /// renderer has no nested row editor.
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

    validate_supported_fields(&panel.fields)?;

    let mut stdout = io::stdout();
    terminal::enable_raw_mode()?;
    execute!(stdout, terminal::EnterAlternateScreen, cursor::Hide)?;
    let backend = CrosstermBackend::new(stdout);
    let mut term = Terminal::new(backend)?;

    let result = if panel.is_confirmation {
        run_confirmation(&mut term, panel, palette)
    } else {
        run_form(&mut term, panel, palette)
    };

    // Always restore terminal state, even on Err.
    let _ = execute!(
        term.backend_mut(),
        terminal::LeaveAlternateScreen,
        cursor::Show
    );
    let _ = terminal::disable_raw_mode();

    result
}

/// Fail before raw mode for shapes the one-shot editor cannot faithfully
/// collect. Scalar repeated fields (including nested scalar arrays) and string
/// maps are valid; object rows still require the richer FormPanel row editor.
fn validate_supported_fields(fields: &[FormField]) -> Result<(), PromptError> {
    for field in fields {
        match field.kind.as_ref() {
            None => {
                return Err(PromptError::UnsupportedKind {
                    field_id: field.field_id.clone(),
                })
            }
            Some(Kind::Nested(_)) => {
                return Err(PromptError::NestedUnsupported {
                    field_id: field.field_id.clone(),
                })
            }
            Some(Kind::Repeated(spec)) => validate_repeated_shape(field, spec)?,
            Some(Kind::KeyValueMap(_)) => {}
            Some(_) => {}
        }
    }
    Ok(())
}

fn validate_repeated_shape(field: &FormField, spec: &RepeatedField) -> Result<(), PromptError> {
    let Some(Element::Scalar(scalar)) = spec.element.as_ref() else {
        return Err(PromptError::RepeatedUnsupported {
            field_id: field.field_id.clone(),
        });
    };
    match scalar.kind.as_ref() {
        Some(Kind::Repeated(nested)) => validate_repeated_shape(field, nested),
        Some(Kind::Nested(_)) | Some(Kind::KeyValueMap(_)) | None => {
            Err(PromptError::RepeatedUnsupported {
                field_id: field.field_id.clone(),
            })
        }
        Some(_) => Ok(()),
    }
}

// ──────────────────────────────────────────────────────────────
// Confirmation mode
// ──────────────────────────────────────────────────────────────

fn run_confirmation<B: ratatui::backend::Backend>(
    term: &mut Terminal<B>,
    panel: &PromptPanel,
    palette: &Palette,
) -> Result<PromptResponse, PromptError> {
    let accept = if panel.accept_label.is_empty() {
        "Yes"
    } else {
        &panel.accept_label
    };
    let cancel = if panel.cancel_label.is_empty() {
        "No"
    } else {
        &panel.cancel_label
    };

    loop {
        term.draw(|f| draw_confirmation(f, panel, accept, cancel, palette))?;

        if let Event::Key(KeyEvent {
            code,
            kind,
            modifiers,
            ..
        }) = event::read()?
        {
            if kind != KeyEventKind::Press {
                continue;
            }
            match code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    return Ok(PromptResponse::Confirmed(true))
                }
                KeyCode::Char('n') | KeyCode::Char('N') => {
                    return Ok(PromptResponse::Confirmed(false))
                }
                KeyCode::Enter => return Ok(PromptResponse::Confirmed(false)), // default = No
                KeyCode::Esc => return Ok(PromptResponse::Cancelled),
                KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                    return Ok(PromptResponse::Cancelled);
                }
                _ => {}
            }
        }
    }
}

fn draw_confirmation(
    f: &mut Frame,
    panel: &PromptPanel,
    accept: &str,
    cancel: &str,
    palette: &Palette,
) {
    let area = f.area();
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

fn run_form<B: ratatui::backend::Backend>(
    term: &mut Terminal<B>,
    panel: &PromptPanel,
    palette: &Palette,
) -> Result<PromptResponse, PromptError> {
    let mut states: Vec<FieldState> = panel.fields.iter().map(initial_state).collect();
    let mut focus: usize = 0;

    loop {
        term.draw(|f| draw_form(f, panel, &states, focus, palette))?;

        if let Event::Key(KeyEvent {
            code,
            kind,
            modifiers,
            ..
        }) = event::read()?
        {
            if kind != KeyEventKind::Press {
                continue;
            }
            // Global keys first.
            match code {
                KeyCode::Esc => return Ok(PromptResponse::Cancelled),
                KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                    return Ok(PromptResponse::Cancelled);
                }
                KeyCode::Tab | KeyCode::Down if !is_editing_field(&states[focus]) => {
                    focus = (focus + 1) % states.len();
                    continue;
                }
                KeyCode::BackTab | KeyCode::Up if !is_editing_field(&states[focus]) => {
                    focus = (focus + states.len() - 1) % states.len();
                    continue;
                }
                KeyCode::Enter => {
                    // Validate every field. If all pass, return values.
                    if validate_all(&mut states) {
                        return Ok(PromptResponse::Submitted(collect(&states)));
                    }
                    // Else: errors are now populated; re-render shows them.
                    continue;
                }
                _ => {}
            }
            // Per-kind keys.
            apply_field_input(&mut states[focus], code);
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
        // Nested fields are rejected in render_prompt before state is built.
        Some(Kind::Nested(_)) | None => {}
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
        Some(Kind::Nested(_)) | None => {}
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
            if *max != 0 && s.integer > *max as i64 {
                Some(format!("value must be ≤ {max}"))
            } else if *min != 0 && s.integer < *min as i64 {
                Some(format!("value must be ≥ {min}"))
            } else {
                None
            }
        }
        Some(Kind::Number(NumberInput { min, max, .. })) => {
            if *max != 0.0 && s.number > *max {
                Some(format!("value must be ≤ {max}"))
            } else if *min != 0.0 && s.number < *min {
                Some(format!("value must be ≥ {min}"))
            } else {
                None
            }
        }
        Some(Kind::Repeated(spec)) => parse_repeated_text(spec, &s.text).err(),
        Some(Kind::KeyValueMap(spec)) => parse_key_value_map_text(spec, &s.text).err(),
        Some(Kind::Boolean(_)) | Some(Kind::EnumSelection(_)) | Some(Kind::Nested(_)) | None => {
            None
        }
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
    let Some(Element::Scalar(field)) = spec.element.as_ref() else {
        return Err("repeated object rows are not supported".to_string());
    };
    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            parse_repeated_item(field, item).map_err(|error| format!("item {}: {error}", index + 1))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|_| ())
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
            if input.max != 0 && value > input.max as i64 {
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
            if !options.is_empty() && !options.iter().any(|option| option.0 == value) {
                Err(format!("unknown option {value:?}"))
            } else {
                Ok(())
            }
        }
        Some(Kind::Repeated(nested)) => parse_repeated_value(nested, value),
        Some(Kind::Nested(_)) | Some(Kind::KeyValueMap(_)) | None => {
            Err("unsupported repeated element kind".to_string())
        }
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
            Some(Kind::Repeated(_)) | Some(Kind::KeyValueMap(_)) => {
                FieldValue::Text(s.text.clone())
            }
            Some(Kind::Nested(_)) | None => FieldValue::Text(String::new()),
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
    panel: &PromptPanel,
    states: &[FieldState],
    focus: usize,
    palette: &Palette,
) {
    let area = f.area();
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if panel.description.is_empty() { 0 } else { 3 }),
            Constraint::Min(1),
            Constraint::Length(2),
        ])
        .split(area);

    if !panel.description.is_empty() {
        draw_header(f, outer[0], panel, palette);
    }

    // Field rows: 2 lines per field (label + value) + 1 for error if any.
    let mut field_constraints = Vec::with_capacity(states.len());
    for s in states {
        field_constraints.push(Constraint::Length(if s.error.is_some() { 4 } else { 3 }));
    }
    field_constraints.push(Constraint::Min(0)); // filler
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints(field_constraints)
        .split(outer[1]);

    for (i, s) in states.iter().enumerate() {
        draw_field(f, rows[i], s, i == focus, palette);
    }

    let accept = if panel.accept_label.is_empty() {
        "Submit"
    } else {
        &panel.accept_label
    };
    let footer = Line::from(vec![
        Span::styled(format!(" {accept} [Enter] "), palette.success_style()),
        Span::raw(" "),
        Span::styled(" Cancel [Esc] ", palette.meta()),
        Span::raw(" "),
        Span::styled(" Navigate [Tab / Shift+Tab] ", palette.meta()),
    ]);
    f.render_widget(
        Paragraph::new(footer).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(palette.border_style()),
        ),
        outer[2],
    );
}

fn draw_field(f: &mut Frame, area: Rect, s: &FieldState, focused: bool, palette: &Palette) {
    let marker = if focused { "▶ " } else { "  " };
    let label_style = if focused {
        palette.focused()
    } else {
        palette.text()
    };

    let value_str = match s.field.kind.as_ref() {
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
        Some(Kind::Nested(_)) | None => String::new(),
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(marker, label_style),
            Span::styled(&s.field.label, label_style),
            if !s.field.description.is_empty() {
                Span::styled(format!("  — {}", s.field.description), palette.meta())
            } else {
                Span::raw("")
            },
        ]),
        Line::from(vec![
            Span::raw("    "),
            Span::styled(
                value_str,
                match s.field.kind.as_ref() {
                    Some(Kind::EnumSelection(spec)) => crate::enum_options::style(
                        crate::enum_options::options(spec)
                            .get(s.selection_index)
                            .map_or(0, |o| o.2),
                        palette,
                    ),
                    _ => palette.value(),
                },
            ),
        ]),
    ];
    if let Some(err) = &s.error {
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(format!("✗ {err}"), palette.danger_style()),
        ]));
    }

    f.render_widget(Paragraph::new(lines), area);
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
    fn nested_scalar_arrays_are_typed_but_object_rows_and_nested_forms_stay_rejected() {
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
        assert!(matches!(
            validate_supported_fields(&[object_rows]),
            Err(PromptError::RepeatedUnsupported { .. })
        ));

        let nested = FormField {
            field_id: "nested".into(),
            kind: Some(form_field::Kind::Nested(NestedForm::default())),
            ..Default::default()
        };
        assert!(matches!(
            validate_supported_fields(&[nested]),
            Err(PromptError::NestedUnsupported { .. })
        ));
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
