// Terminal renderer for `meridian.ui.v1.Launchpad` — the command palette.
//
// The TUI peer of @savvifi/meridian-launchpad's React `<Launchpad>`: the SAME
// descriptor, filtered by the SAME ranking (meridian_uiview::filter_launchpad —
// the shared core, not a second implementation), painted with ratatui instead of
// the DOM. This is what "modality-neutral" has to cash out to: a Launchpad
// projected from host compositions renders in the terminal with no contract
// change and no re-ranking.
//
// Like the rest of the TUI, EVERY color/modifier comes from the `Palette`, so
// one skin drives the terminal look identically to the web.
//
// Modality mapping (the web overlay has no terminal analog, so):
//   * the ⌘K overlay      → a bordered box the host places (or the full screen
//                           in the one-shot `render_launchpad`).
//   * the search input    → a query line with a block cursor.
//   * groups              → dim uppercase section headings.
//   * the selected row    → palette.selection() (an accent fill), as the web
//                           renderer's `data-active` row is.
//   * icons               → `glyph()` (the shared terminal icon seam).
//
// The palette PICKS; the host authorizes and RUNS. The explicit invocation path
// uses the shared native dispatcher and supplies no default transport or raw
// response handoff.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_uiview::proto::{Affordance, Command, Launchpad};
use meridian_uiview::{filter_launchpad, flatten, Context, FilteredGroup};
use prost::Message;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;
use std::sync::Arc;

use crate::content::glyph;
use crate::theme::Palette;
use crate::{
    NativeAction, NativeInvocationContext, NativeInvocationDispatcher, NativeInvocationHost,
    NativeInvocationOutcome,
};

/// The id of the synthetic group holding agent-resolved commands. Mirrors the
/// React renderer's `__agent__` group.
pub const AGENT_GROUP_ID: &str = "__agent__";

/// Inspection of authored canonical intent, never permission to execute it.
#[derive(Debug, Clone, PartialEq)]
pub enum LaunchpadOutcome<'a> {
    /// Typed intent only, never an admission grant.
    Canonical(&'a Affordance),
    /// The command carries no canonical intent.
    None,
}

/// Decode a command's action for the host to run.
pub fn command_outcome(command: &Command) -> LaunchpadOutcome<'_> {
    if let Some(action) = &command.affordance {
        return LaunchpadOutcome::Canonical(action);
    }
    LaunchpadOutcome::None
}

/// Why the palette closed.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum LaunchpadResponse {
    /// The user ran a command. Decode it with [`command_outcome`].
    Run(Command),
    /// Esc — the host should dismiss without running anything.
    Cancelled,
}

/// The admitted path never returns a raw command for the host to execute again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeLaunchpadResponse {
    Executed,
    Cancelled,
}

/// Runtime-only identity for one palette instance and query generation.
/// A stale asynchronous resolution cannot populate a newer or reopened query.
#[derive(Clone)]
pub struct NativeLaunchpadQueryToken(Arc<()>);

#[derive(Clone, PartialEq, Eq)]
struct InvocationFrame {
    descriptor: Vec<u8>,
    agent: Vec<u8>,
    context: Vec<u8>,
    query: String,
    active: usize,
}

const INVOCATION_LIMIT: &str = "Command denied: palette or context limit exceeded.";
const INVOCATION_STALE: &str =
    "Command stopped because its source or context changed; redraw before retrying.";

fn bounded_commands(descriptor: &Launchpad, agent: &[Command]) -> bool {
    let mut count = descriptor
        .groups
        .len()
        .saturating_add(agent.len())
        .saturating_add(descriptor.default_command_ids.len());
    if count > 1_000 {
        return false;
    }
    for group in &descriptor.groups {
        count = count.saturating_add(group.commands.len());
        if count > 1_000 {
            return false;
        }
        for command in &group.commands {
            count = count.saturating_add(command.keywords.len());
            if count > 1_000 {
                return false;
            }
        }
    }
    for command in agent {
        count = count.saturating_add(command.keywords.len());
        if count > 1_000 {
            return false;
        }
    }
    let mut bytes = descriptor.encoded_len();
    for command in agent {
        bytes = bytes
            .saturating_add(command.encoded_len())
            .saturating_add(10);
    }
    bytes <= 4 * 1024 * 1024
}

/// The palette's live state: the query, the cursor, and any agent-resolved
/// commands. Hosts drive it inside their own event loop, without a TTY in tests.
/// Drawing/filtering are pure; only explicit invocation events can run capabilities.
pub struct LaunchpadState {
    query: String,
    active: usize,
    agent_commands: Vec<Command>,
    agent_group_title: String,
    invocations: NativeInvocationDispatcher,
    invocation_frame: Option<InvocationFrame>,
    completed: bool,
    feedback: Option<&'static str>,
    query_token: NativeLaunchpadQueryToken,
}

impl std::fmt::Debug for LaunchpadState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LaunchpadState")
            .field("active", &self.active)
            .field("agent_commands", &self.agent_commands.len())
            .finish_non_exhaustive()
    }
}

impl Clone for LaunchpadState {
    fn clone(&self) -> Self {
        // A new UI owner cannot inherit another owner's in-flight effects or tokens.
        let mut copy = Self::default();
        copy.query = self.query.clone();
        copy.active = self.active;
        copy.agent_commands = self.agent_commands.clone();
        copy.agent_group_title = self.agent_group_title.clone();
        copy
    }
}

impl Drop for LaunchpadState {
    fn drop(&mut self) {
        self.invocations.cancel();
    }
}

impl Default for LaunchpadState {
    fn default() -> Self {
        Self {
            query: String::new(),
            active: 0,
            agent_commands: Vec::new(),
            agent_group_title: "Ask the agent".into(),
            invocations: NativeInvocationDispatcher::default(),
            invocation_frame: None,
            completed: false,
            feedback: None,
            query_token: NativeLaunchpadQueryToken(Arc::new(())),
        }
    }
}

impl LaunchpadState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Override the heading for agent-resolved commands.
    pub fn with_agent_group_title(mut self, title: impl Into<String>) -> Self {
        self.invalidate_invocation();
        self.agent_group_title = title.into();
        self
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    /// Replace the query (resets the cursor to the first row, as typing does).
    pub fn set_query(&mut self, query: impl Into<String>) {
        let query = query.into();
        if query != self.query {
            self.agent_commands.clear();
            self.query_token = NativeLaunchpadQueryToken(Arc::new(()));
        }
        self.invalidate_invocation();
        self.query = query;
        self.active = 0;
    }

    pub fn active(&self) -> usize {
        self.active
    }

    /// The AI-launchpad seam: the peer of the React renderer's `onResolveQuery`.
    /// A terminal host can't await inside `on_key`, so the async half stays the
    /// host's business — it resolves the query against its agent however it
    /// likes (thread, channel, its own runtime). This compatibility setter is for
    /// synchronous current-query data; async replies must use the query token API.
    pub fn set_agent_commands(&mut self, commands: Vec<Command>) {
        self.invalidate_invocation();
        if bounded_commands(&Launchpad::default(), &commands) {
            self.agent_commands = commands;
        } else {
            self.agent_commands.clear();
            self.feedback = Some(INVOCATION_LIMIT);
        }
        // The list under the cursor just changed shape; keep it in range.
        self.active = 0;
    }

    pub fn query_token(&self) -> NativeLaunchpadQueryToken {
        self.query_token.clone()
    }

    pub fn set_agent_commands_for_query(
        &mut self,
        token: &NativeLaunchpadQueryToken,
        commands: Vec<Command>,
    ) -> bool {
        if !Arc::ptr_eq(&token.0, &self.query_token.0) {
            return false;
        }
        self.set_agent_commands(commands);
        self.feedback.is_none()
    }

    /// Withdraw the mounted invocation frame and cancel observation.
    pub fn invalidate_invocation(&mut self) {
        self.invocations.cancel();
        self.invocation_frame = None;
        self.completed = false;
        self.feedback = None;
    }

    pub fn invocation_dispatcher(&self) -> NativeInvocationDispatcher {
        self.invocations.clone()
    }

    /// End this open/query generation. Old async agent replies cannot reopen it.
    pub fn close(&mut self) {
        self.invalidate_invocation();
        self.agent_commands.clear();
        self.query_token = NativeLaunchpadQueryToken(Arc::new(()));
    }

    fn capture(&self, descriptor: &Launchpad, context: &Context) -> Result<InvocationFrame, ()> {
        if self.query.len() > 16 * 1024
            || self.agent_group_title.len() > 16 * 1024
            || !bounded_commands(descriptor, &self.agent_commands)
        {
            return Err(());
        }
        let context = crate::invocation::context_key(NativeInvocationContext::new(context))?;
        let mut agent = Vec::new();
        for command in &self.agent_commands {
            command
                .encode_length_delimited(&mut agent)
                .map_err(|_| ())?;
        }
        Ok(InvocationFrame {
            descriptor: descriptor.encode_to_vec(),
            agent,
            context,
            query: self.query.clone(),
            active: self.active,
        })
    }

    /// Capture the current bounded frame. Draw/filter never invokes host callbacks.
    pub fn draw_with_invocation(
        &mut self,
        frame: &mut Frame,
        area: Rect,
        descriptor: &Launchpad,
        context: &Context,
        palette: &Palette,
    ) {
        let Ok(current) = self.capture(descriptor, context) else {
            self.invalidate_invocation();
            self.feedback = Some(INVOCATION_LIMIT);
            frame.render_widget(Paragraph::new(INVOCATION_LIMIT), area);
            return;
        };
        if self.invocation_frame.as_ref() != Some(&current) {
            self.invocations.cancel();
            self.completed = false;
            if self.invocation_frame.is_some() {
                self.feedback = None;
            }
        }
        self.invocation_frame = Some(current);
        self.draw(frame, area, descriptor, palette);
    }

    /// Execute only the command from the currently drawn frame. Success closes;
    /// denial, failure, or refresh failure stays open with fixed feedback.
    pub fn on_key_with_invocation(
        &mut self,
        key: KeyEvent,
        descriptor: &Launchpad,
        context: &Context,
        host: &NativeInvocationHost<'_>,
    ) -> Option<NativeLaunchpadResponse> {
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if key.code != KeyCode::Enter {
            let cancel = key.code == KeyCode::Esc
                || (key.modifiers.contains(KeyModifiers::CONTROL)
                    && matches!(key.code, KeyCode::Char('c' | 'C')));
            if !cancel
                && key.code != KeyCode::Backspace
                && (self.query.len() > 16 * 1024
                    || self.agent_group_title.len() > 16 * 1024
                    || !bounded_commands(descriptor, &self.agent_commands))
            {
                self.invalidate_invocation();
                self.feedback = Some(INVOCATION_LIMIT);
                return None;
            }
            return self
                .on_key(key, descriptor)
                .and_then(|response| match response {
                    LaunchpadResponse::Cancelled => Some(NativeLaunchpadResponse::Cancelled),
                    LaunchpadResponse::Run(_) => None,
                });
        }
        let current = self.capture(descriptor, context).ok();
        if current.is_none() || current != self.invocation_frame {
            self.invalidate_invocation();
            self.feedback = Some(INVOCATION_STALE);
            return None;
        }
        if self.completed {
            return None;
        }
        let command = self.selected(descriptor)?;
        let outcome = self.invocations.invoke(
            NativeAction::Command(command),
            NativeInvocationContext::new(context),
            host,
        );
        self.feedback = Some(outcome.message());
        self.completed = matches!(
            outcome,
            NativeInvocationOutcome::Succeeded | NativeInvocationOutcome::RefreshFailed
        );
        if outcome == NativeInvocationOutcome::Succeeded {
            self.query_token = NativeLaunchpadQueryToken(Arc::new(()));
        }
        (outcome == NativeInvocationOutcome::Succeeded).then_some(NativeLaunchpadResponse::Executed)
    }

    pub fn agent_commands(&self) -> &[Command] {
        &self.agent_commands
    }

    /// The filtered, ranked groups for the current query: the descriptor's
    /// groups (via the shared core) plus the agent group, if any.
    pub fn groups<'a>(&'a self, descriptor: &'a Launchpad) -> Vec<FilteredGroup<'a>> {
        let mut groups = filter_launchpad(descriptor, &self.query);
        if !self.agent_commands.is_empty() {
            groups.push(FilteredGroup {
                id: AGENT_GROUP_ID,
                title: &self.agent_group_title,
                // Already resolved FOR this query — surfaced as-is, not re-filtered.
                commands: self.agent_commands.iter().collect(),
            });
        }
        groups
    }

    /// The flat, keyboard-navigable command order.
    pub fn commands<'a>(&'a self, descriptor: &'a Launchpad) -> Vec<&'a Command> {
        flatten(&self.groups(descriptor))
    }

    /// The command under the cursor.
    pub fn selected<'a>(&'a self, descriptor: &'a Launchpad) -> Option<&'a Command> {
        self.commands(descriptor).get(self.active).copied()
    }

    fn move_by(&mut self, delta: isize, len: usize) {
        if len == 0 {
            self.active = 0;
            return;
        }
        let len = len as isize;
        self.active = (((self.active as isize + delta) % len + len) % len) as usize;
    }

    /// Handle one key. Returns `Some(..)` when the palette should close.
    ///
    /// The keyboard model mirrors the React renderer: ↑/↓ move (wrapping), Enter
    /// runs, Esc cancels, printable characters type, Backspace deletes.
    pub fn on_key(&mut self, key: KeyEvent, descriptor: &Launchpad) -> Option<LaunchpadResponse> {
        // Ignore key-up / repeat echoes on backends that emit them (Windows).
        if key.kind != KeyEventKind::Press {
            return None;
        }
        match key.code {
            KeyCode::Esc => {
                self.close();
                return Some(LaunchpadResponse::Cancelled);
            }
            KeyCode::Enter => {
                if self
                    .selected(descriptor)
                    .is_some_and(|c| c.affordance.is_some())
                {
                    self.feedback = Some(NativeInvocationOutcome::Denied.message());
                    return None;
                }
                let chosen = self.selected(descriptor).cloned();
                return chosen.map(LaunchpadResponse::Run);
            }
            KeyCode::Down => {
                let len = self.commands(descriptor).len();
                self.move_by(1, len);
                self.invalidate_invocation();
            }
            KeyCode::Up => {
                let len = self.commands(descriptor).len();
                self.move_by(-1, len);
                self.invalidate_invocation();
            }
            KeyCode::Backspace => {
                let mut query = self.query.clone();
                query.pop();
                self.set_query(query);
            }
            KeyCode::Char(c) => {
                // Ctrl-C is the host's quit gesture, not a query character.
                if key.modifiers.contains(KeyModifiers::CONTROL) && (c == 'c' || c == 'C') {
                    return self
                        .on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE), descriptor);
                }
                if !key.modifiers.contains(KeyModifiers::CONTROL) {
                    let mut query = self.query.clone();
                    query.push(c);
                    self.set_query(query);
                }
            }
            _ => {}
        }
        None
    }

    /// Draw the palette into `area`.
    pub fn draw(&self, frame: &mut Frame, area: Rect, descriptor: &Launchpad, palette: &Palette) {
        let outer = Block::default()
            .borders(Borders::ALL)
            .border_style(palette.border_style())
            .style(palette.text());
        let inner = outer.inner(area);
        frame.render_widget(Clear, area);
        frame.render_widget(outer, area);

        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Min(0),
            ])
            .split(inner);

        frame.render_widget(
            Paragraph::new(self.query_line(descriptor, palette)),
            rows[0],
        );
        frame.render_widget(
            Paragraph::new(Line::styled(
                "─".repeat(inner.width as usize),
                palette.border_style(),
            )),
            rows[1],
        );
        frame.render_widget(
            Paragraph::new(self.list_lines(descriptor, palette)),
            rows[2],
        );
        if let Some(feedback) = self.feedback {
            if inner.height > 0 {
                frame.render_widget(
                    Paragraph::new(feedback).style(palette.meta()),
                    Rect {
                        y: inner.y + inner.height - 1,
                        height: 1,
                        ..inner
                    },
                );
            }
        }
    }

    /// The query line: the typed text plus a block cursor, or the descriptor's
    /// placeholder while empty.
    fn query_line(&self, descriptor: &Launchpad, palette: &Palette) -> Line<'static> {
        if self.query.is_empty() {
            let placeholder = if descriptor.placeholder.is_empty() {
                "Search or jump to…"
            } else {
                &descriptor.placeholder
            };
            return Line::from(vec![
                Span::styled("› ", palette.title()),
                Span::styled(placeholder.to_string(), palette.meta()),
            ]);
        }
        Line::from(vec![
            Span::styled("› ", palette.title()),
            Span::styled(self.query.clone(), palette.text()),
            Span::styled("▏", palette.title()),
        ])
    }

    /// The group headings + command rows, in keyboard order.
    fn list_lines(&self, descriptor: &Launchpad, palette: &Palette) -> Vec<Line<'static>> {
        let groups = self.groups(descriptor);
        if groups.is_empty() {
            return vec![Line::styled("  No matching commands", palette.meta())];
        }
        let mut lines = Vec::new();
        // The cursor indexes the FLAT order, so walk the groups in the same order
        // `flatten` does and count as we go.
        let mut index = 0usize;
        for group in &groups {
            if !group.title.is_empty() {
                lines.push(Line::styled(
                    format!(" {} ", group.title.to_uppercase()),
                    palette.meta(),
                ));
            }
            for command in &group.commands {
                lines.push(command_line(command, index == self.active, palette));
                index += 1;
            }
        }
        lines
    }
}

/// One command row: `▸ ◆ Title — subtitle            shortcut`.
fn command_line(command: &Command, active: bool, palette: &Palette) -> Line<'static> {
    let style = if active {
        palette.selection()
    } else {
        palette.text()
    };
    let meta = if active { style } else { palette.meta() };

    let mut spans = vec![Span::styled(if active { " ▸ " } else { "   " }, style)];
    if !command.icon.is_empty() {
        spans.push(Span::styled(format!("{} ", glyph(&command.icon)), meta));
    }
    spans.push(Span::styled(command.title.clone(), style));
    if !command.subtitle.is_empty() {
        spans.push(Span::styled(format!("  {}", command.subtitle), meta));
    }
    if !command.shortcut.is_empty() {
        spans.push(Span::styled(format!("   {}", command.shortcut), meta));
    }
    Line::from(spans)
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::{CommandGroup, Navigate};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn command(id: &str, title: &str) -> Command {
        Command {
            id: id.into(),
            title: title.into(),
            ..Default::default()
        }
    }

    fn demo() -> Launchpad {
        Launchpad {
            groups: vec![
                CommandGroup {
                    id: "create".into(),
                    title: "Create".into(),
                    commands: vec![
                        command("new-product", "New product"),
                        command("new-order", "New order"),
                    ],
                },
                CommandGroup {
                    id: "navigate".into(),
                    title: "Navigate".into(),
                    commands: vec![command("products", "Products")],
                },
            ],
            placeholder: "Search or jump to…".into(),
            default_command_ids: vec![],
        }
    }

    #[test]
    fn typing_filters_through_the_shared_core() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        for c in "prod".chars() {
            state.on_key(key(KeyCode::Char(c)), &descriptor);
        }
        let ids: Vec<&str> = state
            .commands(&descriptor)
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        // Exactly the ranking meridian_uiview::filter_launchpad produces — the
        // same one the React renderer shows.
        assert_eq!(ids, vec!["new-product", "products"]);
    }

    #[test]
    fn backspace_widens_the_result_set() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        for c in "prod".chars() {
            state.on_key(key(KeyCode::Char(c)), &descriptor);
        }
        assert_eq!(state.commands(&descriptor).len(), 2);
        state.on_key(key(KeyCode::Backspace), &descriptor);
        assert_eq!(state.query(), "pro");
        state.on_key(key(KeyCode::Backspace), &descriptor);
        state.on_key(key(KeyCode::Backspace), &descriptor);
        state.on_key(key(KeyCode::Backspace), &descriptor);
        assert_eq!(state.query(), "");
        assert_eq!(state.commands(&descriptor).len(), 3);
    }

    #[test]
    fn arrows_move_the_cursor_and_wrap() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        assert_eq!(state.active(), 0);
        state.on_key(key(KeyCode::Down), &descriptor);
        assert_eq!(state.active(), 1);
        // 3 commands: wrap forward off the end…
        state.on_key(key(KeyCode::Down), &descriptor);
        state.on_key(key(KeyCode::Down), &descriptor);
        assert_eq!(state.active(), 0);
        // …and backward off the front.
        state.on_key(key(KeyCode::Up), &descriptor);
        assert_eq!(state.active(), 2);
    }

    #[test]
    fn enter_runs_the_selected_command() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        state.on_key(key(KeyCode::Down), &descriptor);
        match state.on_key(key(KeyCode::Enter), &descriptor) {
            Some(LaunchpadResponse::Run(c)) => assert_eq!(c.id, "new-order"),
            other => panic!("expected Run, got {other:?}"),
        }
    }

    #[test]
    fn esc_cancels() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        assert_eq!(
            state.on_key(key(KeyCode::Esc), &descriptor),
            Some(LaunchpadResponse::Cancelled)
        );
    }

    #[test]
    fn enter_on_an_empty_result_set_does_not_close() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        state.set_query("zzzz");
        assert!(state.commands(&descriptor).is_empty());
        assert_eq!(state.on_key(key(KeyCode::Enter), &descriptor), None);
    }

    #[test]
    fn agent_commands_surface_as_a_trailing_group_and_run() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        state.set_query("failing builds");
        // Nothing local matches…
        assert!(state.commands(&descriptor).is_empty());
        // …until the host's agent resolves the query.
        let mut agent = command("agent-1", "Agent: open failing builds");
        agent.affordance = Some(Affordance {
            invoke: Some(meridian_uiview::proto::affordance::Invoke::Navigate(
                Navigate {
                    route: "/builds?status=failing".into(),
                },
            )),
            ..Default::default()
        });
        state.set_agent_commands(vec![agent]);

        let groups = state.groups(&descriptor);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, AGENT_GROUP_ID);
        assert_eq!(groups[0].title, "Ask the agent");

        let calls = std::cell::Cell::new(0);
        let effect =
            |route: &Navigate, _: NativeInvocationContext<'_>, _: &crate::NativeCancellation| {
                assert_eq!(route.route, "/builds?status=failing");
                calls.set(calls.get() + 1);
                Ok(())
            };
        let allow = |_: crate::NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            navigate: Some(&effect),
            admit: Some(&allow),
            ..Default::default()
        };
        let context = Context::default();
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 20)).unwrap();
        terminal
            .draw(|f| {
                state.draw_with_invocation(f, f.area(), &descriptor, &context, &Palette::default())
            })
            .unwrap();
        assert_eq!(calls.get(), 0, "drawing cannot navigate");
        assert_eq!(
            state.on_key_with_invocation(key(KeyCode::Enter), &descriptor, &context, &host),
            Some(NativeLaunchpadResponse::Executed)
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn agent_commands_are_not_re_filtered_by_the_query() {
        // They were resolved FOR this query; re-running the subsequence filter
        // over them would drop anything not literally spelling the query.
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        state.set_query("zzzz");
        state.set_agent_commands(vec![command("agent-1", "Open the deploy dashboard")]);
        assert_eq!(state.commands(&descriptor).len(), 1);
    }

    #[test]
    fn ctrl_c_cancels_rather_than_typing() {
        let descriptor = demo();
        let mut state = LaunchpadState::new();
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            state.on_key(ctrl_c, &descriptor),
            Some(LaunchpadResponse::Cancelled)
        );
        assert_eq!(state.query(), "");
    }

    #[test]
    fn command_outcome_decodes_each_action_arm() {
        let mut c = command("x", "X");
        assert_eq!(command_outcome(&c), LaunchpadOutcome::None);
        c.affordance = Some(Affordance {
            invoke: Some(meridian_uiview::proto::affordance::Invoke::OpenView(
                "products".into(),
            )),
            ..Default::default()
        });
        assert_eq!(
            command_outcome(&c),
            LaunchpadOutcome::Canonical(c.affordance.as_ref().unwrap())
        );
        c.affordance = Some(Affordance {
            invoke: Some(meridian_uiview::proto::affordance::Invoke::Rpc(
                meridian_uiview::proto::RpcCall::default(),
            )),
            ..Default::default()
        });
        assert!(matches!(
            command_outcome(&c),
            LaunchpadOutcome::Canonical(_)
        ));
    }

    #[test]
    fn canonical_presence_never_decodes_a_legacy_navigation_trap() {
        let mut wire = Command {
            affordance: Some(meridian_uiview::proto::Affordance::default()),
            ..command("same", "Canonical empty intent")
        }
        .encode_to_vec();
        let old_navigation = Navigate {
            route: "/legacy-trap".into(),
        }
        .encode_to_vec();
        prost::encoding::encode_key(11, prost::encoding::WireType::LengthDelimited, &mut wire);
        prost::encoding::encode_varint(old_navigation.len() as u64, &mut wire);
        wire.extend_from_slice(&old_navigation);
        let c = Command::decode(wire.as_slice()).unwrap();
        let LaunchpadOutcome::Canonical(action) = command_outcome(&c) else {
            panic!("canonical presence lost")
        };
        assert!(action.invoke.is_none());
    }

    #[test]
    fn ordinary_palette_does_not_return_an_unadmitted_canonical_command() {
        let descriptor = Launchpad {
            groups: vec![CommandGroup {
                commands: vec![Command {
                    affordance: Some(meridian_uiview::proto::Affordance::default()),
                    ..command("canonical", "Canonical empty intent")
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(LaunchpadState::new()
            .on_key(key(KeyCode::Enter), &descriptor)
            .is_none());
    }

    #[test]
    fn default_command_ids_lead_the_empty_query_view() {
        let mut descriptor = demo();
        descriptor.default_command_ids = vec!["products".into()];
        let state = LaunchpadState::new();
        let groups = state.groups(&descriptor);
        assert_eq!(groups[0].id, "__default__");
        assert_eq!(
            state.selected(&descriptor).map(|c| c.id.as_str()),
            Some("products")
        );
    }
}
