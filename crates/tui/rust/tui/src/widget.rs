use meridian_uiview::proto::panel_descriptor::Body;
use meridian_uiview::proto::{PanelDescriptor, TablePanel};
use meridian_uiview::{render_table, Context, RenderedRow, RequestBuilder};
use ratatui::layout::{Constraint, Layout};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::content;
use crate::invoker::RpcInvoker;
use crate::theme::Palette;

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

impl PanelView {
    pub fn new() -> Self {
        Self {
            cached: None,
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
            table_state: TableState::default(),
            palette,
            content_selected: 0,
            content_len: 0,
            reveal_secret: false,
        }
    }

    /// Swap the active palette (e.g. on a runtime theme/mode change).
    pub fn set_palette(&mut self, palette: Palette) {
        self.palette = palette;
    }

    /// Forces the next render to refetch the table data.
    pub fn invalidate(&mut self) {
        self.cached = None;
    }

    pub fn select_next(&mut self) {
        if let Some(cached) = &self.cached {
            let n = cached.rows.len();
            if n == 0 {
                return;
            }
            let i = self.table_state.selected().map(|i| (i + 1) % n).unwrap_or(0);
            self.table_state.select(Some(i));
        } else if self.content_len > 0 {
            // Content shapes (Choice / ConnectFlow) — advance the target cursor.
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
        let title = Paragraph::new(Span::styled(
            descriptor.title.clone(),
            self.palette.title(),
        ));
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
            Some(Body::Lro(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "LRO panels: drive via host (RpcInvoker + WaitOperation polling).",
            ),
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
            Some(Body::Gallery(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Gallery panels: not yet supported in the TUI renderer.",
            ),
            Some(Body::Form(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Form panels (entity detail sections): not yet supported in the TUI renderer.",
            ),
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
            Some(Body::Terminal(_)) => self.render_placeholder(
                frame,
                chunks[1],
                chunks[2],
                "Terminal panels are web-specific (xterm.js) — not rendered in the TUI.",
            ),
            None => self.render_placeholder(frame, chunks[1], chunks[2], "(no body set)"),
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
                Row::new(r.cells.iter().map(|c| Cell::from(c.clone())).collect::<Vec<_>>())
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

    /// Convenience: returns the currently-selected row's raw JSON,
    /// for hosts that want to fire RowActions.
    pub fn selected_row(&self) -> Option<&serde_json::Value> {
        let cached = self.cached.as_ref()?;
        let index = self.table_state.selected()?;
        cached.rows.get(index).map(|r| &r.raw)
    }
}

impl Default for PanelView {
    fn default() -> Self {
        Self::new()
    }
}

