//! Stateful, bounded native composition over the canonical ViewDescriptor.
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use meridian_uiview::{
    proto::{layout, panel_descriptor::Body, Action, PanelDescriptor, Slot, ViewDescriptor},
    Context, ProtoPaths, RequestBudget, RequestBuilder, RequestOverrides,
};
use prost::Message;
use ratatui::{
    backend::TestBackend,
    layout::Rect,
    text::Line,
    widgets::{Block, Borders, Paragraph},
    Frame, Terminal,
};
use serde_json::Value;

use crate::{
    FormSubmission, LroRunId, LroSubmission, Palette, PanelPromptResponse, PanelView, RpcError,
    RpcInvoker, StreamInvoker,
};

const MAX_NODES: usize = 1000;
const PANEL_HEIGHT: usize = 16;
type Path = Vec<usize>;

/// In-process host handoff only. Returning one never invokes a mutation.
pub enum ViewResponse {
    Action {
        service: String,
        method: String,
        request: Value,
    },
    Form(FormSubmission),
    Lro(LroSubmission),
    Prompt(PanelPromptResponse),
}

#[derive(Clone, PartialEq, Eq)]
enum TargetKind {
    Panel,
    Tab { view: Path, slot: usize },
    Action { index: usize, slot: bool },
    Retry,
}

#[derive(Clone)]
struct Target {
    path: Path,
    source: Path,
    record: Option<Arc<Value>>,
    kind: TargetKind,
}

struct Entry<'a> {
    label: String,
    panel: Option<&'a PanelDescriptor>,
    target: Option<Target>,
}

struct Repeat {
    request: Value,
    record: Option<Arc<Value>>,
    rows: Result<Vec<Arc<Value>>, String>,
}

/// Own one descriptor per mounted view. Construct a new host to replace it.
/// Reads go through the supplied host invoker; hosts must enforce read admission.
/// F6/Shift+F6 navigate sections and actions; Enter activates tabs/actions.
/// Ctrl+PageUp/PageDown always scroll the composition. Plain paging keys stay
/// with a focused prompt; otherwise they also scroll the composition.
pub struct ViewHost {
    descriptor: ViewDescriptor,
    palette: Palette,
    panels: BTreeMap<Path, PanelView>,
    repeats: BTreeMap<Path, Repeat>,
    tabs: BTreeMap<Path, usize>,
    targets: Vec<Target>,
    focus: usize,
    scroll: usize,
    reveal_focus: bool,
    viewport: usize,
    error: Option<String>,
}

impl ViewHost {
    pub fn new(descriptor: ViewDescriptor) -> Result<Self, RpcError> {
        // Check depth/count before prost's recursive encoded_len traversal.
        descriptor_cost(&descriptor, 0)?;
        if descriptor.encoded_len() > 4 * 1024 * 1024 {
            return Err(limit());
        }
        Ok(Self {
            descriptor,
            palette: Palette::default(),
            panels: BTreeMap::new(),
            repeats: BTreeMap::new(),
            tabs: BTreeMap::new(),
            targets: vec![],
            focus: 0,
            scroll: 0,
            reveal_focus: true,
            viewport: 1,
            error: None,
        })
    }

    pub fn set_palette(&mut self, palette: Palette) {
        self.palette = palette;
        for panel in self.panels.values_mut() {
            panel.set_palette(palette);
        }
    }

    /// Display a host admission/execution error without claiming success.
    pub fn show_error(&mut self, error: impl Into<String>) {
        self.error = Some(error.into());
    }

    /// Refresh reads and invalidate host-held operation tokens. Call when the
    /// transport or context changes affect panel reads, including selection
    /// values used by those reads. Gates and repeated-populate request changes
    /// are also reconciled on every render.
    pub fn invalidate(&mut self) {
        self.panels.clear();
        self.repeats.clear();
        self.targets.clear();
        self.reveal_focus = true;
    }

    /// The real focused widget, for host-owned stream polling/LRO completion.
    pub fn focused_panel_mut(&mut self) -> Option<&mut PanelView> {
        let target = self.targets.get(self.focus)?;
        if !matches!(target.kind, TargetKind::Panel) {
            return None;
        }
        self.panels.get_mut(&target.path)
    }

    /// Route operation updates by opaque token, independent of keyboard focus.
    /// Hidden/gated/unmounted attempts have been dropped and reject updates.
    pub fn update_lro_progress(
        &mut self,
        run_id: &LroRunId,
        operation_name: &str,
        metadata: &prost_types::Struct,
    ) -> bool {
        self.panels
            .values_mut()
            .any(|p| p.update_lro_progress(run_id, operation_name, metadata))
    }
    pub fn complete_lro(&mut self, run_id: &LroRunId, result: &prost_types::Struct) -> bool {
        self.panels
            .values_mut()
            .any(|p| p.complete_lro(run_id, result))
    }
    pub fn fail_lro(&mut self, run_id: &LroRunId, error: &str) -> bool {
        self.panels.values_mut().any(|p| p.fail_lro(run_id, error))
    }
    pub fn cancel_lro(&mut self, run_id: &LroRunId) -> bool {
        self.panels.values_mut().any(|p| p.cancel_lro(run_id))
    }

    /// Poll only mounted visible-tab panels. No mutation authority is implied.
    pub fn poll_streams<I: StreamInvoker>(&mut self, context: &Context, invoker: &I) {
        for target in &self.targets {
            if matches!(target.kind, TargetKind::Panel)
                && gates_open(&self.descriptor, &target.source, context)
            {
                if let (Some(panel), Some(widget)) = (
                    slot_at(&self.descriptor, &target.source).and_then(|s| s.panel.as_ref()),
                    self.panels.get_mut(&target.path),
                ) {
                    widget.poll_stream(panel, context, invoker);
                }
            }
        }
    }

    pub fn render<I: RpcInvoker>(
        &mut self,
        frame: &mut Frame,
        area: Rect,
        context: &Context,
        invoker: &I,
    ) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        let mut planner = Planner {
            context,
            invoker,
            tabs: &mut self.tabs,
            repeats: &mut self.repeats,
            seen_repeats: BTreeSet::new(),
            seen_tabs: BTreeSet::new(),
            nodes: 0,
            entries: vec![],
        };
        let planned = planner.view(&self.descriptor, &[], &[], None, 0);
        planner
            .repeats
            .retain(|path, _| planner.seen_repeats.contains(path));
        planner
            .tabs
            .retain(|path, _| planner.seen_tabs.contains(path));
        let mut entries = planner.entries;
        if let Err(error) = planned {
            // Fail the whole composition visibly; no partially widened view.
            entries.clear();
            entries.push(Entry {
                label: error.to_string(),
                panel: None,
                target: None,
            });
        }
        let old_focus = self.targets.get(self.focus).cloned();
        self.targets = entries
            .iter()
            .filter_map(|entry| entry.target.clone())
            .collect();
        self.focus = self.focus.min(self.targets.len().saturating_sub(1));
        if let Some(old) = old_focus {
            if let Some(index) = self
                .targets
                .iter()
                .position(|t| t.path == old.path && t.kind == old.kind)
            {
                self.focus = index;
            }
        }
        let active: BTreeSet<_> = self
            .targets
            .iter()
            .filter(|t| matches!(t.kind, TargetKind::Panel))
            .map(|t| t.path.clone())
            .collect();
        // Dropping hidden/gated descendants releases streams and stale tokens.
        self.panels.retain(|path, _| active.contains(path));
        for target in self
            .targets
            .iter()
            .filter(|t| matches!(t.kind, TargetKind::Panel))
        {
            let widget = self
                .panels
                .entry(target.path.clone())
                .or_insert_with(|| PanelView::with_palette(self.palette));
            // Reset changed records even before their section enters the viewport.
            if let Err(error) = widget.set_record(target.record.clone()) {
                self.error = Some(error.to_string());
            }
        }
        self.viewport = area.height.saturating_sub(1).max(1) as usize;
        let width = area.width;
        let heights: Vec<_> = entries
            .iter()
            .map(|e| {
                if e.panel.is_some() {
                    PANEL_HEIGHT
                } else {
                    text_height(&e.label, width)
                }
            })
            .collect();
        let total: usize = heights.iter().sum();
        let mut y = 0;
        let mut target_index = 0;
        for (entry, height) in entries.iter().zip(&heights) {
            if entry.target.is_some() {
                if target_index == self.focus && self.reveal_focus {
                    if y < self.scroll {
                        self.scroll = y;
                    }
                    if y + height > self.scroll + self.viewport {
                        self.scroll = (y + height).saturating_sub(self.viewport).min(y);
                    }
                }
                target_index += 1;
            }
            y += height;
        }
        self.reveal_focus = false;
        self.scroll = self.scroll.min(total.saturating_sub(self.viewport));
        y = 0;
        target_index = 0;
        for (entry, height) in entries.iter().zip(heights) {
            let focused = entry.target.is_some() && target_index == self.focus;
            if entry.target.is_some() {
                target_index += 1;
            }
            if y + height > self.scroll && y < self.scroll + self.viewport {
                // A bounded virtual section preserves the full native widget
                // geometry while copying only the viewport's intersecting cells.
                let mut terminal = Terminal::new(TestBackend::new(width, height as u16))
                    .expect("in-memory terminal");
                terminal
                    .draw(|section| {
                        let section_area = section.area();
                        if let (Some(panel), Some(target)) = (entry.panel, entry.target.as_ref()) {
                            let widget = self
                                .panels
                                .entry(target.path.clone())
                                .or_insert_with(|| PanelView::with_palette(self.palette));
                            if let Err(error) = widget.set_record(target.record.clone()) {
                                section
                                    .render_widget(Paragraph::new(error.to_string()), section_area);
                            } else {
                                let border = Block::default()
                                    .borders(Borders::ALL)
                                    .title(if focused {
                                        "Focused section"
                                    } else {
                                        "Section"
                                    })
                                    .border_style(ratatui::style::Style::default().fg(
                                        if focused {
                                            self.palette.accent
                                        } else {
                                            self.palette.border
                                        },
                                    ));
                                let inner = border.inner(section_area);
                                section.render_widget(border, section_area);
                                widget.render(section, inner, panel, context, invoker);
                            }
                        } else {
                            let style = if focused {
                                self.palette.accent
                            } else {
                                self.palette.fg
                            };
                            section.render_widget(
                                Paragraph::new(wrapped_lines(&entry.label, width))
                                    .style(ratatui::style::Style::default().fg(style)),
                                section_area,
                            );
                        }
                    })
                    .expect("in-memory draw");
                let buffer = terminal.backend().buffer();
                for row in 0..height {
                    let global = y + row;
                    if global >= self.scroll && global < self.scroll + self.viewport {
                        for col in 0..width {
                            frame.buffer_mut()
                                [(area.x + col, area.y + (global - self.scroll) as u16)] =
                                buffer[(col, row as u16)].clone();
                        }
                    }
                }
            }
            y += height;
        }
        let status = self.error.as_deref().unwrap_or(
            "F6/Shift+F6 section · Ctrl+PgUp/PgDn scroll · Enter activate · panel keys edit",
        );
        frame.render_widget(
            Paragraph::new(status),
            Rect::new(area.x, area.y + area.height - 1, width, 1),
        );
    }

    pub fn handle_key(
        &mut self,
        key: KeyEvent,
        context: &Context,
    ) -> Result<Option<ViewResponse>, RpcError> {
        self.error = None;
        let prompt_paging = self.targets.get(self.focus).is_some_and(|target| {
            matches!(target.kind, TargetKind::Panel)
                && slot_at(&self.descriptor, &target.source)
                    .and_then(|s| s.panel.as_ref())
                    .is_some_and(|panel| {
                        matches!(panel.body, Some(Body::Prompt(_) | Body::LlmPrompt(_)))
                    })
        }) && !key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::F(6) => {
                if !self.targets.is_empty() {
                    self.focus = if key.modifiers.contains(KeyModifiers::SHIFT) {
                        (self.focus + self.targets.len() - 1) % self.targets.len()
                    } else {
                        (self.focus + 1) % self.targets.len()
                    };
                    self.reveal_focus = true;
                }
                return Ok(None);
            }
            KeyCode::PageDown if !prompt_paging => {
                self.scroll = self.scroll.saturating_add(self.viewport);
                return Ok(None);
            }
            KeyCode::PageUp if !prompt_paging => {
                self.scroll = self.scroll.saturating_sub(self.viewport);
                return Ok(None);
            }
            _ => {}
        }
        let Some(target) = self.targets.get(self.focus).cloned() else {
            return Ok(None);
        };
        if !gates_open(&self.descriptor, &target.source, context) {
            self.invalidate();
            return Ok(None);
        }
        match target.kind {
            TargetKind::Tab { view, slot } => {
                if key.code == KeyCode::Enter || key.code == KeyCode::Char(' ') {
                    if self.tabs.get(&view) == Some(&slot) {
                        return Ok(None);
                    }
                    self.tabs.insert(view.clone(), slot);
                    // Invalidate old descendants immediately, before next draw.
                    let source_view =
                        view_at(&self.descriptor, &target.source).expect("mounted view");
                    let hidden = |path: &Path| {
                        path.starts_with(&view)
                            && path.get(view.len()).is_some_and(|i| {
                                *i != slot
                                    && source_view.slots[*i]
                                        .placement
                                        .as_ref()
                                        .is_some_and(|p| !p.header_row && !p.tab_label.is_empty())
                            })
                    };
                    self.panels.retain(|path, _| !hidden(path));
                    self.repeats.retain(|path, _| !hidden(path));
                    self.targets.retain(|t| !hidden(&t.path));
                    self.focus = self.focus.min(self.targets.len().saturating_sub(1));
                    self.reveal_focus = true;
                } else if matches!(
                    key.code,
                    KeyCode::Left | KeyCode::Right | KeyCode::Home | KeyCode::End
                ) {
                    let choices: Vec<_> = self.targets.iter().enumerate().filter(|(_, t)| matches!(&t.kind, TargetKind::Tab { view: other, .. } if *other == view)).map(|(i, _)| i).collect();
                    let current = choices.iter().position(|i| *i == self.focus).unwrap_or(0);
                    self.focus = choices[match key.code {
                        KeyCode::Left => (current + choices.len() - 1) % choices.len(),
                        KeyCode::Right => (current + 1) % choices.len(),
                        KeyCode::Home => 0,
                        _ => choices.len() - 1,
                    }];
                    self.reveal_focus = true;
                }
            }
            TargetKind::Retry if key.code == KeyCode::Enter => {
                self.repeats.remove(&target.path);
            }
            TargetKind::Action { index, slot } if key.code == KeyCode::Enter => {
                let actions = if slot {
                    &slot_at(&self.descriptor, &target.source)
                        .expect("mounted slot")
                        .actions
                } else {
                    &view_at(&self.descriptor, &target.source)
                        .expect("mounted view")
                        .actions
                };
                if let Some(call) = actions[index].call.as_ref() {
                    let request = RequestBuilder::build_for_boundary_with(
                        call,
                        context,
                        RequestOverrides {
                            selected_row: target.record.as_deref(),
                            ..Default::default()
                        },
                    )
                    .map_err(|_| limit())?;
                    return Ok(Some(ViewResponse::Action {
                        service: call.service.clone(),
                        method: call.method.clone(),
                        request,
                    }));
                }
            }
            TargetKind::Panel => {
                let panel = slot_at(&self.descriptor, &target.source)
                    .and_then(|s| s.panel.as_ref())
                    .expect("mounted panel");
                let Some(widget) = self.panels.get_mut(&target.path) else {
                    return Ok(None);
                };
                match &panel.body {
                    Some(Body::Form(form)) => {
                        return Ok(widget
                            .handle_form_key(form, context, key.code)
                            .map(ViewResponse::Form))
                    }
                    Some(Body::Lro(lro)) => {
                        return Ok(widget
                            .handle_lro_key(lro, context, key.code)
                            .map(ViewResponse::Lro))
                    }
                    Some(Body::Prompt(_) | Body::LlmPrompt(_)) => {
                        return Ok(widget
                            .handle_prompt_key(panel, key)
                            .map(ViewResponse::Prompt))
                    }
                    Some(Body::Stream(_)) => match key.code {
                        KeyCode::Up => widget.scroll_stream(-1),
                        KeyCode::Down => widget.scroll_stream(1),
                        _ => {}
                    },
                    _ => match key.code {
                        KeyCode::Up => widget.select_prev(),
                        KeyCode::Down => widget.select_next(),
                        KeyCode::Char('r') => widget.toggle_reveal(),
                        _ => {}
                    },
                }
            }
            _ => {}
        }
        Ok(None)
    }
}

fn limit() -> RpcError {
    RpcError::Other("View composition limit exceeded.".into())
}

fn same_record(old: &Option<Arc<Value>>, new: &Option<Arc<Value>>) -> bool {
    match (old, new) {
        (None, None) => true,
        (Some(old), Some(new)) => Arc::ptr_eq(old, new),
        _ => false,
    }
}

fn descriptor_cost(view: &ViewDescriptor, depth: usize) -> Result<usize, RpcError> {
    if depth > 64 || view.slots.len() >= MAX_NODES {
        return Err(limit());
    }
    let mut cost = local_cost(view);
    let mut labels = vec![view.title.as_str(), view.id.as_str()];
    for action in &view.actions {
        labels.extend([action.id.as_str(), action.label.as_str()]);
    }
    for slot in &view.slots {
        labels.extend([
            slot.id.as_str(),
            slot.title.as_str(),
            slot.depends_on_placeholder.as_str(),
        ]);
        if let Some(p) = &slot.placement {
            labels.push(&p.tab_label);
        }
        if let Some(p) = &slot.panel {
            labels.push(&p.title);
        }
        for action in &slot.actions {
            labels.extend([action.id.as_str(), action.label.as_str()]);
        }
        if let Some(child) = &slot.sub_view {
            cost += descriptor_cost(child, depth + 1)?;
        }
        if cost > MAX_NODES {
            return Err(limit());
        }
    }
    if cost > MAX_NODES || labels.iter().any(|label| label.len() > 16 * 1024) {
        return Err(limit());
    }
    Ok(cost)
}

fn local_cost(view: &ViewDescriptor) -> usize {
    1 + view.actions.len()
        + view
            .slots
            .iter()
            .map(|s| 1 + s.actions.len())
            .sum::<usize>()
}

fn text_height(text: &str, width: u16) -> usize {
    wrapped_lines(text, width).len()
}

fn wrapped_lines(text: &str, width: u16) -> Vec<Line<'static>> {
    let mut result = vec![];
    for raw in text.split('\n') {
        let line = Line::from(raw);
        let mut text = String::new();
        let mut used = 0;
        for glyph in line.styled_graphemes(ratatui::style::Style::default()) {
            let cells = Line::from(glyph.symbol).width();
            if used + cells > width as usize && !text.is_empty() {
                result.push(Line::from(std::mem::take(&mut text)));
                used = 0;
            }
            text.push_str(glyph.symbol);
            used += cells;
        }
        result.push(Line::from(text));
    }
    result
}

fn gates_open(mut view: &ViewDescriptor, source: &[usize], context: &Context) -> bool {
    for index in source {
        let Some(slot) = view.slots.get(*index) else {
            return false;
        };
        if !slot.depends_on_selection_key.is_empty()
            && context
                .selections
                .get(&slot.depends_on_selection_key)
                .is_none_or(Value::is_null)
        {
            return false;
        }
        if let Some(child) = &slot.sub_view {
            view = child;
        }
    }
    true
}

fn view_at<'a>(mut view: &'a ViewDescriptor, source: &[usize]) -> Option<&'a ViewDescriptor> {
    for index in source {
        view = view.slots.get(*index)?.sub_view.as_ref()?;
    }
    Some(view)
}
fn slot_at<'a>(view: &'a ViewDescriptor, source: &[usize]) -> Option<&'a Slot> {
    let (last, parent) = source.split_last()?;
    view_at(view, parent)?.slots.get(*last)
}

struct Planner<'a, I> {
    context: &'a Context,
    invoker: &'a I,
    tabs: &'a mut BTreeMap<Path, usize>,
    repeats: &'a mut BTreeMap<Path, Repeat>,
    seen_repeats: BTreeSet<Path>,
    seen_tabs: BTreeSet<Path>,
    nodes: usize,
    entries: Vec<Entry<'a>>,
}

impl<'a, I: RpcInvoker> Planner<'a, I> {
    fn text(&mut self, label: String) {
        self.entries.push(Entry {
            label,
            panel: None,
            target: None,
        });
    }

    fn actions(
        &mut self,
        actions: &'a [Action],
        path: &[usize],
        source: &[usize],
        record: &Option<Arc<Value>>,
        slot: bool,
    ) {
        for (index, action) in actions.iter().enumerate() {
            self.entries.push(Entry {
                label: format!("Action: {} [{}]", action.label, action.id),
                panel: None,
                target: Some(Target {
                    path: path.to_vec(),
                    source: source.to_vec(),
                    record: record.clone(),
                    kind: TargetKind::Action { index, slot },
                }),
            });
        }
    }

    fn view(
        &mut self,
        view: &'a ViewDescriptor,
        path: &[usize],
        source: &[usize],
        record: Option<Arc<Value>>,
        depth: usize,
    ) -> Result<(), RpcError> {
        self.nodes += local_cost(view);
        if depth > 64 || self.nodes > MAX_NODES {
            return Err(limit());
        }
        self.text(format!("View: {} [{}]", view.title, view.id));
        self.actions(&view.actions, path, source, &record, false);
        let mut ordered: Vec<_> = (0..view.slots.len()).collect();
        ordered.sort_by_key(|i| view.slots[*i].position);
        for i in ordered.iter().copied().filter(|i| {
            view.slots[*i]
                .placement
                .as_ref()
                .is_some_and(|p| p.header_row)
        }) {
            self.slot(view, i, path, source, record.clone(), depth)?;
        }
        ordered.retain(|i| {
            !view.slots[*i]
                .placement
                .as_ref()
                .is_some_and(|p| p.header_row)
        });
        match view.layout.as_ref().and_then(|l| l.mode.as_ref()) {
            Some(layout::Mode::Tabbed(_)) => {
                self.seen_tabs.insert(path.to_vec());
                let mut tabs: Vec<_> = ordered
                    .iter()
                    .copied()
                    .filter(|i| {
                        view.slots[*i]
                            .placement
                            .as_ref()
                            .is_some_and(|p| !p.tab_label.is_empty())
                    })
                    .collect();
                tabs.sort_by_key(|i| view.slots[*i].placement.as_ref().unwrap().tab_position);
                let chosen = self
                    .tabs
                    .entry(path.to_vec())
                    .or_insert_with(|| tabs.first().copied().unwrap_or(usize::MAX));
                if !tabs.contains(chosen) {
                    *chosen = tabs.first().copied().unwrap_or(usize::MAX);
                }
                let selected = *chosen;
                for i in ordered.iter().copied().filter(|i| !tabs.contains(i)) {
                    self.slot(view, i, path, source, record.clone(), depth)?;
                }
                for i in tabs {
                    self.entries.push(Entry {
                        label: format!(
                            "{}Tab: {}",
                            if i == selected { "[selected] " } else { "" },
                            view.slots[i].placement.as_ref().unwrap().tab_label
                        ),
                        panel: None,
                        target: Some(Target {
                            path: path.to_vec(),
                            source: source.to_vec(),
                            record: record.clone(),
                            kind: TargetKind::Tab {
                                view: path.to_vec(),
                                slot: i,
                            },
                        }),
                    });
                }
                if selected != usize::MAX {
                    self.slot(view, selected, path, source, record, depth)?;
                }
            }
            Some(layout::Mode::TwoColumn(_)) => {
                for sidebar in [false, true] {
                    if sidebar
                        && ordered.iter().any(|i| {
                            view.slots[*i]
                                .placement
                                .as_ref()
                                .is_some_and(|p| p.column == 2)
                        })
                    {
                        self.text("Sidebar".into());
                    }
                    for i in ordered.iter().copied().filter(|i| {
                        view.slots[*i]
                            .placement
                            .as_ref()
                            .is_some_and(|p| p.column == 2)
                            == sidebar
                    }) {
                        self.slot(view, i, path, source, record.clone(), depth)?;
                    }
                }
            }
            _ => {
                for i in ordered {
                    self.slot(view, i, path, source, record.clone(), depth)?;
                }
            }
        }
        if view.slots.is_empty() {
            self.text("No sections.".into());
        }
        Ok(())
    }

    fn slot(
        &mut self,
        view: &'a ViewDescriptor,
        index: usize,
        parent: &[usize],
        source: &[usize],
        record: Option<Arc<Value>>,
        depth: usize,
    ) -> Result<(), RpcError> {
        let slot = &view.slots[index];
        let mut path = parent.to_vec();
        path.push(index);
        let mut source = source.to_vec();
        source.push(index);
        let title = if !slot.title.is_empty() {
            &slot.title
        } else if let Some(panel) = &slot.panel {
            &panel.title
        } else {
            &slot.id
        };
        self.text(format!("Section: {title} [{}]", slot.id));
        if !slot.depends_on_selection_key.is_empty()
            && self
                .context
                .selections
                .get(&slot.depends_on_selection_key)
                .is_none_or(Value::is_null)
        {
            self.text(if slot.depends_on_placeholder.is_empty() {
                "Select a value to view this section.".into()
            } else {
                slot.depends_on_placeholder.clone()
            });
            return Ok(());
        }
        self.actions(&slot.actions, &path, &source, &record, true);
        if let Some(child) = &slot.sub_view {
            if let Some(call) = &slot.sub_view_populate {
                self.seen_repeats.insert(path.clone());
                let request = RequestBuilder::build_for_boundary_with(
                    call,
                    self.context,
                    RequestOverrides {
                        selected_row: record.as_deref(),
                        ..Default::default()
                    },
                )
                .map_err(|_| limit())?;
                if self.repeats.get(&path).is_none_or(|cached| {
                    cached.request != request || !same_record(&cached.record, &record)
                }) {
                    let rows = (|| {
                        let response =
                            self.invoker
                                .invoke(&call.service, &call.method, request.clone())?;
                        RequestBudget::for_boundary(&response).map_err(|_| limit())?;
                        let rows = ProtoPaths::get(&response, &slot.sub_view_rows_field)
                            .as_array()
                            .ok_or_else(|| {
                                RpcError::Other("Repeated view rows must be an array.".into())
                            })?;
                        let cost = descriptor_cost(child, depth + 1)?;
                        if rows.len().saturating_mul(cost).saturating_add(self.nodes) > MAX_NODES
                            || rows.iter().any(|row| !row.is_object())
                        {
                            return Err(limit());
                        }
                        Ok(rows.iter().map(|row| Arc::new(row.clone())).collect())
                    })()
                    .map_err(|e: RpcError| {
                        let mut text = e.to_string();
                        if text.len() > 4096 {
                            let mut end = 4096;
                            while !text.is_char_boundary(end) {
                                end -= 1;
                            }
                            text.truncate(end);
                            text.push_str("… (error truncated)");
                        }
                        text
                    });
                    self.repeats.insert(
                        path.clone(),
                        Repeat {
                            request,
                            record: record.clone(),
                            rows,
                        },
                    );
                }
                match &self.repeats[&path].rows {
                    Ok(rows) => {
                        let rows = rows.clone();
                        if rows.is_empty() {
                            self.text("No records.".into());
                        }
                        for (i, row) in rows.into_iter().enumerate() {
                            let mut child_path = path.clone();
                            child_path.push(i);
                            self.view(child, &child_path, &source, Some(row), depth + 1)?;
                        }
                    }
                    Err(error) => self.entries.push(Entry {
                        label: format!("{error} Enter to retry."),
                        panel: None,
                        target: Some(Target {
                            path,
                            source,
                            record,
                            kind: TargetKind::Retry,
                        }),
                    }),
                }
            } else {
                path.push(0);
                self.view(child, &path, &source, record, depth + 1)?;
            }
        } else if let Some(panel) = &slot.panel {
            self.entries.push(Entry {
                label: String::new(),
                panel: Some(panel),
                target: Some(Target {
                    path,
                    source,
                    record,
                    kind: TargetKind::Panel,
                }),
            });
        } else {
            self.text("No panel or nested view supplied.".into());
        }
        Ok(())
    }
}
