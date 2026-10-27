//! In-process action-control state. Protobuf owns declarations; cached rows stay
//! borrowed at activation, never reconstructed from formatted terminal text.
use super::*;
use serde_json::Value;
use std::collections::BTreeSet;

pub(super) struct Frame {
    descriptor: Vec<u8>,
    scope: Arc<Vec<u8>>,
    generation: Arc<()>,
    row: Option<usize>,
    action: usize,
    rendered: bool,
}

#[derive(Default)]
pub(super) struct State {
    frame: Option<Frame>,
    generation: Arc<()>,
    selected: usize,
    feedback: Option<&'static str>,
    completed_refresh: BTreeSet<(usize, usize)>,
}
impl State {
    pub(super) fn withdraw(&mut self) {
        if let Some(frame) = &mut self.frame {
            frame.rendered = false;
        }
    }
    pub(super) fn invalidate(&mut self) {
        *self = Self::default();
    }
    pub(super) fn selection_changed(&mut self) {
        self.withdraw();
        self.selected = 0;
        self.feedback = None;
    }
}

const STALE: &str =
    "Action stopped because its source or selection changed; redraw before retrying.";
const LIMIT: &str = "Action denied: panel declaration or context limit exceeded.";

pub(super) fn supports(panel: &PanelDescriptor) -> bool {
    row_control(panel) || content_control(panel)
}

fn row_control(panel: &PanelDescriptor) -> bool {
    matches!(panel.body, Some(Body::Table(_) | Body::ResourceCards(_)))
}

pub(super) fn content_control(panel: &PanelDescriptor) -> bool {
    matches!(
        panel.body,
        Some(
            Body::Action(_)
                | Body::Catalog(_)
                | Body::ConnectFlow(_)
                | Body::Steps(_)
                | Body::Snippet(_)
                | Body::CopyValue(_)
        )
    )
}

fn declaration(panel: &PanelDescriptor) -> Option<Vec<u8>> {
    let labels: Vec<&str> = match &panel.body {
        Some(Body::Table(table)) => {
            let canonical = table.affordances.as_ref().map_or(0, |set| set.items.len());
            if canonical > 1_000 {
                return None;
            }
            table
                .affordances
                .iter()
                .flat_map(|set| &set.items)
                .flat_map(|a| [a.label.as_str(), a.id.as_str()])
                .collect()
        }
        Some(Body::ResourceCards(cards)) => {
            let actions = cards
                .template
                .as_ref()?
                .actions
                .as_ref()
                .map(|set| set.actions.as_slice())
                .unwrap_or_default();
            if actions.len() > 1_000 {
                return None;
            }
            actions
                .iter()
                .flat_map(|a| [a.label.as_str(), a.id.as_str()])
                .collect()
        }
        Some(Body::Action(p)) => p
            .action
            .iter()
            .flat_map(|a| [a.label.as_str(), a.id.as_str()])
            .collect(),
        Some(Body::Catalog(p)) => {
            if p.items
                .len()
                .saturating_add(p.items.iter().filter(|i| i.action.is_some()).count())
                > 1_000
            {
                return None;
            }
            p.items
                .iter()
                .flat_map(|item| {
                    std::iter::once(item.name.as_str()).chain(
                        item.action
                            .iter()
                            .flat_map(|a| [a.label.as_str(), a.id.as_str()]),
                    )
                })
                .collect()
        }
        Some(Body::Steps(p)) => {
            if p.steps
                .len()
                .saturating_add(p.steps.iter().filter(|s| s.action.is_some()).count())
                > 1_000
            {
                return None;
            }
            p.steps
                .iter()
                .flat_map(|step| {
                    std::iter::once(step.label.as_str()).chain(
                        step.action
                            .iter()
                            .flat_map(|a| [a.label.as_str(), a.id.as_str()]),
                    )
                })
                .collect()
        }
        Some(Body::ConnectFlow(p)) => {
            let count = p
                .targets
                .iter()
                .try_fold(usize::from(p.endpoint.is_some()), |n, t| {
                    n.checked_add(1)?
                        .checked_add(t.actions.len())?
                        .checked_add(t.configs.len())
                });
            if count.is_none_or(|n| n > 1_000) {
                return None;
            }
            p.targets
                .iter()
                .flat_map(|t| {
                    std::iter::once(t.label.as_str())
                        .chain(
                            t.actions
                                .iter()
                                .flat_map(|a| [a.label.as_str(), a.id.as_str()]),
                        )
                        .chain(t.configs.iter().map(|s| s.label.as_str()))
                })
                .chain(p.endpoint.iter().map(|v| v.label.as_str()))
                .collect()
        }
        Some(Body::Snippet(p)) => p.snippet.iter().map(|s| s.label.as_str()).collect(),
        Some(Body::CopyValue(p)) => p.value.iter().map(|v| v.label.as_str()).collect(),
        _ => return None,
    };
    if labels.iter().any(|label| label.len() > 16 * 1024) || panel.encoded_len() > 4 * 1024 * 1024 {
        return None;
    }
    Some(panel.encode_to_vec())
}

fn row_index(state: &PanelView, panel: &PanelDescriptor) -> Option<usize> {
    match &panel.body {
        Some(Body::Table(_)) => state.table_state.selected().filter(|index| {
            state
                .cached
                .as_ref()
                .is_some_and(|cache| *index < cache.rows.len())
        }),
        Some(Body::ResourceCards(_)) => state
            .cached_resource_cards
            .as_ref()
            .filter(|cache| cache.error.is_none() && state.content_selected < cache.rows.len())
            .map(|_| state.content_selected),
        Some(Body::Catalog(p)) => {
            (!p.items.is_empty()).then(|| state.content_selected % p.items.len())
        }
        Some(Body::Steps(p)) => {
            (!p.steps.is_empty()).then(|| state.content_selected % p.steps.len())
        }
        Some(Body::ConnectFlow(p)) => Some(state.content_selected % p.targets.len().max(1)),
        Some(Body::Action(_) | Body::Snippet(_) | Body::CopyValue(_)) => Some(0),
        _ => None,
    }
}

fn actions<'a>(
    panel: &'a PanelDescriptor,
    row: Option<&Value>,
    selected: usize,
) -> Vec<NativeAction<'a>> {
    match &panel.body {
        Some(Body::Table(table)) => match &table.affordances {
            Some(set) => set.items.iter().map(NativeAction::Canonical).collect(),
            None => vec![],
        },
        Some(Body::ResourceCards(cards)) => cards
            .template
            .as_ref()
            .and_then(|t| t.actions.as_ref())
            .into_iter()
            .flat_map(|set| &set.actions)
            .filter(|action| row.is_some_and(|row| content::resource_action_visible(action, row)))
            .map(NativeAction::Resource)
            .collect(),
        Some(Body::Action(p)) => p
            .action
            .iter()
            .map(|a| NativeAction::Canonical(a))
            .collect(),
        Some(Body::Catalog(p)) => p
            .items
            .get(selected)
            .and_then(|i| i.action.as_ref())
            .map(NativeAction::Canonical)
            .into_iter()
            .collect(),
        Some(Body::Steps(p)) => p
            .steps
            .get(selected)
            .and_then(|s| s.action.as_ref())
            .map(NativeAction::Canonical)
            .into_iter()
            .collect(),
        Some(Body::Snippet(p)) => p
            .snippet
            .iter()
            .map(|s| NativeAction::Copy(&s.content))
            .collect(),
        Some(Body::CopyValue(p)) => p
            .value
            .iter()
            .map(|v| NativeAction::Copy(&v.value))
            .collect(),
        Some(Body::ConnectFlow(p)) => p
            .targets
            .get(selected)
            .into_iter()
            .flat_map(|t| {
                t.actions
                    .iter()
                    .map(NativeAction::Canonical)
                    .chain(t.configs.iter().map(|s| NativeAction::Copy(&s.content)))
            })
            .chain(p.endpoint.iter().map(|v| NativeAction::Copy(&v.value)))
            .collect(),
        _ => vec![],
    }
}

/// Reconcile read lifetimes before a renderer can reuse old cached rows.
pub(super) fn begin(state: &mut PanelView, panel: &PanelDescriptor, context: &Context) -> bool {
    if !supports(panel) {
        if state.row_actions.frame.is_some() {
            state.invocations.cancel();
            state.row_actions.invalidate();
            state.cached = None;
            state.cached_resource_cards = None;
        }
        return true;
    }
    let scope = state
        .shared_form_scope
        .clone()
        .unwrap_or_else(|| state.current_form_scope(context).map(Arc::new));
    let (Some(scope), Some(descriptor)) = (scope, declaration(panel)) else {
        state.invocations.cancel();
        state.row_actions.invalidate();
        state.cached = None;
        state.cached_resource_cards = None;
        state.row_actions.feedback = Some(LIMIT);
        return false;
    };
    let changed = state
        .row_actions
        .frame
        .as_ref()
        .is_some_and(|old| old.descriptor != descriptor || old.scope != scope);
    if changed {
        state.invocations.cancel();
        state.row_actions.invalidate();
        state.cached = None;
        state.cached_resource_cards = None;
        state.table_state = TableState::default();
        state.content_selected = 0;
    }
    if state.row_actions.frame.is_none() {
        if let Some(Body::ConnectFlow(panel)) = &panel.body {
            state.content_selected = content::connect_selected_index(panel, 0);
        }
    }
    let old = state.row_actions.frame.take();
    state.row_actions.frame = Some(Frame {
        descriptor,
        scope,
        generation: state.row_actions.generation.clone(),
        row: old.as_ref().and_then(|f| f.row),
        action: old.as_ref().map_or(0, |f| f.action),
        rendered: old.as_ref().is_some_and(|f| f.rendered),
    });
    true
}

pub(super) fn finish(
    state: &mut PanelView,
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    panel: &PanelDescriptor,
) {
    if !supports(panel) || area.height == 0 {
        return;
    }
    let row = row_index(state, panel);
    let available = actions(panel, state.selected_row(), row.unwrap_or(0));
    state.row_actions.selected = state
        .row_actions
        .selected
        .min(available.len().saturating_sub(1));
    if let Some(captured) = state.row_actions.frame.as_mut() {
        if captured.rendered
            && (captured.row != row || captured.action != state.row_actions.selected)
        {
            state.invocations.cancel();
        }
        captured.row = row;
        captured.action = state.row_actions.selected;
        captured.generation = state.row_actions.generation.clone();
        captured.rendered = state.invocation_visible;
    }
    let authored = match &panel.body {
        Some(Body::Table(table)) => table.affordances.is_some(),
        Some(Body::ResourceCards(cards)) => cards
            .template
            .as_ref()
            .and_then(|t| t.actions.as_ref())
            .is_some_and(|set| !set.actions.is_empty()),
        _ => content_control(panel) && !available.is_empty(),
    };
    if !authored && state.row_actions.feedback.is_none() {
        return;
    }
    let mut line = if let Some(action) = available.get(state.row_actions.selected) {
        let mut line = match action {
            NativeAction::Canonical(action) => content::affordance_line(action, &state.palette),
            NativeAction::Resource(action) => Line::styled(
                action.label.clone(),
                content::resource_action_style(action, &state.palette),
            ),
            NativeAction::Copy(_) => {
                Line::styled("Copy literal [value hidden]", state.palette.title())
            }
            _ => unreachable!("only panel actions"),
        };
        line.spans.insert(
            0,
            Span::styled(
                format!("[{}/{}] ", state.row_actions.selected + 1, available.len()),
                state.palette.meta(),
            ),
        );
        line.spans
            .push(Span::styled(" · ←/→ action · Enter", state.palette.meta()));
        let filter = match action {
            NativeAction::Canonical(action) => action.enabled_when.as_ref(),
            _ => None,
        };
        if filter.is_some_and(|filter| {
            state
                .selected_row()
                .is_none_or(|row| meridian_uiview::row_filter_matches(filter, row) != Ok(true))
        }) {
            line.spans
                .push(Span::styled(" [disabled]", state.palette.meta()));
        }
        if row.is_none() && row_control(panel) {
            line.spans
                .push(Span::styled(" [select a row]", state.palette.meta()));
        }
        line
    } else {
        Line::styled(
            if row.is_none() {
                "Select a row to run an action."
            } else {
                "No actions for the current row."
            },
            state.palette.meta(),
        )
    };
    // Feedback is fixed text; canonical copy values are never in presentation.
    if line.spans.is_empty() {
        line = Line::from("Action");
    }
    let footer = ratatui::layout::Rect {
        y: area.y + area.height - 1,
        height: 1,
        ..area
    };
    frame.render_widget(ratatui::widgets::Clear, footer);
    frame.render_widget(Paragraph::new(line), footer);
    // Never replace the mounted action's label with feedback: a newly selected
    // target must be visible before its next activation can be considered current.
    if area.height > 2 {
        if let Some(message) = state.row_actions.feedback {
            frame.render_widget(
                ratatui::widgets::Clear,
                ratatui::layout::Rect {
                    y: area.y + 1,
                    height: 1,
                    ..area
                },
            );
            frame.render_widget(
                Paragraph::new(message).style(state.palette.meta()),
                ratatui::layout::Rect {
                    y: area.y + 1,
                    height: 1,
                    ..area
                },
            );
        }
    }
}

impl PanelView {
    /// Whether this descriptor exposes controls handled by the explicit native
    /// action event path. This inspects shape only and grants no capability.
    pub fn has_action_controls(panel: &PanelDescriptor) -> bool {
        supports(panel)
    }

    /// Event-only effects from current row/content controls. Up/Down selects
    /// subjects, Left/Right selects actions, Enter/Space activates; `c` activates
    /// only selected content copies. Resource cards also expose their displayed
    /// 1–9 action shortcuts. No default transport or invented ID binding.
    pub fn handle_action_key_with_invocation(
        &mut self,
        panel: &PanelDescriptor,
        context: &Context,
        key: KeyEvent,
        host: &NativeInvocationHost<'_>,
    ) -> Option<NativeInvocationOutcome> {
        if key.kind != KeyEventKind::Press || !supports(panel) {
            return None;
        }
        match key.code {
            KeyCode::Up => {
                self.select_prev();
                return None;
            }
            KeyCode::Down => {
                self.select_next();
                return None;
            }
            _ => {}
        }
        let current_scope = self.current_form_scope(context);
        let source = declaration(panel);
        let current_row = row_index(self, panel);
        let source_valid = self.row_actions.frame.as_ref().is_some_and(|old| {
            self.invocation_visible
                && old.rendered
                && Some(&old.descriptor) == source.as_ref()
                && Some(old.scope.as_ref()) == current_scope.as_ref()
                && Arc::ptr_eq(&old.generation, &self.row_actions.generation)
        });
        if !source_valid {
            self.invocations.cancel();
            self.row_actions.feedback = Some(STALE);
            return None;
        }
        let available = actions(panel, self.selected_row(), current_row.unwrap_or(0));
        if matches!(key.code, KeyCode::Left | KeyCode::Right) {
            if !available.is_empty() {
                self.row_actions.selected = if key.code == KeyCode::Left {
                    (self.row_actions.selected + available.len() - 1) % available.len()
                } else {
                    (self.row_actions.selected + 1) % available.len()
                };
            }
            self.invocations.cancel();
            self.row_actions.feedback = None;
            return None;
        }
        if !self
            .row_actions
            .frame
            .as_ref()
            .is_some_and(|old| old.row == current_row && old.action == self.row_actions.selected)
        {
            self.invocations.cancel();
            self.row_actions.feedback = Some(STALE);
            return None;
        }
        let selected = match key.code {
            KeyCode::Enter | KeyCode::Char(' ') => self.row_actions.selected,
            KeyCode::Char('c') if content_control(panel) => self.row_actions.selected,
            KeyCode::Char(c @ '1'..='9') if matches!(panel.body, Some(Body::ResourceCards(_))) => {
                (c as u8 - b'1') as usize
            }
            _ => return None,
        };
        let Some(action) = available.get(selected).copied() else {
            self.row_actions.feedback = Some(NativeInvocationOutcome::Denied.message());
            return Some(NativeInvocationOutcome::Denied);
        };
        if key.code == KeyCode::Char('c')
            && !matches!(
                action,
                NativeAction::Copy(_)
                    | NativeAction::Canonical(meridian_uiview::proto::Affordance {
                        invoke: Some(meridian_uiview::proto::affordance::Invoke::Copy(_)),
                        ..
                    })
            )
        {
            return None;
        }
        let Some(row) = current_row else {
            self.row_actions.feedback = Some(NativeInvocationOutcome::Denied.message());
            return Some(NativeInvocationOutcome::Denied);
        };
        if self
            .row_actions
            .completed_refresh
            .contains(&(row, selected))
        {
            self.row_actions.feedback = Some(NativeInvocationOutcome::RefreshFailed.message());
            return None;
        }
        if self.row_actions.completed_refresh.len() >= 1_000 {
            self.row_actions.feedback = Some("Refresh is required before running another action.");
            return None;
        }
        let outcome = self.invocations.invoke(
            action,
            NativeInvocationContext::new(context).with_record(if row_control(panel) {
                self.selected_row()
            } else {
                self.ambient_record.as_deref()
            }),
            host,
        );
        self.row_actions.selected = selected;
        self.row_actions.feedback = Some(outcome.message());
        if outcome == NativeInvocationOutcome::RefreshFailed {
            self.row_actions.completed_refresh.insert((row, selected));
        }
        Some(outcome)
    }
}
