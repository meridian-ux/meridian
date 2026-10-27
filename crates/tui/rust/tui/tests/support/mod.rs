use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use meridian_tui::{
    FormSubmission, NativeCancellation, NativeInvocationContext, NativeInvocationHost, PanelView,
};
use meridian_uiview::{
    proto::{FormPanel, RpcCall},
    Context,
};
use std::cell::RefCell;

/// Editor/request fixtures opt into a real invocation host. This is not the
/// production hostless API: a request is captured only after shared admission,
/// validation, and request construction have succeeded.
pub trait AdmittedFormFixture {
    fn test_form_key(
        &mut self,
        panel: &FormPanel,
        context: &Context,
        key: KeyCode,
    ) -> Option<FormSubmission>;
}
impl AdmittedFormFixture for PanelView {
    fn test_form_key(
        &mut self,
        panel: &FormPanel,
        context: &Context,
        key: KeyCode,
    ) -> Option<FormSubmission> {
        let captured = RefCell::new(None);
        let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
        let rpc =
            |call: &RpcCall, request, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                *captured.borrow_mut() = Some(FormSubmission {
                    service: call.service.clone(),
                    method: call.method.clone(),
                    request,
                });
                Ok(())
            };
        self.handle_form_key_with_invocation(
            panel,
            context,
            KeyEvent::new(key, KeyModifiers::NONE),
            &NativeInvocationHost {
                mutations: Some(&policy),
                rpc: Some(&rpc),
                ..Default::default()
            },
        );
        captured.into_inner()
    }
}
