// meridian-tui: ratatui-based renderer for Meridian PanelDescriptors.
//
// Two pieces:
//   * `PanelView` — stateful widget rendering one panel into a
//     ratatui Frame. Caches the current rows/result and exposes
//     key-handling (Up/Down to move selection, Enter to fire row
//     actions on TablePanels).
//   * `PanelAppState` — manages a list of PanelDescriptors and the
//     active one, plus context (resource path, identity, form values).
//     Hosts plug in an `RpcInvoker` to bridge to whatever transport
//     they use (mocked in the demo, tonic-backed in production).
//
// No JSON↔proto bridge at this layer — meridian-uiview's
// RequestBuilder produces serde_json::Value requests, and the host
// `RpcInvoker` deals with marshaling.

mod invoker;
mod state;
mod widget;

pub use invoker::{RpcError, RpcInvoker};
pub use state::PanelAppState;
pub use widget::PanelView;
