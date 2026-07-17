// Terminal renderer for `meridian.ui.v1.Launchpad` — the command palette.
//
// The TUI peer of @savvifi/meridian-launchpad's React `<Launchpad>`: the SAME
// descriptor, filtered by the SAME ranking (meridian_uiview::filter_launchpad —
// the shared core, not a second implementation), painted with ratatui instead of
// the DOM. This is what "modality-neutral" has to cash out to: a Launchpad
// projected from aion compositions renders in the terminal with no contract
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
// The palette PICKS; the host RUNS. A terminal host already owns the transport
// (`RpcInvoker`) and the panel loop (`PanelView` / `render_prompt`), so this
// renderer decodes the chosen `Command.action` into a `LaunchpadOutcome` and
// hands it back rather than dispatching — the one place it deliberately differs
// from the React tier, which dispatches through the provider seam it sits in.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_uiview::proto::{command::Action, Command, Launchpad, PanelDescriptor, RpcCall};
use meridian_uiview::{filter_launchpad, flatten, FilteredGroup};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

use crate::content::glyph;
use crate::theme::Palette;

/// The id of the synthetic group holding agent-resolved commands. Mirrors the
/// React renderer's `__agent__` group.
pub const AGENT_GROUP_ID: &str = "__agent__";

/// What running the chosen command does, decoded from `Command.action`. The peer
/// of the React renderer's dispatch switch — the host runs it: `Rpc` through its
/// `RpcInvoker`, `OpenPanel` through `PanelView` / `render_prompt`, `OpenViewId`
/// / `Navigate` through its own router.
#[derive(Debug, Clone, PartialEq)]
pub enum LaunchpadOutcome<'a> {
    Rpc(&'a RpcCall),
    OpenPanel(&'a PanelDescriptor),
    OpenViewId(&'a str),
    Navigate(&'a str),
    /// The command carries no action (or an OpenPanel with no panel) — the host
    /// should close without running anything.
    None,
}

/// Decode a command's action for the host to run.
pub fn command_outcome(command: &Command) -> LaunchpadOutcome<'_> {
    match command.action.as_ref() {
        Some(Action::Rpc(call)) => LaunchpadOutcome::Rpc(call),
        Some(Action::OpenPanel(open)) => match open.panel.as_ref() {
            Some(panel) => LaunchpadOutcome::OpenPanel(panel),
            None => LaunchpadOutcome::None,
        },
        Some(Action::OpenViewId(id)) => LaunchpadOutcome::OpenViewId(id),
        Some(Action::Navigate(nav)) => LaunchpadOutcome::Navigate(&nav.route),
        None => LaunchpadOutcome::None,
    }
}

/// Why the palette closed.
#[derive(Debug, Clone, PartialEq)]
pub enum LaunchpadResponse {
    /// The user ran a command. Decode it with [`command_outcome`].
    Run(Command),
    /// Esc — the host should dismiss without running anything.
    Cancelled,
}

/// The palette's live state: the query, the cursor, and any agent-resolved
/// commands. Pure — no terminal, no I/O — so a host can drive it inside its own
/// event loop (`on_key` + `draw`), and so it is testable without a TTY.
#[derive(Debug, Clone)]
pub struct LaunchpadState {
    query: String,
    active: usize,
    agent_commands: Vec<Command>,
    agent_group_title: String,
}

impl Default for LaunchpadState {
    fn default() -> Self {
        Self {
            query: String::new(),
            active: 0,
            agent_commands: Vec::new(),
            agent_group_title: "Ask the agent".into(),
        }
    }
}

impl LaunchpadState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Override the heading for agent-resolved commands.
    pub fn with_agent_group_title(mut self, title: impl Into<String>) -> Self {
        self.agent_group_title = title.into();
        self
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    /// Replace the query (resets the cursor to the first row, as typing does).
    pub fn set_query(&mut self, query: impl Into<String>) {
        self.query = query.into();
        self.active = 0;
    }

    pub fn active(&self) -> usize {
        self.active
    }

    /// The AI-launchpad seam: the peer of the React renderer's `onResolveQuery`.
    /// A terminal host can't await inside `on_key`, so the async half stays the
    /// host's business — it resolves the query against its agent however it
    /// likes (thread, channel, its own runtime) and hands the commands here; they
    /// surface under a trailing agent group and run through the same dispatch.
    pub fn set_agent_commands(&mut self, commands: Vec<Command>) {
        self.agent_commands = commands;
        // The list under the cursor just changed shape; keep it in range.
        self.active = 0;
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
    pub fn on_key(
        &mut self,
        key: KeyEvent,
        descriptor: &Launchpad,
    ) -> Option<LaunchpadResponse> {
        // Ignore key-up / repeat echoes on backends that emit them (Windows).
        if key.kind != KeyEventKind::Press {
            return None;
        }
        let len = self.commands(descriptor).len();
        match key.code {
            KeyCode::Esc => return Some(LaunchpadResponse::Cancelled),
            KeyCode::Enter => {
                let chosen = self.selected(descriptor).cloned();
                return chosen.map(LaunchpadResponse::Run);
            }
            KeyCode::Down => self.move_by(1, len),
            KeyCode::Up => self.move_by(-1, len),
            KeyCode::Backspace => {
                self.query.pop();
                self.active = 0;
            }
            KeyCode::Char(c) => {
                // Ctrl-C is the host's quit gesture, not a query character.
                if key.modifiers.contains(KeyModifiers::CONTROL) && (c == 'c' || c == 'C') {
                    return Some(LaunchpadResponse::Cancelled);
                }
                if !key.modifiers.contains(KeyModifiers::CONTROL) {
                    self.query.push(c);
                    self.active = 0;
                }
            }
            _ => {}
        }
        None
    }

    /// Draw the palette into `area`.
    pub fn draw(
        &self,
        frame: &mut Frame,
        area: Rect,
        descriptor: &Launchpad,
        palette: &Palette,
    ) {
        let outer = Block::default()
            .borders(Borders::ALL)
            .border_style(palette.border_style())
            .style(palette.text());
        let inner = outer.inner(area);
        frame.render_widget(Clear, area);
        frame.render_widget(outer, area);

        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(1), Constraint::Length(1), Constraint::Min(0)])
            .split(inner);

        frame.render_widget(Paragraph::new(self.query_line(descriptor, palette)), rows[0]);
        frame.render_widget(
            Paragraph::new(Line::styled("─".repeat(inner.width as usize), palette.border_style())),
            rows[1],
        );
        frame.render_widget(Paragraph::new(self.list_lines(descriptor, palette)), rows[2]);
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
        agent.action = Some(Action::Navigate(Navigate {
            route: "/builds?status=failing".into(),
        }));
        state.set_agent_commands(vec![agent]);

        let groups = state.groups(&descriptor);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, AGENT_GROUP_ID);
        assert_eq!(groups[0].title, "Ask the agent");

        match state.on_key(key(KeyCode::Enter), &descriptor) {
            Some(LaunchpadResponse::Run(c)) => {
                assert_eq!(command_outcome(&c), LaunchpadOutcome::Navigate("/builds?status=failing"));
            }
            other => panic!("expected Run, got {other:?}"),
        }
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
        c.action = Some(Action::OpenViewId("products".into()));
        assert_eq!(command_outcome(&c), LaunchpadOutcome::OpenViewId("products"));
        c.action = Some(Action::Rpc(RpcCall::default()));
        assert!(matches!(command_outcome(&c), LaunchpadOutcome::Rpc(_)));
    }

    #[test]
    fn default_command_ids_lead_the_empty_query_view() {
        let mut descriptor = demo();
        descriptor.default_command_ids = vec!["products".into()];
        let state = LaunchpadState::new();
        let groups = state.groups(&descriptor);
        assert_eq!(groups[0].id, "__default__");
        assert_eq!(state.selected(&descriptor).map(|c| c.id.as_str()), Some("products"));
    }
}
