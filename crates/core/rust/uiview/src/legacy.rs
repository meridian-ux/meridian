//! Access to the explicitly retained 0.x fields. This compatibility
//! module neither selects precedence nor resolves targets nor grants admission.
//! Keep deprecation handling here instead of suppressing warnings in renderers.
#![allow(deprecated)]

use crate::proto::{
    Action, Affordance, FormPanel, RowAction, RpcCall, Slot, TablePanel, ViewDescriptor,
};

/// Raw old view actions; canonical collection presence must be checked separately.
pub fn view_actions(view: &ViewDescriptor) -> &[Action] {
    &view.actions
}

/// Raw old slot actions; an explicit empty canonical collection still wins.
pub fn slot_actions(slot: &Slot) -> &[Action] {
    &slot.actions
}

/// Raw old row actions, retaining their original predicates and binding contract.
pub fn table_actions(table: &TablePanel) -> &[RowAction] {
    &table.actions
}

/// Old form call; never combine it with an explicitly supplied canonical intent.
pub fn form_submit(form: &FormPanel) -> Option<&RpcCall> {
    form.submit.as_ref()
}

/// Move the old call out of an owned decoded form without allocating a clone.
/// The caller must first establish that canonical submit intent is absent.
pub fn take_form_submit(form: &mut FormPanel) -> Option<RpcCall> {
    form.submit.take()
}

/// Old prominence hint; only used when canonical emphasis is absent.
pub fn affordance_style(affordance: &Affordance) -> i32 {
    affordance.style
}
