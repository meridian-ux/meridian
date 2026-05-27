use meridian_uiview::proto::panel_descriptor::Body;
use meridian_uiview::proto::{PanelDescriptor, TablePanel};
use meridian_uiview::{render_table, Context, RenderedRow, RequestBuilder};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Paragraph, Row, Table, TableState};
use ratatui::Frame;

use crate::invoker::RpcInvoker;

/// Stateful ratatui widget rendering one PanelDescriptor. For
/// TablePanels it does its own populate call against the invoker
/// (lazy + cached); for LroPanels it shows a placeholder telling
/// the operator to wire the LRO driver; for AdhocPanels it surfaces
/// the handler_id so the host knows which custom view to swap in.
pub struct PanelView {
    cached: Option<CachedTable>,
    table_state: TableState,
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
        }
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
        }
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
            Style::default().add_modifier(Modifier::BOLD),
        ));
        frame.render_widget(title, chunks[0]);

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
                "LLM-prompt panels: renderer pending. The descriptor carries system/user templates + slots — host should fill slots, substitute, and pair with an LroPanel for execution.",
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
            Style::default().fg(ratatui::style::Color::DarkGray),
        ));
        frame.render_widget(meta, meta_area);

        let header = Row::new(
            table_panel
                .columns
                .iter()
                .map(|col| Cell::from(col.header.clone()))
                .collect::<Vec<_>>(),
        )
        .style(Style::default().add_modifier(Modifier::BOLD));

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
            .header(header)
            .block(Block::default().borders(Borders::ALL))
            .row_highlight_style(
                Style::default().add_modifier(Modifier::REVERSED),
            );

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
        let body = Paragraph::new(Span::styled(
            text,
            Style::default().fg(ratatui::style::Color::DarkGray),
        ))
        .block(Block::default().borders(Borders::ALL));
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

