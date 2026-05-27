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
// map is keyed by `FormField.field_id`. Numeric/integer values
// preserve typing via the `FieldValue` enum.

use std::collections::HashMap;
use std::io;

use crossterm::{
    cursor, event,
    event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute, terminal,
};
use meridian_uiview::proto::{
    form_field::Kind, EnumSelection, FormField, IntegerSpinner, MaskedInput, PromptPanel,
    TextInput,
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame, Terminal,
};

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
}

impl FieldValue {
    /// Best-effort string view — useful for callers that just want
    /// to substitute the value as a CFN parameter override.
    pub fn as_string(&self) -> String {
        match self {
            FieldValue::Text(s) | FieldValue::Selection(s) | FieldValue::Masked(s) => s.clone(),
            FieldValue::Integer(n) => n.to_string(),
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
}

/// Render `panel` in raw mode and return the user's response.
///
/// Drives crossterm directly so the caller doesn't have to manage
/// terminal state. Suitable as a one-shot from a `bazel run` binary.
pub fn render_prompt(panel: &PromptPanel) -> Result<PromptResponse, PromptError> {
    if !panel.is_confirmation && panel.fields.is_empty() {
        return Err(PromptError::EmptyPrompt);
    }

    // Validate that every field carries a recognised kind up front
    // so we fail fast before entering raw mode (where errors are
    // harder to surface cleanly).
    for f in &panel.fields {
        if f.kind.is_none() {
            return Err(PromptError::UnsupportedKind {
                field_id: f.field_id.clone(),
            });
        }
    }

    let mut stdout = io::stdout();
    terminal::enable_raw_mode()?;
    execute!(stdout, terminal::EnterAlternateScreen, cursor::Hide)?;
    let backend = CrosstermBackend::new(stdout);
    let mut term = Terminal::new(backend)?;

    let result = if panel.is_confirmation {
        run_confirmation(&mut term, panel)
    } else {
        run_form(&mut term, panel)
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

// ──────────────────────────────────────────────────────────────
// Confirmation mode
// ──────────────────────────────────────────────────────────────

fn run_confirmation<B: ratatui::backend::Backend>(
    term: &mut Terminal<B>,
    panel: &PromptPanel,
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
        term.draw(|f| draw_confirmation(f, panel, accept, cancel))?;

        if let Event::Key(KeyEvent {
            code, kind, modifiers, ..
        }) = event::read()?
        {
            if kind != KeyEventKind::Press {
                continue;
            }
            match code {
                KeyCode::Char('y') | KeyCode::Char('Y') => return Ok(PromptResponse::Confirmed(true)),
                KeyCode::Char('n') | KeyCode::Char('N') => return Ok(PromptResponse::Confirmed(false)),
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

fn draw_confirmation(f: &mut Frame, panel: &PromptPanel, accept: &str, cancel: &str) {
    let area = f.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(header_body_footer(&panel.detail))
        .split(area);

    draw_header(f, chunks[0], panel);
    if !panel.detail.is_empty() {
        draw_detail(f, chunks[1], &panel.detail);
    }
    let prompt = Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{accept} [y]"), Style::default().fg(Color::Green)),
        Span::raw("   "),
        Span::styled(
            format!("{cancel} [n/Enter]"),
            Style::default().fg(Color::Red),
        ),
        Span::raw("   "),
        Span::styled("Cancel [Esc]", Style::default().fg(Color::DarkGray)),
    ]);
    f.render_widget(
        Paragraph::new(prompt).block(Block::default().borders(Borders::TOP)),
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
    /// Selected index into EnumSelection.allowed_values.
    selection_index: usize,
    /// Last validation error, displayed under the field.
    error: Option<String>,
}

fn run_form<B: ratatui::backend::Backend>(
    term: &mut Terminal<B>,
    panel: &PromptPanel,
) -> Result<PromptResponse, PromptError> {
    let mut states: Vec<FieldState> = panel.fields.iter().map(initial_state).collect();
    let mut focus: usize = 0;

    loop {
        term.draw(|f| draw_form(f, panel, &states, focus))?;

        if let Event::Key(KeyEvent { code, kind, modifiers, .. }) = event::read()? {
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
    let (text, integer, selection_index) = match f.kind.as_ref() {
        Some(Kind::Text(TextInput { default_value, .. })) => (default_value.clone(), 0, 0),
        Some(Kind::Masked(MaskedInput { default_value, .. })) => (default_value.clone(), 0, 0),
        Some(Kind::Integer(IntegerSpinner { default_value, .. })) => (String::new(), *default_value as i64, 0),
        Some(Kind::EnumSelection(EnumSelection {
            allowed_values,
            default_value,
        })) => {
            let idx = allowed_values
                .iter()
                .position(|v| v == default_value)
                .unwrap_or(0);
            (String::new(), 0, idx)
        }
        None => (String::new(), 0, 0),
    };
    FieldState {
        field: f.clone(),
        text,
        integer,
        selection_index,
        error: None,
    }
}

/// True for fields whose left/right/up/down keys edit them rather
/// than navigate. EnumSelection wants Up/Down to change the choice;
/// IntegerSpinner wants Up/Down to increment.
fn is_editing_field(s: &FieldState) -> bool {
    matches!(
        s.field.kind.as_ref(),
        Some(Kind::EnumSelection(_)) | Some(Kind::Integer(_))
    )
}

fn apply_field_input(s: &mut FieldState, code: KeyCode) {
    match s.field.kind.as_ref() {
        Some(Kind::Text(_)) | Some(Kind::Masked(_)) => match code {
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
        Some(Kind::EnumSelection(EnumSelection { allowed_values, .. })) => {
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
        })) => length_and_pattern(&s.text, *min_length, *max_length, pattern, pattern_error_msg),
        Some(Kind::Integer(IntegerSpinner { min, max, .. })) => {
            if *max != 0 && s.integer > *max as i64 {
                Some(format!("value must be ≤ {max}"))
            } else if *min != 0 && s.integer < *min as i64 {
                Some(format!("value must be ≥ {min}"))
            } else {
                None
            }
        }
        Some(Kind::EnumSelection(_)) | None => None,
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
            Some(Kind::EnumSelection(EnumSelection { allowed_values, .. })) => FieldValue::Selection(
                allowed_values
                    .get(s.selection_index)
                    .cloned()
                    .unwrap_or_default(),
            ),
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

fn draw_header(f: &mut Frame, area: Rect, panel: &PromptPanel) {
    let text = if panel.description.is_empty() {
        Span::styled(
            "Prompt",
            Style::default().add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            panel.description.lines().next().unwrap_or("").to_string(),
            Style::default().add_modifier(Modifier::BOLD),
        )
    };
    f.render_widget(
        Paragraph::new(Line::from(text))
            .block(Block::default().borders(Borders::BOTTOM)),
        area,
    );
}

fn draw_detail(f: &mut Frame, area: Rect, detail: &str) {
    f.render_widget(
        Paragraph::new(detail).wrap(Wrap { trim: false }),
        area,
    );
}

fn draw_form(f: &mut Frame, panel: &PromptPanel, states: &[FieldState], focus: usize) {
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
        draw_header(f, outer[0], panel);
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
        draw_field(f, rows[i], s, i == focus);
    }

    let accept = if panel.accept_label.is_empty() {
        "Submit"
    } else {
        &panel.accept_label
    };
    let footer = Line::from(vec![
        Span::styled(
            format!(" {accept} [Enter] "),
            Style::default().fg(Color::Green),
        ),
        Span::raw(" "),
        Span::styled(" Cancel [Esc] ", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled(
            " Navigate [Tab / Shift+Tab] ",
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    f.render_widget(
        Paragraph::new(footer).block(Block::default().borders(Borders::TOP)),
        outer[2],
    );
}

fn draw_field(f: &mut Frame, area: Rect, s: &FieldState, focused: bool) {
    let marker = if focused { "▶ " } else { "  " };
    let label_style = if focused {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Gray)
    };

    let value_str = match s.field.kind.as_ref() {
        Some(Kind::Text(_)) => s.text.clone(),
        Some(Kind::Masked(_)) => "*".repeat(s.text.chars().count()),
        Some(Kind::Integer(_)) => format!("{}  (↑ / ↓)", s.integer),
        Some(Kind::EnumSelection(EnumSelection { allowed_values, .. })) => {
            let current = allowed_values
                .get(s.selection_index)
                .cloned()
                .unwrap_or_default();
            format!("{current}    [{}/{}]", s.selection_index + 1, allowed_values.len())
        }
        None => String::new(),
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(marker, label_style),
            Span::styled(&s.field.label, label_style),
            if !s.field.description.is_empty() {
                Span::styled(
                    format!("  — {}", s.field.description),
                    Style::default().fg(Color::DarkGray),
                )
            } else {
                Span::raw("")
            },
        ]),
        Line::from(vec![
            Span::raw("    "),
            Span::styled(value_str, Style::default().fg(Color::White)),
        ]),
    ];
    if let Some(err) = &s.error {
        lines.push(Line::from(vec![
            Span::raw("    "),
            Span::styled(format!("✗ {err}"), Style::default().fg(Color::Red)),
        ]));
    }

    f.render_widget(Paragraph::new(lines), area);
}
