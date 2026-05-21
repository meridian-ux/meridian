use crate::invoker::{RpcError, RpcInvoker};
use meridian_uiview::proto::PanelDescriptor;
use meridian_uiview::Context;

/// Top-level application state for a Meridian TUI host.
/// Holds the catalog of PanelDescriptors, the active panel index,
/// and the runtime context. Hosts drive it via key events; the
/// renderer (PanelView) draws the currently active panel.
pub struct PanelAppState<I: RpcInvoker> {
    pub panels: Vec<PanelDescriptor>,
    pub active: usize,
    pub context: Context,
    pub invoker: I,
}

impl<I: RpcInvoker> PanelAppState<I> {
    pub fn new(panels: Vec<PanelDescriptor>, context: Context, invoker: I) -> Self {
        Self {
            panels,
            active: 0,
            context,
            invoker,
        }
    }

    pub fn active_panel(&self) -> Option<&PanelDescriptor> {
        self.panels.get(self.active)
    }

    /// Cycle to the next panel.
    pub fn next_panel(&mut self) {
        if !self.panels.is_empty() {
            self.active = (self.active + 1) % self.panels.len();
        }
    }

    /// Cycle to the previous panel.
    pub fn prev_panel(&mut self) {
        if !self.panels.is_empty() {
            self.active = (self.active + self.panels.len() - 1) % self.panels.len();
        }
    }

    /// Forwards to the host's RpcInvoker. The renderer uses this to
    /// populate TablePanels and to fire RowActions.
    pub fn invoke(
        &self,
        service: &str,
        method: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        self.invoker.invoke(service, method, request)
    }
}
