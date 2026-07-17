// meridian-tui: ratatui-based renderer for Meridian PanelDescriptors.
//
// Three pieces:
//   * `PanelView` — stateful widget rendering one panel into a
//     ratatui Frame. Caches the current rows/result and exposes
//     key-handling (Up/Down to move selection, Enter to fire row
//     actions on TablePanels).
//   * `PanelAppState` — manages a list of PanelDescriptors and the
//     active one, plus context (resource path, identity, form values).
//     Hosts plug in an `RpcInvoker` to bridge to whatever transport
//     they use (mocked in the demo, tonic-backed in production).
//   * `render_prompt` — one-shot helper for `PromptPanel`. Drives
//     crossterm raw mode + alternate screen internally; returns
//     collected field values (or a confirmation boolean) on submit,
//     `Cancelled` on Esc. Suitable for `bazel run`-style CLIs
//     (e.g. rules_cloudformation's cfn_console).
//   * `LaunchpadState` — the command palette: a `meridian.ui.v1.Launchpad`
//     filtered through the SHARED core (`meridian_uiview::filter_launchpad`,
//     the same ranking the React renderer uses) with a keyboard model and an
//     agent seam. It picks a `Command`; the host runs the decoded
//     `LaunchpadOutcome`.
//   * `render_conversation` — the agent chat transcript: a
//     `meridian_uiview::ConversationModel` (the SHARED streaming model) painted
//     block by block. Transport-free; the host feeds the model.
//   * `Palette` / `Theme` — the TUI's theme binding. `Palette` maps a
//     `meridian.theme.v1.Theme` (parsed `#RRGGBB` -> ratatui `Color::Rgb`)
//     to the styles every widget sources its look from, so NO color
//     literal lives in the renderer. `PanelView::with_palette` and the
//     `palette` argument to `render_prompt` / `render_llm_prompt` carry it.
//     `Palette::default()` is a neutral dark look for un-skinned runs; a
//     brand skin (e.g. @brand's fastverk Theme) drives it identically to
//     every other meridian renderer.
//
// No JSON↔proto bridge at this layer — meridian-uiview's
// RequestBuilder produces serde_json::Value requests, and the host
// `RpcInvoker` deals with marshaling.

mod content;
mod conversation;
mod invoker;
mod launchpad;
mod llm_prompt;
mod prompt;
mod state;
mod theme;
mod widget;

pub use content::{
    glyph, grammar_language_name, osc52, render_action, render_catalog, render_choice,
    render_connect_flow, render_copy_value, render_grammar, render_snippet, render_stat,
    selected_affordance,
};
pub use conversation::{
    block_lines, conversation_lines, render_conversation, status_line,
};
pub use invoker::{RpcError, RpcInvoker};
pub use launchpad::{
    command_outcome, LaunchpadOutcome, LaunchpadResponse, LaunchpadState, AGENT_GROUP_ID,
};
pub use llm_prompt::{render_llm_prompt, LlmPromptResponse};
pub use prompt::{render_prompt, FieldValue, PromptError, PromptResponse};
pub use state::PanelAppState;
pub use theme::{parse_hex, Mode, Palette, Theme};
pub use widget::PanelView;

// Re-export the ratatui + crossterm crates so downstream consumers
// (cli chrome) can render their own widgets against the SAME
// ratatui version meridian uses. Without this, isolated crate
// universes (rules_rust++_crate+++crate vs rules_rust++crate+crate)
// surface two distinct `ratatui::Frame` types and a Frame passed
// from cli into PanelView::draw fails to type-check.
pub use crossterm;
pub use ratatui;
// serde_json::Value appears in the RpcInvoker trait signature, so
// downstream impls must use meridian's serde_json — re-export it.
pub use serde_json;
