use crossterm::event::KeyCode;
use meridian_uiview::proto::panel_descriptor::Body;
use meridian_uiview::proto::{
    form_field::Kind, ChartPanel, FormField, FormMode, FormPanel, GalleryPanel, LroPanel,
    PanelDescriptor, ResourceCardPanel, RpcCall, StreamFrame, TablePanel,
};
use meridian_uiview::{
    render_gallery, render_table, Context, RenderedCard, RenderedRow, RequestBuilder,
};
use ratatui::layout::{Constraint, Layout};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::content;
use crate::invoker::{RpcInvoker, StreamInvoker, StreamSession};
use crate::theme::Palette;

// Keep an unspecified StreamPanel bounded just like the browser renderer. The
// schema deliberately leaves the exact default to each surface, but it also
// requires every renderer to prevent an unbounded stream from growing forever.
const STREAM_DEFAULT_MAX_LINES: usize = 2_000;

/// Stateful ratatui widget rendering one PanelDescriptor. For
/// TablePanels it does its own populate call against the invoker
/// (lazy + cached); for LroPanels it shows a placeholder telling
/// the operator to wire the LRO driver; for AdhocPanels it surfaces
/// the handler_id so the host knows which custom view to swap in.
///
/// All look comes from `palette` (derived from a `meridian.theme.v1.Theme`):
/// no `Color::` / `Style::` literal lives in this file. Hosts that load a skin
/// build a `Palette::from_theme(...)` and pass it via `with_palette`; the
/// default is meridian's neutral dark palette so an un-themed run still reads.
pub struct PanelView {
    cached: Option<CachedTable>,
    cached_chart: Option<CachedChart>,
    cached_gallery: Option<CachedGallery>,
    cached_record: Option<CachedRecord>,
    cached_resource_cards: Option<CachedResourceCards>,
    cached_form: Option<CachedForm>,
    cached_lro: Option<CachedForm>,
    stream_lines: Vec<String>,
    stream_session: Option<StreamSession>,
    stream_request_key: Option<String>,
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

struct CachedTable {
    rows: Vec<RenderedRow>,
    item_noun: String,
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
    record: Option<serde_json::Value>,
    error: Option<String>,
}

struct CachedResourceCards {
    rows: Vec<serde_json::Value>,
    error: Option<String>,
}

struct CachedForm {
    values: serde_json::Value,
    error: Option<String>,
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
    pub service: String,
    pub method: String,
    pub request: serde_json::Value,
}

impl PanelView {
    pub fn new() -> Self {
        Self {
            cached: None,
            cached_chart: None,
            cached_gallery: None,
            cached_record: None,
            cached_resource_cards: None,
            cached_form: None,
            cached_lro: None,
            stream_lines: Vec::new(),
            stream_session: None,
            stream_request_key: None,
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
            cached: None,
            cached_chart: None,
            cached_gallery: None,
            cached_record: None,
            cached_resource_cards: None,
            cached_form: None,
            cached_lro: None,
            stream_lines: Vec::new(),
            stream_session: None,
            stream_request_key: None,
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
            self.stream_lines.clear();
            return;
        };
        let request = panel
            .subscribe
            .as_ref()
            .map(|call| RequestBuilder::build(call, context))
            .unwrap_or_else(|| serde_json::json!({}));
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

    /// Forces the next render to refetch the table data.
    pub fn invalidate(&mut self) {
        self.cached = None;
        self.cached_chart = None;
        self.cached_gallery = None;
        self.cached_record = None;
        self.cached_resource_cards = None;
        self.cached_form = None;
        self.cached_lro = None;
    }

    pub fn select_next(&mut self) {
        if let Some(cached) = &self.cached {
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
        if let Some(cached) = &self.cached {
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
                self.render_table(frame, table, chunks[1], chunks[2]);
            }
            Some(Body::Lro(panel)) => {
                self.populate_lro_if_needed(panel);
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
            }
            Some(Body::Adhoc(adhoc)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                &format!("Adhoc panel — handler_id: {}", adhoc.handler_id),
            ),
            Some(Body::Prompt(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Prompt panels: drive via the standalone prompt renderer (meridian::prompt — not via PanelView).",
            ),
            Some(Body::LlmPrompt(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "LLM-prompt panels: drive via the standalone renderer (meridian_tui::render_llm_prompt — one-shot, like the PromptPanel renderer).",
            ),
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
                        cached.record.as_ref(),
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
                        cached.record.as_ref(),
                        &self.palette,
                    );
                }
            }
            Some(Body::ResourceCards(panel)) => {
                self.populate_resource_cards_if_needed(panel, context, invoker);
                let cached = self.cached_resource_cards.as_ref().unwrap();
                self.content_len = cached.rows.len();
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
                content::render_choice(frame, content_area, panel, &self.palette, self.content_selected);
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
                content::render_connect_flow(
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
                content::render_copy_value(frame, content_area, panel, &self.palette, self.reveal_secret);
            }
            Some(Body::Catalog(panel)) => {
                self.content_len = panel.items.len();
                content::render_catalog(frame, content_area, panel, &self.palette, self.content_selected);
            }
            Some(Body::Grammar(panel)) => {
                // The terminal's capability set is text + a sparkline (no
                // svg/raster), so a GrammarPanel degrades down the ladder.
                content::render_grammar(frame, content_area, panel, &self.palette);
            }
            Some(Body::Stat(panel)) => {
                content::render_stat(frame, content_area, panel, &self.palette);
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
                self.content_len = self.stream_lines.len();
                self.stream_view_height = chunks[2].height.saturating_sub(2).max(1) as usize;
                let max = self.stream_lines.len();
                if self.stream_follow {
                    self.stream_scroll = max.saturating_sub(self.stream_view_height);
                }
                self.stream_scroll = self.stream_scroll.min(max.saturating_sub(self.stream_view_height));
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
            // A table may be a descriptor-only empty state. Initialize the
            // cache so the normal table renderer can draw its columns and
            // placeholder instead of unwrapping a cache that never existed.
            self.cached = Some(CachedTable {
                rows: vec![],
                item_noun: table.item_noun.clone(),
            });
            return;
        };
        let request = RequestBuilder::build(populate, context);
        match invoker.invoke(&populate.service, &populate.method, request) {
            Ok(response) => {
                let rows = render_table(&response, table);
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
        let request = RequestBuilder::build(populate, context);
        let cached = match invoker.invoke(&populate.service, &populate.method, request) {
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
        let request = RequestBuilder::build(populate, context);
        match invoker.invoke(&populate.service, &populate.method, request) {
            Ok(response) => {
                let rows = meridian_uiview::ProtoPaths::rows(&response, &panel.rows_field)
                    .into_iter()
                    .cloned()
                    .collect();
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
        let request = RequestBuilder::build(populate, context);
        match invoker.invoke(&populate.service, &populate.method, request) {
            Ok(response) => {
                self.cached_gallery = Some(CachedGallery {
                    cards: render_gallery(&response, panel),
                    error: None,
                });
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
                record: None,
                error: None,
            });
            return;
        };
        let request = RequestBuilder::build(populate, context);
        match invoker.invoke(&populate.service, &populate.method, request) {
            Ok(record) => {
                self.cached_record = Some(CachedRecord {
                    record: Some(record),
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
        if self.cached_form.is_some() {
            return;
        }
        let mut values = content::form_defaults(&panel.fields);
        if panel.mode == FormMode::Edit as i32 {
            if let Some(prefill) = panel.prefill.as_ref() {
                let request = RequestBuilder::build(prefill, context);
                match invoker.invoke(&prefill.service, &prefill.method, request) {
                    Ok(prefill_values) if prefill_values.is_object() => {
                        merge_form_values(&mut values, &prefill_values);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        self.cached_form = Some(CachedForm {
                            values,
                            error: Some(format!("Failed to prefill form: {error}")),
                        });
                        return;
                    }
                }
            }
        }
        self.cached_form = Some(CachedForm {
            values,
            error: None,
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
        let cached = self.cached_form.as_mut()?;
        if panel.fields.is_empty() {
            return None;
        }
        let selected = self.content_selected.min(panel.fields.len() - 1);
        let selected_field = panel.fields.get(selected);
        let boolean_edit = selected_field.is_some_and(|field| {
            matches!(field.kind.as_ref(), Some(Kind::Boolean(_)))
                && matches!(key, KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right)
        });
        match key {
            KeyCode::Down | KeyCode::Tab => {
                self.content_selected = (selected + 1) % panel.fields.len();
            }
            KeyCode::Up | KeyCode::BackTab => {
                self.content_selected = (selected + panel.fields.len() - 1) % panel.fields.len();
            }
            KeyCode::Enter if panel.mode == FormMode::Edit as i32 => {
                let submit = panel.submit.as_ref()?;
                let mut submit_context = context.clone();
                submit_context.form_values = form_values_by_id(&panel.fields, &cached.values);
                let mut request = RequestBuilder::build(submit, &submit_context);
                merge_form_request(&mut request, &panel.fields, &cached.values);
                return Some(FormSubmission {
                    service: submit.service.clone(),
                    method: submit.method.clone(),
                    request,
                });
            }
            code if boolean_edit
                || !matches!(
                    code,
                    KeyCode::Up | KeyCode::Down | KeyCode::Tab | KeyCode::BackTab
                ) =>
            {
                if let Some(field) = selected_field {
                    edit_form_field(field, &mut cached.values, code);
                }
            }
            _ => {}
        }
        None
    }

    fn populate_lro_if_needed(&mut self, panel: &LroPanel) {
        if self.cached_lro.is_none() {
            self.cached_lro = Some(CachedForm {
                values: content::form_defaults(&panel.inputs),
                error: None,
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
        let cached = self.cached_lro.as_mut()?;
        let field_count = panel.inputs.len();
        let selected = self.content_selected.min(field_count.saturating_sub(1));
        match key {
            KeyCode::Down | KeyCode::Tab if field_count > 0 => {
                self.content_selected = (selected + 1) % field_count;
            }
            KeyCode::Up | KeyCode::BackTab if field_count > 0 => {
                self.content_selected = (selected + field_count - 1) % field_count;
            }
            KeyCode::Enter => {
                let start = panel.start.as_ref()?;
                let mut start_context = context.clone();
                start_context.form_values = form_values_by_id(&panel.inputs, &cached.values);
                let mut request = RequestBuilder::build(start, &start_context);
                merge_form_request(&mut request, &panel.inputs, &cached.values);
                return Some(LroSubmission {
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

    fn render_table(
        &mut self,
        frame: &mut Frame,
        table_panel: &TablePanel,
        meta_area: ratatui::layout::Rect,
        body_area: ratatui::layout::Rect,
    ) {
        let cached = self.cached.as_ref().unwrap();
        let meta = Paragraph::new(Span::styled(
            format!("{} {}", cached.rows.len(), cached.item_noun),
            self.palette.meta(),
        ));
        frame.render_widget(meta, meta_area);

        let header = Row::new(
            table_panel
                .columns
                .iter()
                .map(|col| Cell::from(col.header.clone()))
                .collect::<Vec<_>>(),
        )
        .style(self.palette.header());

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
            .style(self.palette.text())
            .header(header)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(self.palette.border_style()),
            )
            .row_highlight_style(self.palette.selection());

        frame.render_stateful_widget(widget, body_area, &mut self.table_state);
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
        let row = self.selected_row()?;
        if call.bindings.is_empty() && legacy_id_fallback {
            return Some(match row.get("id").filter(|id| !id.is_null()) {
                Some(id) => serde_json::json!({ "id": id }),
                None => serde_json::json!({}),
            });
        }
        let mut context = context.clone();
        context.selected_row = Some(row.clone());
        Some(RequestBuilder::build(call, &context))
    }

    /// Convenience: returns the currently-selected row's raw JSON,
    /// for hosts that want to fire RowActions.
    pub fn selected_row(&self) -> Option<&serde_json::Value> {
        if let Some(cached) = &self.cached {
            let index = self.table_state.selected()?;
            return cached.rows.get(index).map(|r| &r.raw);
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

fn merge_form_values(destination: &mut serde_json::Value, source: &serde_json::Value) {
    match (destination, source) {
        (serde_json::Value::Object(dst), serde_json::Value::Object(src)) => {
            for (key, value) in src {
                match dst.get_mut(key) {
                    Some(existing) => merge_form_values(existing, value),
                    None => {
                        dst.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (destination, source) => *destination = source.clone(),
    }
}

fn form_values_by_id(
    fields: &[FormField],
    values: &serde_json::Value,
) -> std::collections::HashMap<String, serde_json::Value> {
    fields
        .iter()
        .filter_map(|field| {
            values
                .get(&field.field_id)
                .cloned()
                .map(|value| (field.field_id.clone(), value))
        })
        .collect()
}

fn join_form_path(prefix: &str, segment: &str) -> String {
    if prefix.is_empty() {
        segment.to_string()
    } else if segment.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}.{segment}")
    }
}

fn set_json_path(root: &mut serde_json::Value, path: &str, value: serde_json::Value) {
    if path.is_empty() {
        return;
    }
    let mut current = root;
    let segments: Vec<&str> = path.split('.').collect();
    for segment in &segments[..segments.len().saturating_sub(1)] {
        if !current.is_object() {
            *current = serde_json::json!({});
        }
        current = current
            .as_object_mut()
            .expect("object created above")
            .entry((*segment).to_string())
            .or_insert_with(|| serde_json::json!({}));
    }
    if !current.is_object() {
        *current = serde_json::json!({});
    }
    current
        .as_object_mut()
        .expect("object created above")
        .insert(segments.last().unwrap().to_string(), value);
}

fn merge_form_request(
    root: &mut serde_json::Value,
    fields: &[FormField],
    values: &serde_json::Value,
) {
    for field in fields {
        let value = values
            .get(&field.field_id)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let path = if field.request_field.is_empty() {
            field.field_id.clone()
        } else {
            field.request_field.clone()
        };
        if let Some(Kind::Nested(nested)) = field.kind.as_ref() {
            let nested_values = values
                .get(&field.field_id)
                .unwrap_or(&serde_json::Value::Null);
            for child in &nested.fields {
                let child_value = nested_values
                    .get(&child.field_id)
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let child_path = join_form_path(
                    &path,
                    if child.request_field.is_empty() {
                        &child.field_id
                    } else {
                        &child.request_field
                    },
                );
                set_json_path(root, &child_path, child_value);
            }
        } else {
            set_json_path(root, &path, value);
        }
    }
}

fn edit_form_field(field: &FormField, values: &mut serde_json::Value, key: KeyCode) {
    let Some(current) = values
        .as_object_mut()
        .and_then(|object| object.get_mut(&field.field_id))
    else {
        return;
    };
    match field.kind.as_ref() {
        Some(Kind::Text(_)) | Some(Kind::Masked(_)) => match key {
            KeyCode::Char(c) => {
                if let Some(text) = current.as_str() {
                    *current = serde_json::Value::String(format!("{text}{c}"));
                }
            }
            KeyCode::Backspace => {
                if let Some(text) = current.as_str() {
                    let mut text = text.to_string();
                    text.pop();
                    *current = serde_json::Value::String(text);
                }
            }
            _ => {}
        },
        Some(Kind::Integer(input)) => {
            let step = if input.step == 0 { 1 } else { input.step } as i64;
            let mut number = current.as_i64().unwrap_or(input.default_value as i64);
            match key {
                KeyCode::Up => number = number.saturating_add(step),
                KeyCode::Down => number = number.saturating_sub(step),
                _ => return,
            }
            if input.max != 0 {
                number = number.min(input.max as i64);
            }
            if input.min != 0 {
                number = number.max(input.min as i64);
            }
            *current = serde_json::Value::from(number);
        }
        Some(Kind::Number(input)) => {
            let step = if input.step == 0.0 { 1.0 } else { input.step };
            let mut number = current.as_f64().unwrap_or(input.default_value);
            match key {
                KeyCode::Up => number += step,
                KeyCode::Down => number -= step,
                _ => return,
            }
            if input.max != 0.0 {
                number = number.min(input.max);
            }
            if input.min != 0.0 {
                number = number.max(input.min);
            }
            *current = serde_json::Value::from(number);
        }
        Some(Kind::Boolean(_))
            if matches!(key, KeyCode::Char(' ') | KeyCode::Left | KeyCode::Right) =>
        {
            *current = serde_json::Value::Bool(!current.as_bool().unwrap_or(false));
        }
        Some(Kind::EnumSelection(input)) => {
            let options: Vec<String> = if !input.options.is_empty() {
                input
                    .options
                    .iter()
                    .map(|option| option.value.clone())
                    .collect()
            } else {
                input.allowed_values.clone()
            };
            if options.is_empty() {
                return;
            }
            let current_index = options
                .iter()
                .position(|option| Some(option.as_str()) == current.as_str())
                .unwrap_or(0);
            let next = match key {
                KeyCode::Up | KeyCode::Left => (current_index + options.len() - 1) % options.len(),
                KeyCode::Down | KeyCode::Right => (current_index + 1) % options.len(),
                _ => return,
            };
            *current = serde_json::Value::String(options[next].clone());
        }
        _ => {}
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
