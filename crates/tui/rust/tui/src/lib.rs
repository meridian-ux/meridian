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
//
// No JSON↔proto bridge at this layer — meridian-uiview's
// RequestBuilder produces serde_json::Value requests, and the host
// `RpcInvoker` deals with marshaling.

mod invoker;
mod llm_prompt;
mod prompt;
mod state;
mod widget;

pub use invoker::{RpcError, RpcInvoker};
pub use llm_prompt::{render_llm_prompt, LlmPromptResponse};
pub use prompt::{render_prompt, FieldValue, PromptError, PromptResponse};
pub use state::PanelAppState;
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
