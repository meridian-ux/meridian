use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_uiview::proto::panel_descriptor::Body;
use meridian_uiview::proto::{
    form_field::Kind, ChartPanel, FormField, FormMode, FormPanel, GalleryPanel, LroPanel,
    PanelDescriptor, ResourceCardPanel, RpcCall, StreamFrame, TablePanel,
};
use meridian_uiview::{
    render_gallery_bounded, render_table_bounded, Context, RenderedCard, RenderedRow,
    RequestBudget, RequestBuilder, RequestOverrides, SubmissionKind,
};
use prost::Message as _;
use ratatui::layout::{Constraint, Layout};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;
use std::sync::Arc;

use crate::content;
use crate::inline_prompt::{InlinePrompt, PanelPromptResponse};
use crate::invoker::{RpcError, RpcInvoker, StreamInvoker, StreamSession};
use crate::lro::{LroRun, LroRunId};
use crate::prompt::{PromptResponse, PromptState};
use crate::theme::Palette;
use crate::{
    NativeAction, NativeInvocationContext, NativeInvocationDispatcher, NativeInvocationHost,
    NativeInvocationOutcome,
};
mod actions;

// Keep an unspecified StreamPanel bounded just like the browser renderer. The
// schema deliberately leaves the exact default to each surface, but it also
// requires every renderer to prevent an unbounded stream from growing forever.
const STREAM_DEFAULT_MAX_LINES: usize = 2_000;
const REQUEST_ERROR: &str = "Request construction limit exceeded.";

fn build_request(
    call: &RpcCall,
    context: &Context,
    record: Option<&serde_json::Value>,
) -> Result<serde_json::Value, RpcError> {
    RequestBuilder::build_for_boundary_with(
        call,
        context,
        RequestOverrides {
            selected_row: record,
            ..Default::default()
        },
    )
    .map_err(|_| RpcError::Other(REQUEST_ERROR.into()))
}

fn invoke_request<I: RpcInvoker>(
    call: &RpcCall,
    context: &Context,
    invoker: &I,
    record: Option<&serde_json::Value>,
) -> Result<serde_json::Value, RpcError> {
    let request = build_request(call, context, record)?;
    let response = invoker.invoke(&call.service, &call.method, request)?;
    RequestBudget::for_boundary(&response)
        .map_err(|_| RpcError::Other("Response construction limit exceeded.".into()))?;
    Ok(response)
}

/// Stateful ratatui widget rendering one PanelDescriptor. For
/// TablePanels it does its own populate call against the invoker
/// (lazy + cached); for LroPanels it renders host-driven progress and results;
/// for AdhocPanels it surfaces
/// the handler_id so the host knows which custom view to swap in.
///
/// All look comes from `palette` (derived from a `meridian.theme.v1.Theme`):
/// no `Color::` / `Style::` literal lives in this file. Hosts that load a skin
/// build a `Palette::from_theme(...)` and pass it via `with_palette`; the
/// default is meridian's neutral dark palette so an un-themed run still reads.
pub struct PanelView {
    row_actions: actions::State,
    invocation_visible: bool,
    invocation_viewport: Option<bool>,
    invocations: NativeInvocationDispatcher,
    form_scope: Option<Arc<Vec<u8>>>,
    shared_form_scope: Option<Option<Arc<Vec<u8>>>>,
    form_completed: Option<u64>,
    ambient_record: Option<Arc<serde_json::Value>>,
    inline_prompt: Option<InlinePrompt>,
    cached: Option<CachedTable>,
    cached_chart: Option<CachedChart>,
    cached_stat: Option<CachedRecord>,
    cached_gallery: Option<CachedGallery>,
    cached_record: Option<CachedRecord>,
    cached_resource_cards: Option<CachedResourceCards>,
    cached_form: Option<CachedForm>,
    cached_lro: Option<CachedForm>,
    lro_run: Option<LroRun>,
    lro_identity: Option<(
        Vec<u8>,
        Result<serde_json::Value, meridian_uiview::RequestLimitExceeded>,
    )>,
    stream_lines: Vec<String>,
    stream_session: Option<StreamSession>,
    stream_request_key: Option<String>,
    stream_error: Option<String>,
    stream_scroll: usize,
    stream_follow: bool,
    stream_auto_follow: bool,
    stream_view_height: usize,
    table_state: TableState,
    palette: Palette,
    // Selection cursor for the *content* shapes (Choice / ConnectFlow / Catalog /
    // Action). Advanced by the same select_next/prev the host wires for table
    // rows; `content_len` is set at render time so the cursor wraps into range.
    content_selected: usize,
    content_len: usize,
    // Whether a masked CopyValue secret is currently revealed (host toggles via
    // toggle_reveal); copy still yields plaintext regardless.
    reveal_secret: bool,
}

pub(crate) struct CachedTable {
    pub rows: Vec<RenderedRow>,
    pub item_noun: String,
}

struct CachedChart {
    rows: Option<Vec<(String, String)>>,
    error: Option<String>,
}

struct CachedGallery {
    cards: Vec<RenderedCard>,
    error: Option<String>,
}

struct CachedRecord {
    record: Option<Arc<serde_json::Value>>,
    error: Option<String>,
}

struct CachedResourceCards {
    rows: Vec<serde_json::Value>,
    error: Option<String>,
}

struct CachedForm {
    revision: u64,
    descriptor: Vec<u8>,
    values: serde_json::Value,
    error: Option<String>,
    validation_error: Option<String>,
    editor: Option<(String, PromptState)>,
}

impl CachedForm {
    fn compound_key(&mut self, fields: &[FormField], selected: usize, key: KeyCode) -> bool {
        if let Some((id, state)) = &mut self.editor {
            if key == KeyCode::Delete {
                state.clear_text();
                return true;
            }
            let response = state.handle_key(KeyEvent::new(key, KeyModifiers::NONE));
            match response {
                Some(PromptResponse::Submitted(values)) => {
                    if let Some(value) = values.get(id).and_then(|value| {
                        serde_json::from_str::<serde_json::Value>(&value.as_string()).ok()
                    }) {
                        if self.values.get(id.as_str()) != Some(&value) {
                            self.revision = self.revision.saturating_add(1);
                            self.values[id.as_str()] = value;
                        }
                        self.validation_error = None;
                    }
                    self.editor = None;
                }
                Some(PromptResponse::Cancelled) => self.editor = None,
                _ => {}
            }
            return true;
        }
        if key != KeyCode::F(2) {
            return false;
        }
        if let Some(field) = fields.get(selected) {
            if matches!(
                field.kind,
                Some(Kind::Nested(_)) | Some(Kind::Repeated(_)) | Some(Kind::KeyValueMap(_))
            ) {
                match PromptState::edit_compound(field, &self.values[&field.field_id]) {
                    Ok(state) => self.editor = Some((field.field_id.clone(), state)),
                    Err(error) => self.validation_error = Some(error.to_string()),
                }
            }
        }
        true
    }

    fn validate(&mut self, fields: &[FormField]) -> bool {
        self.validation_error = meridian_uiview::validate_form_values(fields, &self.values).err();
        self.error.is_none() && self.validation_error.is_none()
    }

    fn draw_overlay(&self, frame: &mut Frame, area: ratatui::layout::Rect, palette: &Palette) {
        if let Some((_, state)) = &self.editor {
            frame.render_widget(ratatui::widgets::Clear, area);
            state.draw(frame, area, palette);
        } else if let Some(error) = self.validation_error.as_ref().or(self.error.as_ref()) {
            let line = ratatui::layout::Rect {
                y: area.y + area.height.saturating_sub(1),
                height: area.height.min(1),
                ..area
            };
            frame.render_widget(Paragraph::new(error.as_str()).style(palette.meta()), line);
        }
    }
}

/// Result emitted when an inline editable FormPanel is submitted. The host
/// owns the actual transport and decides how to surface the RPC response.
#[derive(Debug, Clone, PartialEq)]
pub struct FormSubmission {
    pub service: String,
    pub method: String,
    pub request: serde_json::Value,
}

/// Start request emitted by an editable LroPanel. The host invokes this RPC,
/// polls the returned long-running operation, and feeds any final result into
/// the descriptor's optional TablePanel result renderer.
#[derive(Debug, Clone, PartialEq)]
pub struct LroSubmission {
    /// Pass this identity back with every progress/completion callback.
    pub run_id: LroRunId,
    pub service: String,
    pub method: String,
    pub request: serde_json::Value,
}

impl PanelView {
    pub fn new() -> Self {
        Self {
            row_actions: actions::State::default(),
            invocation_visible: false,
            invocation_viewport: None,
            invocations: NativeInvocationDispatcher::default(),
            form_scope: None,
            shared_form_scope: None,
            form_completed: None,
            ambient_record: None,
            inline_prompt: None,
            cached: None,
            cached_chart: None,
            cached_stat: None,
            cached_gallery: None,
            cached_record: None,
            cached_resource_cards: None,
            cached_form: None,
            cached_lro: None,
            lro_run: None,
            lro_identity: None,
            stream_lines: Vec::new(),
            stream_session: None,
            stream_request_key: None,
            stream_error: None,
            stream_scroll: 0,
            stream_follow: true,
            stream_auto_follow: true,
            stream_view_height: 1,
            table_state: TableState::default(),
            palette: Palette::default(),
            content_selected: 0,
            content_len: 0,
            reveal_secret: false,
        }
    }

    /// Build a PanelView that sources its look from `palette` (typically
    /// `Palette::from_theme(&theme, mode)`). Use this to skin the renderer.
    pub fn with_palette(palette: Palette) -> Self {
        Self {
            row_actions: actions::State::default(),
            invocation_visible: false,
            invocation_viewport: None,
            invocations: NativeInvocationDispatcher::default(),
            form_scope: None,
            shared_form_scope: None,
            form_completed: None,
            ambient_record: None,
            inline_prompt: None,
            cached: None,
            cached_chart: None,
            cached_stat: None,
            cached_gallery: None,
            cached_record: None,
            cached_resource_cards: None,
            cached_form: None,
            cached_lro: None,
            lro_run: None,
            lro_identity: None,
            stream_lines: Vec::new(),
            stream_session: None,
            stream_request_key: None,
            stream_error: None,
            stream_scroll: 0,
            stream_follow: true,
            stream_auto_follow: true,
            stream_view_height: 1,
            table_state: TableState::default(),
            palette,
            content_selected: 0,
            content_len: 0,
            reveal_secret: false,
        }
    }

    /// Supply a bounded snapshot for a StreamPanel. Hosts own the live
    /// subscription; the TUI retains only the panel's configured tail.
    pub fn set_stream_lines(
        &mut self,
        panel: &meridian_uiview::proto::StreamPanel,
        lines: Vec<String>,
    ) {
        let max = if panel.max_lines == 0 {
            STREAM_DEFAULT_MAX_LINES
        } else {
            panel.max_lines as usize
        };
        self.stream_lines = lines
            .into_iter()
            .rev()
            .take(max)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        self.stream_auto_follow =
            panel.follow_mode != meridian_uiview::proto::FollowMode::Manual as i32;
        self.stream_follow = self.stream_auto_follow;
        self.stream_scroll = if self.stream_follow {
            self.stream_lines.len()
        } else {
            0
        };
    }

    /// Start or poll the active stream using the host's transport adapter.
    pub fn poll_stream<I: StreamInvoker>(
        &mut self,
        descriptor: &PanelDescriptor,
        context: &Context,
        invoker: &I,
    ) {
        let Some(Body::Stream(panel)) = descriptor.body.as_ref() else {
            self.stream_session = None;
            self.stream_request_key = None;
            self.stream_error = None;
            self.stream_lines.clear();
            return;
        };
        let request = match panel
            .subscribe
            .as_ref()
            .map(|call| build_request(call, context, self.ambient_record.as_deref()))
            .transpose()
        {
            Ok(request) => {
                self.stream_error = None;
                request.unwrap_or_else(|| serde_json::json!({}))
            }
            Err(_) => {
                self.stream_session = None;
                self.stream_request_key = None;
                self.stream_lines.clear();
                self.stream_error = Some(REQUEST_ERROR.into());
                return;
            }
        };
        let key = format!(
            "{}:{}:{}",
            panel
                .subscribe
                .as_ref()
                .map(|c| c.service.as_str())
                .unwrap_or_default(),
            panel
                .subscribe
                .as_ref()
                .map(|c| c.method.as_str())
                .unwrap_or_default(),
            request
        );
        if self.stream_request_key.as_deref() != Some(key.as_str()) {
            self.stream_session = None;
            self.stream_lines.clear();
            self.stream_scroll = 0;
            self.stream_auto_follow =
                panel.follow_mode != meridian_uiview::proto::FollowMode::Manual as i32;
            self.stream_follow = self.stream_auto_follow;
            self.stream_request_key = Some(key);
            self.stream_session = panel
                .subscribe
                .as_ref()
                .and_then(|call| invoker.subscribe(call, request).ok());
            if let Some(session) = self.stream_session.as_mut() {
                session.apply_limits(panel.max_bytes, panel.max_rate);
            }
        }
        let mut appended = 0usize;
        if let Some(session) = self.stream_session.as_mut() {
            while let Ok(Some(frame)) = session.try_recv() {
                if let Some(line) = stream_line(&frame, &panel.line_field) {
                    self.stream_lines.push(line);
                    appended += 1;
                }
            }
        }
        let max = if panel.max_lines == 0 {
            STREAM_DEFAULT_MAX_LINES
        } else {
            panel.max_lines as usize
        };
        if self.stream_lines.len() > max {
            let dropped = self.stream_lines.len() - max;
            self.stream_lines.drain(..dropped);
            self.stream_scroll = self.stream_scroll.saturating_sub(dropped);
            if self.stream_follow {
                self.stream_scroll = self.stream_lines.len();
            }
        }
        if appended > 0 && self.stream_follow {
            self.stream_scroll = self
                .stream_lines
                .len()
                .saturating_sub(self.stream_view_height);
        }
    }

    /// Scroll the stream viewport. Moving up detaches from follow mode; moving
    /// back to the tail re-enables it.
    pub fn scroll_stream(&mut self, delta: isize) {
        let max = self.stream_lines.len();
        self.stream_scroll = if delta < 0 {
            self.stream_scroll.saturating_sub(delta.unsigned_abs())
        } else {
            self.stream_scroll.saturating_add(delta as usize).min(max)
        };
        self.stream_follow = if delta < 0 {
            false
        } else {
            self.stream_auto_follow && self.stream_scroll >= max
        };
    }

    /// Current retained log lines (useful to host applications and tests).
    pub fn stream_lines(&self) -> &[String] {
        &self.stream_lines
    }

    /// Whether the viewport is currently following the newest line.
    pub fn stream_is_following(&self) -> bool {
        self.stream_follow
    }

    /// Swap the active palette (e.g. on a runtime theme/mode change).
    pub fn set_palette(&mut self, palette: Palette) {
        self.palette = palette;
    }

    /// Pin a bounded immutable ambient row for a repeated view's child panel.
    /// Reusing the same Arc preserves edits/caches; replacing/clearing it resets
    /// local state and releases live streams. Invalid rows leave prior state
    /// untouched and return an error for the host to surface.
    pub fn set_record(&mut self, record: Option<Arc<serde_json::Value>>) -> Result<(), RpcError> {
        let same = match (&self.ambient_record, &record) {
            (None, None) => true,
            (Some(old), Some(new)) => Arc::ptr_eq(old, new),
            _ => false,
        };
        if same {
            return Ok(());
        }
        if let Some(value) = record.as_deref() {
            if !value.is_object() {
                return Err(RpcError::Other("Ambient record must be an object.".into()));
            }
            RequestBudget::for_boundary(value).map_err(|_| {
                RpcError::Other("Ambient record construction limit exceeded.".into())
            })?;
        }
        self.invalidate();
        self.inline_prompt = None;
        self.stream_session = None;
        self.stream_request_key = None;
        self.stream_lines.clear();
        self.stream_error = None;
        self.stream_scroll = 0;
        self.stream_follow = true;
        self.stream_auto_follow = true;
        self.table_state = TableState::default();
        self.content_selected = 0;
        self.reveal_secret = false;
        self.ambient_record = record;
        Ok(())
    }

    /// Forces the next render to refetch the table data.
    pub fn invalidate(&mut self) {
        self.invocation_visible = false;
        self.row_actions.invalidate();
        self.invocations.cancel();
        self.form_scope = None;
        self.form_completed = None;
        self.cached = None;
        self.cached_chart = None;
        self.cached_stat = None;
        self.cached_gallery = None;
        self.cached_record = None;
        self.cached_resource_cards = None;
        self.cached_form = None;
        self.cached_lro = None;
        self.lro_run = None;
        self.lro_identity = None;
    }

    pub fn with_invocation_dispatcher(mut self, dispatcher: NativeInvocationDispatcher) -> Self {
        self.invocations.cancel();
        self.invocations = dispatcher;
        self
    }

    pub fn invocation_dispatcher(&self) -> NativeInvocationDispatcher {
        self.invocations.clone()
    }

    pub(crate) fn withdraw_invocation_controls(&mut self) {
        if self.invocation_visible {
            self.invocations.cancel();
        }
        self.invocation_visible = false;
        self.row_actions.withdraw();
    }

    pub(crate) fn set_invocation_viewport(&mut self, visible: bool) {
        self.invocation_viewport = Some(visible);
        if !visible {
            self.withdraw_invocation_controls();
        }
    }

    pub(crate) fn set_form_scope(&mut self, scope: Option<Arc<Vec<u8>>>, is_form: bool) {
        if self
            .shared_form_scope
            .as_ref()
            .is_some_and(|old| old != &scope)
            || (is_form
                && self
                    .form_scope
                    .as_ref()
                    .is_some_and(|old| Some(old) != scope.as_ref()))
        {
            self.invocations.cancel();
            self.cached_form = None;
            self.form_scope = None;
            self.form_completed = None;
        }
        if is_form {
            self.form_scope = scope.clone();
        }
        self.shared_form_scope = Some(scope);
    }

    fn current_form_scope(&self, context: &Context) -> Option<Vec<u8>> {
        // Immutable row identity is already owned and invalidated by set_record.
        // An unused ambient selection must not shadow that local record.
        crate::invocation::context_key(
            NativeInvocationContext::new(context).with_record(
                self.ambient_record
                    .as_ref()
                    .map(|_| &serde_json::Value::Null),
            ),
        )
        .ok()
    }

    fn form_scope_current(&self, context: &Context) -> bool {
        self.current_form_scope(context)
            .as_ref()
            .is_some_and(|current| self.form_scope.as_deref() == Some(current))
    }

    fn prepare_prompt(&mut self, descriptor: &PanelDescriptor) {
        if !self
            .inline_prompt
            .as_ref()
            .is_some_and(|state| state.matches(descriptor))
        {
            self.inline_prompt = InlinePrompt::new(descriptor);
        }
    }

    /// Collect a local prompt response or preview in the host's existing event
    /// loop. Never enters raw mode, invokes a model, or performs a mutation.
    /// The host owns any action taken with the canonical protobuf values.
    pub fn handle_prompt_key(
        &mut self,
        descriptor: &PanelDescriptor,
        key: KeyEvent,
    ) -> Option<PanelPromptResponse> {
        self.prepare_prompt(descriptor);
        self.inline_prompt.as_mut()?.handle_key(key)
    }

    pub fn select_next(&mut self) {
        self.invocations.cancel();
        self.row_actions.selection_changed();
        if let Some(cached) = self.current_table() {
            let n = cached.rows.len();
            if n == 0 {
                return;
            }
            let i = self
                .table_state
                .selected()
                .map(|i| (i + 1) % n)
                .unwrap_or(0);
            self.table_state.select(Some(i));
        } else if self.content_len > 0 {
            // Content shapes and populated resource cards share the terminal
            // cursor; `content_len` is set by the active descriptor.
            self.content_selected = (self.content_selected + 1) % self.content_len;
        }
    }

    pub fn select_prev(&mut self) {
        self.invocations.cancel();
        self.row_actions.selection_changed();
        if let Some(cached) = self.current_table() {
            let n = cached.rows.len();
            if n == 0 {
                return;
            }
            let i = self
                .table_state
                .selected()
                .map(|i| if i == 0 { n - 1 } else { i - 1 })
                .unwrap_or(0);
            self.table_state.select(Some(i));
        } else if self.content_len > 0 {
            self.content_selected =
                (self.content_selected + self.content_len - 1) % self.content_len;
        }
    }

    /// The active option/target index for the current content shape (for hosts
    /// that want to resolve the selection to a `ConnectTarget` / `ChoiceOption`).
    pub fn content_selection(&self) -> usize {
        self.content_selected
    }

    /// Toggle reveal of a masked CopyValue secret (bind to e.g. the `r` key).
    pub fn toggle_reveal(&mut self) {
        self.reveal_secret = !self.reveal_secret;
    }

    /// The affordance the host should invoke (open the URI / run the command) for
    /// the current selection on a Catalog / Action / ConnectFlow panel — the
    /// invocation seam the host wires to Enter, like table RowActions. Returns
    /// None for shapes with no invocable affordance at the cursor.
    pub fn selected_affordance<'d>(
        &self,
        descriptor: &'d PanelDescriptor,
    ) -> Option<&'d meridian_uiview::proto::Affordance> {
        descriptor
            .body
            .as_ref()
            .and_then(|b| content::selected_affordance(b, self.content_selected))
    }

    /// Renders the panel into `area`. Hosts pre-divide their layout
    /// and pass the rect they want the panel to occupy.
    pub fn render<I: RpcInvoker>(
        &mut self,
        frame: &mut Frame,
        area: ratatui::layout::Rect,
        descriptor: &PanelDescriptor,
        context: &Context,
        invoker: &I,
    ) {
        if area.width == 0 || area.height == 0 {
            self.withdraw_invocation_controls();
            return;
        }
        self.invocation_visible = self.invocation_viewport.unwrap_or(true);
        self.prepare_prompt(descriptor);
        if !actions::begin(self, descriptor, context) {
            self.render_placeholder(
                frame,
                area,
                area,
                "Action denied: panel declaration or context limit exceeded.",
            );
            return;
        }
        if !matches!(descriptor.body, Some(Body::Form(_))) && self.form_scope.is_some() {
            self.invocations.cancel();
            self.cached_form = None;
            self.form_scope = None;
            self.form_completed = None;
        }
        let identity = match &descriptor.body {
            Some(Body::Lro(panel)) => Some((
                descriptor.encode_to_vec(),
                panel
                    .start
                    .as_ref()
                    .map(|start| {
                        // handle_lro_key supplies this panel's collected form
                        // values, not the host's form map. Track only external
                        // bindings here so edits never reset their own form.
                        RequestBuilder::build_for_boundary_with(
                            start,
                            context,
                            RequestOverrides {
                                selected_row: self.ambient_record.as_deref(),
                                form_values: Some(&serde_json::Value::Null),
                                ..Default::default()
                            },
                        )
                    })
                    .unwrap_or_else(|| Ok(serde_json::Value::Null)),
            )),
            _ => None,
        };
        if self.lro_identity.is_some() && self.lro_identity != identity {
            self.cached_lro = None;
            self.lro_run = None;
        }
        let identity_error = identity
            .as_ref()
            .is_some_and(|(_, request)| request.is_err());
        self.lro_identity = identity;
        let chunks = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(1),
        ])
        .split(area);

        // Header.
        let title = Paragraph::new(Span::styled(descriptor.title.clone(), self.palette.title()));
        frame.render_widget(title, chunks[0]);

        // Content shapes use the whole region below the header; reset the
        // content cursor length each frame (set again by Choice / ConnectFlow).
        let content_area = chunks[1].union(chunks[2]);
        self.content_len = 0;

        // Body.
        match descriptor.body.as_ref() {
            Some(Body::Table(table)) => {
                self.populate_if_needed(table, context, invoker);
                Self::render_cached_table(
                    frame,
                    table,
                    self.cached.as_ref().unwrap(),
                    &self.palette,
                    &mut self.table_state,
                    [chunks[1], chunks[2]],
                );
            }
            Some(Body::Lro(panel)) => {
                self.populate_lro_if_needed(panel);
                if identity_error {
                    self.lro_run = None;
                    if let Some(cached) = self.cached_lro.as_mut() {
                        cached.validation_error = Some(REQUEST_ERROR.into());
                    }
                }
                if self.lro_run.is_some() {
                    self.render_lro_run(frame, content_area, panel);
                    return;
                }
                let cached = self.cached_lro.as_ref().unwrap();
                self.content_len = panel.inputs.len();
                content::render_lro(
                    frame,
                    content_area,
                    panel,
                    &cached.values,
                    &self.palette,
                    self.content_selected,
                );
                cached.draw_overlay(frame, content_area, &self.palette);
            }
            Some(Body::Adhoc(adhoc)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                &format!("Adhoc panel — handler_id: {}", adhoc.handler_id),
            ),
            Some(Body::Prompt(_)) | Some(Body::LlmPrompt(_)) => {
                if let Some(state) = &self.inline_prompt {
                    state.draw(frame, content_area, &self.palette);
                }
            }
            Some(Body::Gallery(panel)) => {
                self.populate_gallery_if_needed(panel, context, invoker);
                let cached = self.cached_gallery.as_ref().unwrap();
                self.content_len = cached.cards.len();
                if let Some(error) = cached.error.as_deref() {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                } else {
                    content::render_gallery(
                        frame,
                        content_area,
                        panel,
                        &cached.cards,
                        &self.palette,
                        self.content_selected,
                    );
                }
            }
            Some(Body::Form(panel)) => {
                let scope = self
                    .shared_form_scope
                    .clone()
                    .unwrap_or_else(|| self.current_form_scope(context).map(Arc::new));
                if scope != self.form_scope {
                    self.invocations.cancel();
                    self.cached_form = None;
                    self.form_completed = None;
                }
                self.form_scope = scope;
                if self.form_scope.is_none()
                    || panel.fields.len() > 1_000
                    || panel.encoded_len() > 4 * 1024 * 1024
                {
                    self.cached_form = None;
                    self.render_placeholder(
                        frame,
                        chunks[1],
                        chunks[2],
                        "Form context or declaration limit exceeded.",
                    );
                    return;
                }
                self.populate_form_if_needed(panel, context, invoker);
                let cached = self.cached_form.as_ref().unwrap();
                if let Some(error) = cached.error.as_deref() {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                } else {
                    self.content_len = panel.fields.len();
                    content::render_form(
                        frame,
                        content_area,
                        panel,
                        &cached.values,
                        &self.palette,
                        self.content_selected,
                    );
                    cached.draw_overlay(frame, content_area, &self.palette);
                }
            }
            Some(Body::DetailHeader(panel)) => {
                self.populate_record_if_needed(panel.populate.as_ref(), context, invoker);
                let cached = self.cached_record.as_ref().unwrap();
                if let Some(error) = cached.error.as_deref() {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                } else {
                    content::render_detail_header(
                        frame,
                        content_area,
                        panel,
                        cached.record.as_deref(),
                        &self.palette,
                    );
                }
            }
            Some(Body::RecordCard(panel)) => {
                self.populate_record_if_needed(panel.populate.as_ref(), context, invoker);
                let cached = self.cached_record.as_ref().unwrap();
                if let Some(error) = cached.error.as_deref() {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                } else {
                    content::render_record_card(
                        frame,
                        content_area,
                        panel,
                        cached.record.as_deref(),
                        &self.palette,
                    );
                }
            }
            Some(Body::ResourceCards(panel)) => {
                self.populate_resource_cards_if_needed(panel, context, invoker);
                let cached = self.cached_resource_cards.as_ref().unwrap();
                self.content_len = cached.rows.len();
                self.content_selected = if cached.rows.is_empty() {
                    0
                } else {
                    self.content_selected % cached.rows.len()
                };
                content::render_resource_cards(
                    frame,
                    content_area,
                    panel,
                    &cached.rows,
                    &self.palette,
                    self.content_selected,
                    cached.error.as_deref(),
                );
            }
            // ── content shapes ────────────────────────────────────────────────
            Some(Body::Choice(panel)) => {
                self.content_len = panel.options.len();
                content::render_choice(
                    frame,
                    content_area,
                    panel,
                    &self.palette,
                    self.content_selected,
                );
            }
            Some(Body::Snippet(panel)) => {
                content::render_snippet(frame, content_area, panel, &self.palette);
            }
            Some(Body::Action(panel)) => {
                // One invocable affordance — selectable so the host can wire Enter
                // to `selected_affordance` (open URI / run command).
                self.content_len = if panel.action.is_some() { 1 } else { 0 };
                content::render_action(frame, content_area, panel, &self.palette);
            }
            Some(Body::ConnectFlow(panel)) => {
                self.content_len = panel.targets.len();
                content::render_connect_flow_at_index(
                    frame,
                    content_area,
                    panel,
                    &self.palette,
                    self.content_selected,
                    self.reveal_secret,
                );
            }
            Some(Body::CopyValue(panel)) => {
                self.content_len = 0;
                content::render_copy_value(
                    frame,
                    content_area,
                    panel,
                    &self.palette,
                    self.reveal_secret,
                );
            }
            Some(Body::Catalog(panel)) => {
                self.content_len = panel.items.len();
                content::render_catalog(
                    frame,
                    content_area,
                    panel,
                    &self.palette,
                    self.content_selected,
                );
            }
            Some(Body::Grammar(panel)) => {
                // The terminal's capability set is text + a sparkline (no
                // svg/raster), so a GrammarPanel degrades down the ladder.
                content::render_grammar(frame, content_area, panel, &self.palette);
            }
            Some(Body::Stat(panel)) => {
                if self.cached_stat.is_none() {
                    let fetched = panel.populate.as_ref().map(|call| {
                        invoke_request(call, context, invoker, self.ambient_record.as_deref())
                    });
                    self.cached_stat = Some(match fetched {
                        Some(Ok(record)) if record.is_object() => CachedRecord {
                            record: Some(Arc::new(record)),
                            error: None,
                        },
                        Some(Ok(_)) => CachedRecord {
                            record: None,
                            error: Some("Invalid metric response.".into()),
                        },
                        Some(Err(error)) => CachedRecord {
                            record: None,
                            error: Some(format!("Failed to load metric: {error}")),
                        },
                        None => CachedRecord {
                            record: None,
                            error: None,
                        },
                    });
                }
                let cached = self.cached_stat.as_ref().unwrap();
                if let Some(error) = &cached.error {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                } else if cached.record.is_some() {
                    content::render_stat_with_response(
                        frame,
                        content_area,
                        panel,
                        &self.palette,
                        cached.record.as_deref(),
                    );
                } else {
                    content::render_stat(frame, content_area, panel, &self.palette);
                }
            }
            Some(Body::Chart(panel)) => {
                self.populate_chart_if_needed(panel, context, invoker);
                let rows = self
                    .cached_chart
                    .as_ref()
                    .and_then(|cached| cached.rows.as_deref());
                let error = self
                    .cached_chart
                    .as_ref()
                    .and_then(|cached| cached.error.as_deref());
                content::render_chart(frame, content_area, panel, &self.palette, rows, error);
            }
            Some(Body::Terminal(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Terminal panels are web-specific (xterm.js) — not rendered in the TUI.",
            ),
            // Steps and Stream are full-parity text shapes. Keep their arms
            // explicit so a future upstream shape cannot silently fall through
            // to an unrelated placeholder.
            Some(Body::Steps(panel)) => {
                self.content_len = panel.steps.len();
                content::render_steps(frame, chunks[2], panel, &self.palette);
            }
            Some(Body::Stream(panel)) => {
                if let Some(error) = self.stream_error.as_deref() {
                    self.render_placeholder(frame, chunks[1], chunks[2], error);
                    return;
                }
                self.content_len = self.stream_lines.len();
                self.stream_view_height = chunks[2].height.saturating_sub(2).max(1) as usize;
                let max = self.stream_lines.len();
                if self.stream_follow {
                    self.stream_scroll = max.saturating_sub(self.stream_view_height);
                }
                self.stream_scroll = self
                    .stream_scroll
                    .min(max.saturating_sub(self.stream_view_height));
                content::render_stream_window(
                    frame,
                    chunks[2],
                    panel,
                    &self.stream_lines,
                    self.stream_scroll.min(u16::MAX as usize) as u16,
                    &self.palette,
                );
            }
            // Media is legitimately degraded here: a moving picture is not text,
            // so the terminal is outside its Accept set by construction.
            Some(Body::Media(panel)) => {
                self.content_len = 0;
                content::render_media(frame, content_area, panel, &self.palette);
            }
            // prost discards unknown oneof tags while preserving the rest of
            // the descriptor. A missing body after wire decode can therefore
            // mean either an unset body or a future arm; make the safe
            // degradation explicit instead of looking like an empty panel.
            None => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Unsupported or unset panel shape",
            ),
        }
        actions::finish(self, frame, area, descriptor);
    }

    fn populate_if_needed<I: RpcInvoker>(
        &mut self,
        table: &TablePanel,
        context: &Context,
        invoker: &I,
    ) {
        if self.cached.is_some() {
            return;
        }
        let Some(populate) = table.populate.as_ref() else {
            if let Some(record) = self.ambient_record.as_deref() {
                self.cached = Some(match render_table_bounded(record, table) {
                    Ok(rows) => CachedTable {
                        rows,
                        item_noun: table.item_noun.clone(),
                    },
                    Err(error) => CachedTable {
                        rows: vec![],
                        item_noun: format!("error: {error}"),
                    },
                });
                return;
            }
            // A table may be a descriptor-only empty state. Initialize the
            // cache so the normal table renderer can draw its columns and
            // placeholder instead of unwrapping a cache that never existed.
            self.cached = Some(CachedTable {
                rows: vec![],
                item_noun: table.item_noun.clone(),
            });
            return;
        };
        match invoke_request(populate, context, invoker, self.ambient_record.as_deref()).and_then(
            |response| {
                render_table_bounded(&response, table)
                    .map_err(|_| RpcError::Other("Render construction limit exceeded.".into()))
            },
        ) {
            Ok(rows) => {
                self.cached = Some(CachedTable {
                    rows,
                    item_noun: table.item_noun.clone(),
                });
            }
            Err(e) => {
                // Surface the error via an empty cached set; meta
                // line picks it up.
                self.cached = Some(CachedTable {
                    rows: vec![],
                    item_noun: format!("error: {}", e),
                });
            }
        }
    }

    fn populate_chart_if_needed<I: RpcInvoker>(
        &mut self,
        panel: &ChartPanel,
        context: &Context,
        invoker: &I,
    ) {
        if self.cached_chart.is_some() {
            return;
        }
        let Some(chart) = panel.chart.as_ref() else {
            self.cached_chart = Some(CachedChart {
                rows: None,
                error: None,
            });
            return;
        };
        let Some(populate) = chart.populate.as_ref() else {
            self.cached_chart = Some(CachedChart {
                rows: None,
                error: None,
            });
            return;
        };
        let cached =
            match invoke_request(populate, context, invoker, self.ambient_record.as_deref()) {
                Ok(response) => {
                    let x = chart
                        .x
                        .as_ref()
                        .map(|encoding| encoding.field_name.as_str())
                        .unwrap_or("category");
                    let y = chart
                        .y
                        .as_ref()
                        .map(|encoding| encoding.field_name.as_str())
                        .unwrap_or("value");
                    CachedChart {
                        rows: Some(content::chart_rows(&response, &chart.rows_field, x, y)),
                        error: None,
                    }
                }
                Err(error) => CachedChart {
                    rows: None,
                    error: Some(format!("Failed to load chart: {error}")),
                },
            };
        self.cached_chart = Some(cached);
    }

    fn populate_resource_cards_if_needed<I: RpcInvoker>(
        &mut self,
        panel: &ResourceCardPanel,
        context: &Context,
        invoker: &I,
    ) {
        if self.cached_resource_cards.is_some() {
            return;
        }
        let Some(populate) = panel.populate.as_ref() else {
            self.cached_resource_cards = Some(CachedResourceCards {
                rows: vec![],
                error: Some("Resource-card panel has no populate RPC.".into()),
            });
            return;
        };
        match invoke_request(populate, context, invoker, self.ambient_record.as_deref()).and_then(
            |response| {
                meridian_uiview::render_resource_cards_bounded(&response, panel)
                    .map_err(|_| RpcError::Other("Render construction limit exceeded.".into()))
            },
        ) {
            Ok(rows) => {
                self.cached_resource_cards = Some(CachedResourceCards { rows, error: None });
            }
            Err(error) => {
                self.cached_resource_cards = Some(CachedResourceCards {
                    rows: vec![],
                    error: Some(format!("Failed to load resources: {error}")),
                });
            }
        }
    }

    fn populate_gallery_if_needed<I: RpcInvoker>(
        &mut self,
        panel: &GalleryPanel,
        context: &Context,
        invoker: &I,
    ) {
        if self.cached_gallery.is_some() {
            return;
        }
        let Some(populate) = panel.populate.as_ref() else {
            self.cached_gallery = Some(CachedGallery {
                cards: vec![],
                error: Some("Gallery panel has no populate RPC.".into()),
            });
            return;
        };
        match invoke_request(populate, context, invoker, self.ambient_record.as_deref()).and_then(
            |response| {
                render_gallery_bounded(&response, panel)
                    .map_err(|_| RpcError::Other("Render construction limit exceeded.".into()))
            },
        ) {
            Ok(cards) => {
                self.cached_gallery = Some(CachedGallery { cards, error: None });
            }
            Err(error) => {
                self.cached_gallery = Some(CachedGallery {
                    cards: vec![],
                    error: Some(format!("Failed to load gallery: {error}")),
                });
            }
        }
    }

    fn populate_record_if_needed<I: RpcInvoker>(
        &mut self,
        populate: Option<&meridian_uiview::proto::RpcCall>,
        context: &Context,
        invoker: &I,
    ) {
        if self.cached_record.is_some() {
            return;
        }
        let Some(populate) = populate else {
            self.cached_record = Some(CachedRecord {
                record: self.ambient_record.clone(),
                error: None,
            });
            return;
        };
        match invoke_request(populate, context, invoker, self.ambient_record.as_deref()) {
            Ok(record) => {
                self.cached_record = Some(CachedRecord {
                    record: Some(Arc::new(record)),
                    error: None,
                });
            }
            Err(error) => {
                self.cached_record = Some(CachedRecord {
                    record: None,
                    error: Some(format!("Failed to load record: {error}")),
                });
            }
        }
    }

    fn populate_form_if_needed<I: RpcInvoker>(
        &mut self,
        panel: &FormPanel,
        context: &Context,
        invoker: &I,
    ) {
        let descriptor = panel.encode_to_vec();
        if self
            .cached_form
            .as_ref()
            .is_some_and(|cached| cached.descriptor == descriptor)
        {
            return;
        }
        if self.cached_form.is_some() {
            self.invocations.cancel();
        }
        self.form_completed = None;
        let mut values = match crate::prompt::input_defaults(&panel.fields) {
            Ok(values) => values,
            Err(error) => {
                self.cached_form = Some(CachedForm {
                    revision: 0,
                    descriptor,
                    values: serde_json::json!({}),
                    error: Some(error),
                    validation_error: None,
                    editor: None,
                });
                return;
            }
        };
        if let Some(record) = self.ambient_record.as_deref() {
            if merge_form_values(&mut values, record).is_err() {
                self.cached_form = Some(CachedForm {
                    revision: 0,
                    descriptor,
                    values,
                    error: Some(REQUEST_ERROR.into()),
                    validation_error: None,
                    editor: None,
                });
                return;
            }
        }
        if panel.mode == FormMode::Edit as i32 {
            if let Some(prefill) = panel.prefill.as_ref() {
                match invoke_request(prefill, context, invoker, self.ambient_record.as_deref()) {
                    Ok(prefill_values) if prefill_values.is_object() => {
                        if merge_form_values(&mut values, &prefill_values).is_err() {
                            self.cached_form = Some(CachedForm {
                                revision: 0,
                                descriptor,
                                values,
                                error: Some(REQUEST_ERROR.into()),
                                validation_error: None,
                                editor: None,
                            });
                            return;
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        self.cached_form = Some(CachedForm {
                            revision: 0,
                            descriptor,
                            values,
                            error: Some(format!("Failed to prefill form: {error}")),
                            validation_error: None,
                            editor: None,
                        });
                        return;
                    }
                }
            }
        }
        self.cached_form = Some(CachedForm {
            revision: 0,
            descriptor,
            values,
            error: None,
            validation_error: None,
            editor: None,
        });
    }

    /// Handle keyboard input for an inline FormPanel. Hosts may call this
    /// after `render`; ordinary panel selection remains available through
    /// `select_next` / `select_prev` for non-form shapes.
    pub fn handle_form_key(
        &mut self,
        panel: &FormPanel,
        context: &Context,
        key: KeyCode,
    ) -> Option<FormSubmission> {
        if key == KeyCode::Enter && !self.form_scope_current(context) {
            self.invocations.cancel();
            if let Some(cached) = &mut self.cached_form {
                cached.validation_error =
                    Some("Form context changed; redraw before retrying.".into());
            }
            return None;
        }
        let cached = self.cached_form.as_mut()?;
        if cached.descriptor != panel.encode_to_vec() {
            return None;
        }
        if panel.mode != FormMode::Edit as i32 || cached.error.is_some() {
            return None;
        }
        let selected = self
            .content_selected
            .min(panel.fields.len().saturating_sub(1));
        if cached.compound_key(&panel.fields, selected, key) {
            return None;
        }
        let selected_field = panel.fields.get(selected);
        let boolean_edit = selected_field.is_some_and(|field| {
            matches!(field.kind.as_ref(), Some(Kind::Boolean(_)))
                && matches!(key, KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right)
        });
        match key {
            KeyCode::Down | KeyCode::Tab if !panel.fields.is_empty() => {
                self.content_selected = (selected + 1) % panel.fields.len();
            }
            KeyCode::Up | KeyCode::BackTab if !panel.fields.is_empty() => {
                self.content_selected = (selected + panel.fields.len() - 1) % panel.fields.len();
            }
            KeyCode::Enter if panel.mode == FormMode::Edit as i32 => {
                if !cached.validate(&panel.fields) {
                    return None;
                }
                // Without an explicit invocation host, submission is denied.
                // The admitted path below owns validation, consent, and effects.
                cached.validation_error = Some(NativeInvocationOutcome::Denied.message().into());
                return None;
            }
            code if boolean_edit
                || !matches!(
                    code,
                    KeyCode::Up | KeyCode::Down | KeyCode::Tab | KeyCode::BackTab
                ) =>
            {
                if let Some(field) = selected_field {
                    if edit_form_field(field, &mut cached.values, code) {
                        cached.revision = cached.revision.saturating_add(1);
                        cached.validation_error = None;
                    }
                }
            }
            _ => {}
        }
        None
    }

    /// Native form events validate collected values before admission. Effects use
    /// the shared dispatcher and real form assembler, never a raw request handoff.
    pub fn handle_form_key_with_invocation(
        &mut self,
        panel: &FormPanel,
        context: &Context,
        key: KeyEvent,
        host: &NativeInvocationHost<'_>,
    ) -> Option<NativeInvocationOutcome> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if !self.invocation_visible || !self.form_scope_current(context) {
            self.invocations.cancel();
            if let Some(cached) = &mut self.cached_form {
                cached.validation_error =
                    Some("Form context changed; redraw before retrying.".into());
            }
            return None;
        }
        if key.code != KeyCode::Enter
            || self
                .cached_form
                .as_ref()
                .is_some_and(|c| c.editor.is_some())
        {
            self.invocations.cancel();
            self.handle_form_key(panel, context, key.code);
            return None;
        }
        let cached = self.cached_form.as_mut()?;
        if cached.descriptor != panel.encode_to_vec() || panel.mode != FormMode::Edit as i32 {
            return None;
        }
        if self.form_completed == Some(cached.revision) {
            return None;
        }
        if !cached.validate(&panel.fields) {
            return None;
        }
        let outcome = self.invocations.invoke(
            NativeAction::Form(panel, &cached.values),
            NativeInvocationContext::new(context).with_record(self.ambient_record.as_deref()),
            host,
        );
        cached.validation_error = Some(outcome.message().into());
        if matches!(
            outcome,
            NativeInvocationOutcome::Succeeded | NativeInvocationOutcome::RefreshFailed
        ) {
            self.form_completed = Some(cached.revision);
        }
        Some(outcome)
    }

    fn populate_lro_if_needed(&mut self, panel: &LroPanel) {
        let descriptor = panel.encode_to_vec();
        if self
            .cached_lro
            .as_ref()
            .is_none_or(|cached| cached.descriptor != descriptor)
        {
            if self.cached_lro.is_some() {
                self.lro_identity = None;
            }
            self.lro_run = None;
            let (values, error) = match crate::prompt::input_defaults(&panel.inputs) {
                Ok(values) => (values, None),
                Err(error) => (serde_json::json!({}), Some(error)),
            };
            self.cached_lro = Some(CachedForm {
                revision: 0,
                descriptor,
                values,
                error,
                validation_error: None,
                editor: None,
            });
        }
    }

    /// Handle keyboard input for an LroPanel's input/run surface. The returned
    /// start request is intentionally separate from `RpcInvoker`: hosts must
    /// choose their long-running-operation client and polling policy.
    pub fn handle_lro_key(
        &mut self,
        panel: &LroPanel,
        context: &Context,
        key: KeyCode,
    ) -> Option<LroSubmission> {
        self.populate_lro_if_needed(panel);
        if let Some(run) = &self.lro_run {
            if run.active() {
                return None;
            }
            match key {
                KeyCode::Esc => {
                    self.lro_run = None;
                    return None;
                }
                KeyCode::Enter => {}
                _ => return None,
            }
        }
        let cached = self.cached_lro.as_mut()?;
        let field_count = panel.inputs.len();
        let selected = self.content_selected.min(field_count.saturating_sub(1));
        if cached.compound_key(&panel.inputs, selected, key) {
            return None;
        }
        match key {
            KeyCode::Down | KeyCode::Tab if field_count > 0 => {
                self.content_selected = (selected + 1) % field_count;
            }
            KeyCode::Up | KeyCode::BackTab if field_count > 0 => {
                self.content_selected = (selected + field_count - 1) % field_count;
            }
            KeyCode::Enter => {
                if !cached.validate(&panel.inputs) {
                    return None;
                }
                let start = panel.start.as_ref()?;
                let request = match form_request(
                    start,
                    context,
                    &panel.inputs,
                    &cached.values,
                    SubmissionKind::Lro,
                    self.ambient_record.as_deref(),
                ) {
                    Ok(request) => request,
                    Err(_) => {
                        cached.validation_error = Some(REQUEST_ERROR.into());
                        return None;
                    }
                };
                let run = LroRun::new(panel);
                let run_id = run.id.clone();
                self.lro_run = Some(run);
                self.table_state = TableState::default();
                return Some(LroSubmission {
                    run_id,
                    service: start.service.clone(),
                    method: start.method.clone(),
                    request,
                });
            }
            code if field_count > 0 => {
                if let Some(field) = panel.inputs.get(selected) {
                    edit_form_field(field, &mut cached.values, code);
                }
            }
            _ => {}
        }
        None
    }

    /// Supply decoded operation metadata after the host starts/polls an LRO.
    /// Stale/terminal tokens, changed operation names, and invalid or oversized
    /// metadata are rejected without altering the last accepted state.
    pub fn update_lro_progress(
        &mut self,
        run_id: &LroRunId,
        operation_name: &str,
        metadata: &prost_types::Struct,
    ) -> bool {
        self.lro_run
            .as_mut()
            .is_some_and(|run| run.progress(run_id, operation_name, metadata))
    }

    /// Supply the final decoded response AFTER any host-owned finalize RPC.
    /// Renders the descriptor's result table locally, never its populate RPC.
    pub fn complete_lro(&mut self, run_id: &LroRunId, result: &prost_types::Struct) -> bool {
        self.lro_run
            .as_mut()
            .is_some_and(|run| run.complete(run_id, result))
    }

    /// Surface a start, poll, operation, or finalize failure. Enter may retry.
    pub fn fail_lro(&mut self, run_id: &LroRunId, error: &str) -> bool {
        self.lro_run
            .as_mut()
            .is_some_and(|run| run.fail(run_id, error))
    }

    /// Mark the host's confirmed/local cancellation. Does not send a server
    /// cancellation request; that decision and transport remain host-owned.
    pub fn cancel_lro(&mut self, run_id: &LroRunId) -> bool {
        self.lro_run.as_mut().is_some_and(|run| run.cancel(run_id))
    }

    fn current_table(&self) -> Option<&CachedTable> {
        if self.lro_run.is_some() || self.lro_identity.is_some() {
            self.lro_run.as_ref().and_then(|run| run.result.as_ref())
        } else {
            self.cached.as_ref()
        }
    }

    fn render_lro_run(&mut self, frame: &mut Frame, area: ratatui::layout::Rect, panel: &LroPanel) {
        let run = self.lro_run.as_ref().unwrap();
        let status = run.status();
        if let (Some(table), Some(result)) = (&panel.result, &run.result) {
            if self.table_state.selected().is_none() && !result.rows.is_empty() {
                self.table_state.select(Some(0));
            }
            let chunks = Layout::vertical([
                Constraint::Length(status.lines().count().clamp(1, 3) as u16),
                Constraint::Length(1),
                Constraint::Min(1),
            ])
            .split(area);
            frame.render_widget(Paragraph::new(status).style(self.palette.meta()), chunks[0]);
            Self::render_cached_table(
                frame,
                table,
                result,
                &self.palette,
                &mut self.table_state,
                [chunks[1], chunks[2]],
            );
        } else {
            frame.render_widget(
                Paragraph::new(status)
                    .style(self.palette.meta())
                    .wrap(ratatui::widgets::Wrap { trim: false })
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(self.palette.border_style()),
                    ),
                area,
            );
        }
    }

    fn render_cached_table(
        frame: &mut Frame,
        table_panel: &TablePanel,
        cached: &CachedTable,
        palette: &Palette,
        table_state: &mut TableState,
        [meta_area, body_area]: [ratatui::layout::Rect; 2],
    ) {
        if render_table_bounded(&serde_json::Value::Null, table_panel).is_err() {
            frame.render_widget(
                Paragraph::new("Render construction limit exceeded."),
                meta_area,
            );
            return;
        }
        let meta = Paragraph::new(Span::styled(
            format!("{} {}", cached.rows.len(), cached.item_noun),
            palette.meta(),
        ));
        frame.render_widget(meta, meta_area);

        let header = Row::new(
            table_panel
                .columns
                .iter()
                .map(|col| Cell::from(col.header.clone()))
                .collect::<Vec<_>>(),
        )
        .height(
            table_panel
                .columns
                .iter()
                .map(|col| col.header.lines().count())
                .max()
                .unwrap_or(1)
                .clamp(1, u16::MAX as usize) as u16,
        )
        .style(palette.header());

        let rows: Vec<Row> = cached
            .rows
            .iter()
            .map(|r| {
                Row::new(
                    r.cells
                        .iter()
                        .zip(&table_panel.columns)
                        .map(|(c, column)| {
                            Cell::from(content::decorate_value_link(
                                c.clone(),
                                meridian_uiview::ProtoPaths::get(&r.raw, &column.field_path),
                                column.value_display.as_ref(),
                            ))
                        })
                        .collect::<Vec<_>>(),
                )
                .height(
                    r.cells
                        .iter()
                        .map(|cell| cell.lines().count())
                        .max()
                        .unwrap_or(1)
                        .clamp(1, u16::MAX as usize) as u16,
                )
            })
            .collect();

        let constraints: Vec<Constraint> = table_panel
            .columns
            .iter()
            .map(|col| {
                if col.pref_width > 0 {
                    Constraint::Length(col.pref_width as u16)
                } else {
                    Constraint::Min(10)
                }
            })
            .collect();

        let widget = Table::new(rows, constraints)
            .style(palette.text())
            .header(header)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(palette.border_style()),
            )
            .row_highlight_style(palette.selection());

        frame.render_stateful_widget(widget, body_area, table_state);
    }

    fn render_placeholder(
        &self,
        frame: &mut Frame,
        meta_area: ratatui::layout::Rect,
        body_area: ratatui::layout::Rect,
        text: &str,
    ) {
        let meta = Paragraph::new(Line::from(""));
        frame.render_widget(meta, meta_area);
        let body = Paragraph::new(Span::styled(text, self.palette.meta())).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(self.palette.border_style()),
        );
        frame.render_widget(body, body_area);
    }

    /// Build an action request from this panel's current raw row and host context.
    /// Returns `None` when the panel has no selected row, even if the host context
    /// contains an older selection. Declared bindings use the core request builder.
    /// For unbound calls, opt into the legacy `{ "id": row.id }` request with
    /// `legacy_id_fallback`; otherwise the request is empty. Missing/null IDs are
    /// omitted. Neither the row nor the supplied context is modified.
    ///
    /// The host still owns action eligibility, admission, invocation, and refresh.
    pub fn selected_row_request(
        &self,
        call: &RpcCall,
        context: &Context,
        legacy_id_fallback: bool,
    ) -> Option<serde_json::Value> {
        self.try_selected_row_request(call, context, legacy_id_fallback)
            .ok()
            .flatten()
    }

    /// Fallible host seam: use this variant to surface rejected request limits
    /// rather than treating them like absence of a selected row.
    pub fn try_selected_row_request(
        &self,
        call: &RpcCall,
        context: &Context,
        legacy_id_fallback: bool,
    ) -> Result<Option<serde_json::Value>, RpcError> {
        let Some(row) = self.selected_row() else {
            return Ok(None);
        };
        if call.bindings.is_empty() && legacy_id_fallback {
            // The compatibility fallback still crosses a descriptor boundary.
            if call.encoded_len() > 64 * 1024 {
                return Err(RpcError::Other(REQUEST_ERROR.into()));
            }
            let mut request = serde_json::json!({});
            if let Some(id) = row.get("id").filter(|id| !id.is_null()) {
                let mut budget = RequestBudget::for_boundary(&request)
                    .map_err(|_| RpcError::Other(REQUEST_ERROR.into()))?;
                budget
                    .assign(&mut request, "id", id)
                    .map_err(|_| RpcError::Other(REQUEST_ERROR.into()))?;
            }
            return Ok(Some(request));
        }
        RequestBuilder::build_for_boundary_with(
            call,
            context,
            RequestOverrides {
                selected_row: Some(row),
                ..Default::default()
            },
        )
        .map(Some)
        .map_err(|_| RpcError::Other(REQUEST_ERROR.into()))
    }

    /// Convenience: returns the currently-selected row's raw JSON,
    /// for hosts that want to fire RowActions.
    pub fn selected_row(&self) -> Option<&serde_json::Value> {
        if let Some(cached) = self.current_table() {
            let index = self.table_state.selected()?;
            return cached.rows.get(index).map(|r| &r.raw);
        }
        if self.lro_run.is_some() || self.lro_identity.is_some() {
            return None;
        }
        self.cached_resource_cards
            .as_ref()
            .and_then(|cached| cached.rows.get(self.content_selected))
            .or_else(|| {
                self.cached_gallery
                    .as_ref()
                    .and_then(|cached| cached.cards.get(self.content_selected))
                    .map(|card| &card.raw)
            })
    }
}

fn stream_line(frame: &StreamFrame, line_field: &str) -> Option<String> {
    let value = meridian_uiview::stream_frame_data(frame)?;
    let selected = meridian_uiview::ProtoPaths::get(&value, line_field);
    if selected.is_null() {
        return None;
    }
    match selected {
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn merge_form_values(
    destination: &mut serde_json::Value,
    source: &serde_json::Value,
) -> Result<(), meridian_uiview::RequestLimitExceeded> {
    let mut budget = RequestBudget::for_boundary(destination)?;
    budget.admit_copy(source)?;
    merge_form_values_admitted(destination, source);
    Ok(())
}

fn merge_form_values_admitted(destination: &mut serde_json::Value, source: &serde_json::Value) {
    match (destination, source) {
        (serde_json::Value::Object(dst), serde_json::Value::Object(src)) => {
            for (key, value) in src {
                match dst.get_mut(key) {
                    Some(existing) => merge_form_values_admitted(existing, value),
                    None => {
                        dst.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (destination, source) => *destination = source.clone(),
    }
}

fn form_request(
    call: &RpcCall,
    context: &Context,
    fields: &[FormField],
    values: &serde_json::Value,
    kind: SubmissionKind,
    record: Option<&serde_json::Value>,
) -> Result<serde_json::Value, RpcError> {
    RequestBuilder::build_submission_with_row(call, context, fields, values, kind, record)
        .map_err(|_| RpcError::Other(REQUEST_ERROR.into()))
}

fn edit_form_field(field: &FormField, values: &mut serde_json::Value, key: KeyCode) -> bool {
    let Some(current) = values
        .as_object_mut()
        .and_then(|object| object.get_mut(&field.field_id))
    else {
        return false;
    };
    let next = match field.kind.as_ref() {
        Some(Kind::Text(_)) | Some(Kind::Masked(_)) => {
            let Some(text) = current.as_str() else {
                return false;
            };
            match key {
                KeyCode::Char(c) => serde_json::Value::String(format!("{text}{c}")),
                KeyCode::Backspace => {
                    let mut text = text.to_string();
                    text.pop();
                    serde_json::Value::String(text)
                }
                _ => return false,
            }
        }
        Some(Kind::Integer(input)) => {
            let step = if input.step == 0 { 1 } else { input.step } as i64;
            let mut number = current.as_i64().unwrap_or(input.default_value as i64);
            match key {
                KeyCode::Up | KeyCode::Right => number = number.saturating_add(step),
                KeyCode::Down | KeyCode::Left => number = number.saturating_sub(step),
                _ => return false,
            }
            if input.max != 0 {
                number = number.min(input.max as i64);
            }
            if input.min != 0 {
                number = number.max(input.min as i64);
            }
            serde_json::Value::from(number)
        }
        Some(Kind::Number(input)) => {
            let step = if input.step == 0.0 { 1.0 } else { input.step };
            let mut number = current.as_f64().unwrap_or(input.default_value);
            match key {
                KeyCode::Up | KeyCode::Right => number += step,
                KeyCode::Down | KeyCode::Left => number -= step,
                _ => return false,
            }
            if input.max != 0.0 {
                number = number.min(input.max);
            }
            if input.min != 0.0 {
                number = number.max(input.min);
            }
            serde_json::Value::from(number)
        }
        Some(Kind::Boolean(_))
            if matches!(key, KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right) =>
        {
            serde_json::Value::Bool(!current.as_bool().unwrap_or(false))
        }
        Some(Kind::EnumSelection(input)) => {
            let options: Vec<&str> = if !input.options.is_empty() {
                input
                    .options
                    .iter()
                    .map(|option| option.value.as_str())
                    .collect()
            } else {
                input.allowed_values.iter().map(String::as_str).collect()
            };
            if options.is_empty() {
                return false;
            }
            let current_index = options
                .iter()
                .position(|option| Some(*option) == current.as_str())
                .unwrap_or(0);
            let next = match key {
                KeyCode::Up | KeyCode::Left => (current_index + options.len() - 1) % options.len(),
                KeyCode::Down | KeyCode::Right => (current_index + 1) % options.len(),
                _ => return false,
            };
            serde_json::Value::String(options[next].to_owned())
        }
        _ => return false,
    };
    if *current == next {
        return false;
    }
    *current = next;
    true
}

impl Drop for PanelView {
    fn drop(&mut self) {
        self.invocations.cancel();
    }
}

impl Default for PanelView {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod enum_tests {
    use super::*;
    use meridian_uiview::proto::{EnumOption, EnumSelection};

    #[test]
    fn inline_enum_cycles_authored_tokens_instead_of_labels_or_legacy_values() {
        let field = FormField {
            field_id: "state".into(),
            kind: Some(Kind::EnumSelection(EnumSelection {
                allowed_values: vec!["legacy".into()],
                options: vec![
                    EnumOption {
                        value: "a".into(),
                        label: "Alpha".into(),
                        ..Default::default()
                    },
                    EnumOption {
                        value: "b".into(),
                        label: "Beta".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut values = crate::content::form_defaults(std::slice::from_ref(&field));
        assert_eq!(values["state"], "a");
        edit_form_field(&field, &mut values, KeyCode::Right);
        assert_eq!(values["state"], "b");
        edit_form_field(&field, &mut values, KeyCode::Right);
        assert_eq!(values["state"], "a");
    }
}
