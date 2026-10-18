//! Synchronous native host effects. Protobuf remains the declaration contract;
//! borrowed projections, callbacks and cancellation are in-process UI state.
use crate::RpcError;
use meridian_uiview::{
    proto::{
        affordance::Invoke, command, Action, Affordance, Command, ConfirmSpec, FormField, FormMode,
        FormPanel, Navigate, PanelDescriptor, ResourceAction, RowAction, RpcCall,
    },
    Context, RequestBuilder, RequestOverrides, SubmissionKind,
};
use serde_json::Value;
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

fn form_fields_ready(fields: &[FormField], depth: usize, remaining: &mut usize) -> bool {
    use meridian_uiview::proto::{form_field::Kind, repeated_field::Element};
    if depth > 64 || fields.len() > *remaining {
        return false;
    }
    *remaining -= fields.len();
    fields.iter().all(|field| match field.kind.as_ref() {
        Some(Kind::EnumSelection(spec)) => spec.options_source.is_none(),
        Some(Kind::Nested(spec)) => form_fields_ready(&spec.fields, depth + 1, remaining),
        Some(Kind::Repeated(spec)) => match spec.element.as_ref() {
            Some(Element::Scalar(field)) => {
                form_fields_ready(std::slice::from_ref(field.as_ref()), depth + 1, remaining)
            }
            Some(Element::Object(object)) => {
                form_fields_ready(&object.fields, depth + 1, remaining)
            }
            None => false,
        },
        None => false,
        _ => true,
    })
}

// Owned currentness bytes live only in this process. The existing JSON Context
// is not a new wire DTO. Bound cumulative copies BEFORE cloning each value and
// cap serialization independently; never hash away scope identity.
pub(crate) fn context_key(context: NativeInvocationContext<'_>) -> Result<Vec<u8>, ()> {
    struct Bytes(Vec<u8>);
    impl Write for Bytes {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            if self.0.len().saturating_add(data.len()) > 4 * 1024 * 1024 {
                return Err(std::io::Error::other("context limit"));
            }
            self.0.extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut bytes = Bytes(vec![]);
    let mut budget = meridian_uiview::RequestBudget::for_boundary(&Value::Null).map_err(|_| ())?;
    bytes.write_all(b"[").map_err(|_| ())?;
    serde_json::to_writer(&mut bytes, &context.context.current_resource_path).map_err(|_| ())?;
    for value in [context.context.ui_identity.as_ref(), context.selected_row()] {
        bytes.write_all(b",").map_err(|_| ())?;
        let mut owned = Value::Null;
        if let Some(value) = value {
            budget.assign(&mut owned, "v", value).map_err(|_| ())?;
        }
        serde_json::to_writer(&mut bytes, owned.get("v").unwrap_or(&Value::Null))
            .map_err(|_| ())?;
    }
    let sources: [Box<dyn Iterator<Item = (&str, &Value)> + '_>; 3] = [
        Box::new(context.form_values()),
        Box::new(context.context.signals.iter().map(|(k, v)| (k.as_str(), v))),
        Box::new(
            context
                .context
                .selections
                .iter()
                .map(|(k, v)| (k.as_str(), v)),
        ),
    ];
    for values in sources {
        bytes.write_all(b",[").map_err(|_| ())?;
        for (index, (key, value)) in values.enumerate() {
            if index >= 65_536 {
                return Err(());
            }
            let mut owned = Value::Null;
            budget.assign(&mut owned, "v", value).map_err(|_| ())?;
            if index > 0 {
                bytes.write_all(b",").map_err(|_| ())?;
            }
            serde_json::to_writer(&mut bytes, &(key, &owned["v"])).map_err(|_| ())?;
        }
        bytes.write_all(b"]").map_err(|_| ())?;
    }
    bytes.write_all(b"]").map_err(|_| ())?;
    Ok(bytes.0)
}

#[derive(Clone, Copy)]
#[non_exhaustive]
pub enum NativeAction<'a> {
    Canonical(&'a Affordance),
    Legacy(&'a Action),
    /// Canonical presence suppresses every legacy command hint as a whole.
    Command(&'a Command),
    /// Current collected values, not ambient host fields or a prebuilt request.
    Form(&'a FormPanel, &'a Value),
    Row(&'a RowAction),
    Resource(&'a ResourceAction),
    /// Literal authored Snippet/CopyValue content; never formatted display text.
    Copy(&'a str),
}

/// Borrowed canonical intent, not a wire DTO or permission token.
#[derive(Clone, Copy)]
#[non_exhaustive]
pub enum NativeTarget<'a> {
    Rpc(&'a RpcCall),
    Uri(&'a str),
    Command(&'a str),
    Navigate(&'a Navigate),
    OpenPanel(&'a PanelDescriptor),
    OpenView(&'a str),
    Copy(&'a str),
}

#[derive(Clone, Copy)]
pub struct NativeInvocationContext<'a> {
    context: &'a Context,
    /// A repeated/selected record overrides ambient host selection, including null.
    record: Option<&'a Value>,
    form: Option<(&'a [FormField], &'a Value)>,
}
impl<'a> NativeInvocationContext<'a> {
    pub fn new(context: &'a Context) -> Self {
        Self {
            context,
            record: None,
            form: None,
        }
    }
    pub fn with_record(self, record: Option<&'a Value>) -> Self {
        Self { record, ..self }
    }
    pub fn with_form(self, fields: &'a [FormField], values: &'a Value) -> Self {
        Self {
            form: Some((fields, values)),
            ..self
        }
    }
    /// Effective selection, including the repeated control's record override.
    /// Policies and effects must not authorize against an unrelated ambient row.
    pub fn selected_row(&self) -> Option<&Value> {
        self.record.or(self.context.selected_row.as_ref())
    }
    pub fn current_resource_path(&self) -> Option<&str> {
        self.context.current_resource_path.as_deref()
    }
    pub fn ui_identity(&self) -> Option<&Value> {
        self.context.ui_identity.as_ref()
    }
    pub fn form_value(&self, id: &str) -> Option<&Value> {
        match self.form {
            Some((fields, values)) => fields
                .iter()
                .any(|f| f.field_id == id)
                .then(|| values.get(id))
                .flatten(),
            None => self.context.form_values.get(id),
        }
    }
    /// Effective declared fields when submitting a form; never ambient shadows
    /// or undeclared prefill properties. Values remain borrowed and uncoerced.
    pub fn form_values(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.form
            .is_none()
            .then_some(&self.context.form_values)
            .into_iter()
            .flat_map(|values| values.iter().map(|(key, value)| (key.as_str(), value)))
            .chain(self.form.into_iter().flat_map(|(fields, values)| {
                fields.iter().filter_map(move |field| {
                    values
                        .get(&field.field_id)
                        .map(|value| (field.field_id.as_str(), value))
                })
            }))
    }
    pub fn signals(&self) -> &std::collections::HashMap<String, Value> {
        &self.context.signals
    }
    pub fn selections(&self) -> &std::collections::HashMap<String, Value> {
        &self.context.selections
    }
}

#[derive(Clone, Debug)]
pub struct NativeCancellation(Arc<AtomicBool>);
impl NativeCancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub type NativeTextEffect<'a> = dyn for<'c> Fn(&str, NativeInvocationContext<'c>, &NativeCancellation) -> Result<(), RpcError>
    + 'a;
pub type NativeRpcEffect<'a> = dyn for<'c> Fn(
        &RpcCall,
        Value,
        NativeInvocationContext<'c>,
        &NativeCancellation,
    ) -> Result<(), RpcError>
    + 'a;
pub type NativeNavigateEffect<'a> = dyn for<'c> Fn(&Navigate, NativeInvocationContext<'c>, &NativeCancellation) -> Result<(), RpcError>
    + 'a;
pub type NativePanelEffect<'a> = dyn for<'c> Fn(
        &PanelDescriptor,
        NativeInvocationContext<'c>,
        &NativeCancellation,
    ) -> Result<(), RpcError>
    + 'a;
pub type NativePolicy<'a> =
    dyn for<'c> Fn(NativeTarget<'c>, NativeInvocationContext<'c>) -> bool + 'a;
pub type NativeMutationPolicy<'a> =
    dyn for<'c> Fn(&RpcCall, NativeInvocationContext<'c>) -> bool + 'a;
pub type NativeResolver<'a> =
    dyn for<'c> Fn(&Action, NativeInvocationContext<'c>) -> Option<Affordance> + 'a;
pub type NativeResourceResolver<'a> =
    dyn for<'c> Fn(&ResourceAction, NativeInvocationContext<'c>) -> Option<Affordance> + 'a;
pub type NativeResourceConfirmation<'a> = dyn for<'c> Fn(
        &ConfirmSpec,
        NativeTarget<'c>,
        NativeInvocationContext<'c>,
        &NativeCancellation,
    ) -> Result<bool, RpcError>
    + 'a;
pub type NativeConfirmation<'a> = dyn for<'c> Fn(
        NativeTarget<'c>,
        NativeInvocationContext<'c>,
        &NativeCancellation,
    ) -> Result<bool, RpcError>
    + 'a;
pub type NativeRefresh<'a> =
    dyn for<'c> Fn(NativeInvocationContext<'c>, &NativeCancellation) -> Result<(), RpcError> + 'a;

/// Explicit host capabilities. No opener, shell, clipboard, transport or grant
/// exists by default. A callback must return only after its effect settles;
/// asynchronous operation workflows retain their separate LRO token protocol.
#[derive(Default)]
pub struct NativeInvocationHost<'a> {
    pub mutations: Option<&'a NativeMutationPolicy<'a>>,
    pub admit: Option<&'a NativePolicy<'a>>,
    pub resolve_semantic: Option<&'a NativeResolver<'a>>,
    pub resolve_resource: Option<&'a NativeResourceResolver<'a>>,
    /// Required when a ResourceAction declares a ConfirmSpec. Generic consent
    /// cannot silently discard the resource's literal confirmation contract.
    pub confirm_resource: Option<&'a NativeResourceConfirmation<'a>>,
    pub confirm: Option<&'a NativeConfirmation<'a>>,
    pub refresh: Option<&'a NativeRefresh<'a>>,
    pub rpc: Option<&'a NativeRpcEffect<'a>>,
    pub uri: Option<&'a NativeTextEffect<'a>>,
    pub command: Option<&'a NativeTextEffect<'a>>,
    pub navigate: Option<&'a NativeNavigateEffect<'a>>,
    pub open_panel: Option<&'a NativePanelEffect<'a>>,
    pub open_view: Option<&'a NativeTextEffect<'a>>,
    pub copy: Option<&'a NativeTextEffect<'a>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum NativeInvocationOutcome {
    Succeeded,
    RefreshFailed,
    Denied,
    Failed,
    Cancelled,
    Busy,
}
impl NativeInvocationOutcome {
    pub fn message(self) -> &'static str {
        match self {
            Self::Succeeded => "Action completed.",
            Self::RefreshFailed => "Action completed, but refresh is unavailable. Do not repeat the action to refresh.",
            Self::Denied => "Action denied: host policy, capability, target or current record does not permit it.",
            Self::Failed => "Action failed. Retry with the current context.",
            Self::Cancelled => "Action canceled. An already-sent effect may still complete.", Self::Busy => "Action is already running.",
        }
    }
}

#[derive(Clone, Default, Debug)]
pub struct NativeInvocationDispatcher {
    active: Arc<Mutex<Option<NativeCancellation>>>,
}
struct Attempt<'a>(&'a NativeInvocationDispatcher);
impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        *self.0.active.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}
impl NativeInvocationDispatcher {
    pub fn pending(&self) -> bool {
        self.active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }
    pub fn cancel(&self) {
        if let Some(signal) = self
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            signal.cancel();
        }
    }
    pub fn invoke(
        &self,
        action: NativeAction<'_>,
        context: NativeInvocationContext<'_>,
        host: &NativeInvocationHost<'_>,
    ) -> NativeInvocationOutcome {
        let signal = NativeCancellation(Arc::new(AtomicBool::new(false)));
        {
            let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
            if active.is_some() {
                return NativeInvocationOutcome::Busy;
            }
            *active = Some(signal.clone());
        }
        let _attempt = Attempt(self);
        let context = if let NativeAction::Form(panel, values) = action {
            if panel.mode != FormMode::Edit as i32 {
                return NativeInvocationOutcome::Denied;
            }
            context.with_form(&panel.fields, values)
        } else {
            context
        };
        if let Some((fields, values)) = context.form {
            if !form_fields_ready(fields, 0, &mut 1_000)
                || meridian_uiview::validate_form_values(fields, values).is_err()
            {
                return NativeInvocationOutcome::Denied;
            }
        }
        if context_key(context).is_err() {
            return NativeInvocationOutcome::Denied;
        }
        let outcome = self.run(action, context, host, &signal);
        if signal.is_cancelled() {
            NativeInvocationOutcome::Cancelled
        } else {
            outcome
        }
    }
    fn run(
        &self,
        action: NativeAction<'_>,
        context: NativeInvocationContext<'_>,
        host: &NativeInvocationHost<'_>,
        signal: &NativeCancellation,
    ) -> NativeInvocationOutcome {
        use NativeInvocationOutcome as O;
        let legacy_refresh = matches!(action, NativeAction::Row(_) | NativeAction::Resource(_));
        let resource = if let NativeAction::Resource(source) = action {
            Some(source)
        } else {
            None
        };
        if let Some(source) = resource {
            let Some(row) = context.selected_row() else {
                return O::Denied;
            };
            if !row.is_object() {
                return O::Denied;
            }
            if !crate::content::resource_action_visible(source, row)
                || (source.confirm.is_some() && host.confirm_resource.is_none())
            {
                return O::Denied;
            }
        }
        if let NativeAction::Row(source) = action {
            let Some(row) = context.selected_row() else {
                return O::Denied;
            };
            if source
                .enabled_when
                .as_ref()
                .is_some_and(|filter| meridian_uiview::row_filter_matches(filter, row) != Ok(true))
            {
                return O::Denied;
            }
        }
        let action = match action {
            NativeAction::Command(command) => command
                .affordance
                .as_ref()
                .map(NativeAction::Canonical)
                .unwrap_or(action),
            NativeAction::Form(panel, _) => panel
                .submit_affordance
                .as_deref()
                .map(NativeAction::Canonical)
                .unwrap_or(action),
            _ => action,
        };
        let resolved = match action {
            NativeAction::Resource(source) if source.invoke.is_none() => {
                if source.id.is_empty() {
                    return O::Denied;
                }
                let Some(resolve) = host.resolve_resource else {
                    return O::Denied;
                };
                let Some(value) = resolve(source, context) else {
                    return O::Denied;
                };
                Some(value)
            }
            NativeAction::Legacy(action) if action.call.is_none() => {
                if action.id.is_empty() {
                    return O::Denied;
                }
                let Some(resolve) = host.resolve_semantic else {
                    return O::Denied;
                };
                let Some(value) = resolve(action, context) else {
                    return O::Denied;
                };
                Some(value)
            }
            _ => None,
        };
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        let action = resolved
            .as_ref()
            .map(NativeAction::Canonical)
            .unwrap_or(action);
        let (target, refresh) = match action {
            NativeAction::Copy(value) => (Some(NativeTarget::Copy(value)), false),
            NativeAction::Row(source) => (source.rpc.as_ref().map(NativeTarget::Rpc), true),
            NativeAction::Resource(source) => (source.invoke.as_ref().map(NativeTarget::Rpc), true),
            NativeAction::Legacy(action) => (action.call.as_ref().map(NativeTarget::Rpc), false),
            NativeAction::Form(panel, _) => (panel.submit.as_ref().map(NativeTarget::Rpc), false),
            NativeAction::Command(command) => (
                command.action.as_ref().and_then(|intent| match intent {
                    command::Action::Rpc(call) => Some(NativeTarget::Rpc(call)),
                    command::Action::Navigate(route) => Some(NativeTarget::Navigate(route)),
                    command::Action::OpenViewId(id) => Some(NativeTarget::OpenView(id)),
                    command::Action::OpenPanel(open) => {
                        open.panel.as_ref().map(NativeTarget::OpenPanel)
                    }
                }),
                false,
            ),
            NativeAction::Canonical(action) => {
                if let Some(filter) = &action.enabled_when {
                    if meridian_uiview::row_filter_matches(
                        filter,
                        context.selected_row().unwrap_or(&Value::Null),
                    ) != Ok(true)
                    {
                        return O::Denied;
                    }
                }
                let target = action.invoke.as_ref().map(|intent| match intent {
                    Invoke::Rpc(v) => NativeTarget::Rpc(v),
                    Invoke::Uri(v) => NativeTarget::Uri(v),
                    Invoke::Command(v) => NativeTarget::Command(v),
                    Invoke::Navigate(v) => NativeTarget::Navigate(v),
                    Invoke::OpenPanel(v) => NativeTarget::OpenPanel(v),
                    Invoke::OpenView(v) => NativeTarget::OpenView(v),
                    Invoke::Copy(v) => NativeTarget::Copy(v),
                });
                (target, action.refresh_on_success.unwrap_or(legacy_refresh))
            }
        };
        let Some(target) = target else {
            return O::Denied;
        };
        let supported = match target {
            NativeTarget::Rpc(call) => {
                host.rpc.is_some() && !call.service.is_empty() && !call.method.is_empty()
            }
            NativeTarget::Uri(uri) => host.uri.is_some() && safe_destination(uri),
            NativeTarget::Command(command) => host.command.is_some() && !command.is_empty(),
            NativeTarget::Navigate(route) => {
                host.navigate.is_some() && safe_destination(&route.route)
            }
            NativeTarget::OpenPanel(_) => host.open_panel.is_some(),
            NativeTarget::OpenView(id) => host.open_view.is_some() && !id.is_empty(),
            NativeTarget::Copy(_) => host.copy.is_some(),
        };
        if !supported {
            return O::Denied;
        }
        if let NativeTarget::Rpc(call) = target {
            if !host.mutations.is_some_and(|allow| allow(call, context)) {
                return O::Denied;
            }
        }
        if !host
            .admit
            .map(|allow| allow(target, context))
            .unwrap_or(matches!(target, NativeTarget::Rpc(_)))
        {
            return O::Denied;
        }
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        if let Some(confirm) = host.confirm {
            match confirm(target, context, signal) {
                Ok(true) => {}
                Ok(false) => return O::Cancelled,
                Err(_) => return O::Failed,
            }
        }
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        if let Some(spec) = resource.and_then(|source| source.confirm.as_ref()) {
            match host
                .confirm_resource
                .expect("required confirmation capability")(
                spec, target, context, signal
            ) {
                Ok(true) => {}
                Ok(false) => return O::Cancelled,
                Err(_) => return O::Failed,
            }
        }
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        let request = if let NativeTarget::Rpc(call) = target {
            let built = if let Some((fields, values)) = context.form {
                RequestBuilder::build_submission_with_row(
                    call,
                    context.context,
                    fields,
                    values,
                    SubmissionKind::Form,
                    context.record,
                )
            } else {
                RequestBuilder::build_for_boundary_with(
                    call,
                    context.context,
                    RequestOverrides {
                        selected_row: context.record,
                        ..Default::default()
                    },
                )
            };
            match built {
                Ok(request) => Some(request),
                Err(_) => return O::Failed,
            }
        } else {
            None
        };
        // Policy callbacks are pure and may read revocable host state. Consent
        // and request construction never preserve a permission that was revoked.
        if let NativeTarget::Rpc(call) = target {
            if !host.mutations.is_some_and(|allow| allow(call, context)) {
                return O::Denied;
            }
        }
        if !host
            .admit
            .map(|allow| allow(target, context))
            .unwrap_or(matches!(target, NativeTarget::Rpc(_)))
        {
            return O::Denied;
        }
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        let result = match target {
            NativeTarget::Rpc(call) => host.rpc.unwrap()(
                call,
                request.expect("RPC request assembled"),
                context,
                signal,
            ),
            NativeTarget::Uri(v) => host.uri.unwrap()(v, context, signal),
            NativeTarget::Command(v) => host.command.unwrap()(v, context, signal),
            NativeTarget::Navigate(v) => host.navigate.unwrap()(v, context, signal),
            NativeTarget::OpenPanel(v) => host.open_panel.unwrap()(v, context, signal),
            NativeTarget::OpenView(v) => host.open_view.unwrap()(v, context, signal),
            NativeTarget::Copy(v) => host.copy.unwrap()(v, context, signal),
        };
        if signal.is_cancelled() {
            return O::Cancelled;
        }
        if result.is_err() {
            return O::Failed;
        }
        if refresh {
            let Some(refresh) = host.refresh else {
                return O::RefreshFailed;
            };
            if refresh(context, signal).is_err() {
                return O::RefreshFailed;
            }
        }
        O::Succeeded
    }
}

fn safe_destination(raw: &str) -> bool {
    let value = raw.trim();
    if value.is_empty() || raw.bytes().any(|b| b < 32 || b == 127) {
        return false;
    }
    let prefix = value.split(['/', '?', '#']).next().unwrap_or_default();
    if let Some((scheme, _)) = prefix.split_once(':') {
        if ["javascript", "data", "file", "vbscript", "blob"]
            .iter()
            .any(|v| scheme.eq_ignore_ascii_case(v))
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::{field_binding, FieldBinding, RowFilter};
    use serde_json::json;
    use std::cell::{Cell, RefCell};

    fn rpc() -> RpcCall {
        RpcCall {
            service: "raw.Records".into(),
            method: "Get".into(),
            bindings: vec![
                FieldBinding {
                    request_field: "id".into(),
                    source: Some(field_binding::Source::RowField("id".into())),
                },
                FieldBinding {
                    request_field: "flag".into(),
                    source: Some(field_binding::Source::RowField("flag".into())),
                },
                FieldBinding {
                    request_field: "name".into(),
                    source: Some(field_binding::Source::FormField("name".into())),
                },
            ],
        }
    }
    fn actions() -> Vec<Affordance> {
        vec![
            Invoke::Rpc(rpc()),
            Invoke::Uri("cursor://raw".into()),
            Invoke::Command("literal\nnot-clipboard".into()),
            Invoke::Navigate(Navigate {
                route: "/raw".into(),
            }),
            Invoke::OpenPanel(Box::new(PanelDescriptor {
                panel_id: "inline".into(),
                ..Default::default()
            })),
            Invoke::OpenView("raw-view".into()),
            Invoke::Copy("".into()),
        ]
        .into_iter()
        .map(|invoke| Affordance {
            label: "Run".into(),
            invoke: Some(invoke),
            ..Default::default()
        })
        .collect()
    }
    fn context() -> Context {
        Context {
            current_resource_path: Some("raw/e\u{301}".into()),
            selected_row: Some(json!({"id":"ambient"})),
            form_values: [("name".into(), json!("raw/e\u{301}"))].into(),
            ..Default::default()
        }
    }
    #[test]
    fn seven_targets_need_explicit_capabilities_and_policy_and_preserve_raw_data() {
        let events = RefCell::new(vec![]);
        let record = json!({"id":0,"flag":false});
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(Some(&record));
        let text = |value: &str, current: NativeInvocationContext<'_>, _: &NativeCancellation| {
            assert_eq!(current.selected_row(), Some(&record));
            events.borrow_mut().push(value.to_owned());
            Ok(())
        };
        let uri =
            |value: &str, context: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                text(&format!("uri:{value}"), context, signal)
            };
        let command =
            |value: &str, context: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                text(&format!("command:{value}"), context, signal)
            };
        let open_view =
            |value: &str, context: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                text(&format!("view:{value}"), context, signal)
            };
        let copy =
            |value: &str, context: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                text(&format!("copy:{value}"), context, signal)
            };
        let rpc_effect = |call: &RpcCall,
                          request: Value,
                          current: NativeInvocationContext<'_>,
                          _: &NativeCancellation| {
            assert_eq!(call.method, "Get");
            assert_eq!(request, json!({"id":0,"flag":false,"name":"raw/e\u{301}"}));
            assert_eq!(current.selected_row(), Some(&record));
            events.borrow_mut().push("rpc".into());
            Ok(())
        };
        let navigate =
            |target: &Navigate, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                events.borrow_mut().push(target.route.clone());
                Ok(())
            };
        let panel =
            |target: &PanelDescriptor, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                events.borrow_mut().push(target.panel_id.clone());
                Ok(())
            };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let mutations = |call: &RpcCall, _: NativeInvocationContext<'_>| {
            call.service == "raw.Records" && call.method == "Get"
        };
        let host = NativeInvocationHost {
            rpc: Some(&rpc_effect),
            uri: Some(&uri),
            command: Some(&command),
            navigate: Some(&navigate),
            open_panel: Some(&panel),
            open_view: Some(&open_view),
            copy: Some(&copy),
            admit: Some(&allow),
            mutations: Some(&mutations),
            ..Default::default()
        };
        let dispatcher = NativeInvocationDispatcher::default();
        assert!(events.borrow().is_empty());
        for action in actions() {
            assert_eq!(
                dispatcher.invoke(
                    NativeAction::Canonical(&action),
                    scope,
                    &NativeInvocationHost::default()
                ),
                NativeInvocationOutcome::Denied
            );
            assert_eq!(
                dispatcher.invoke(NativeAction::Canonical(&action), scope, &host),
                NativeInvocationOutcome::Succeeded
            );
        }
        assert_eq!(
            *events.borrow(),
            [
                "rpc",
                "uri:cursor://raw",
                "command:literal\nnot-clipboard",
                "/raw",
                "inline",
                "view:raw-view",
                "copy:"
            ]
        );
    }
    #[test]
    fn rpc_mutation_permission_is_required_even_for_get_and_target_policy_cannot_waive_it() {
        let calls = Cell::new(0);
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let effect =
            |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                calls.set(calls.get() + 1);
                Ok(())
            };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let action = actions().remove(0);
        let dispatcher = NativeInvocationDispatcher::default();
        let host = NativeInvocationHost {
            rpc: Some(&effect),
            admit: Some(&allow),
            ..Default::default()
        };
        assert_eq!(
            dispatcher.invoke(NativeAction::Canonical(&action), scope, &host),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn non_rpc_capability_without_target_admission_is_not_a_grant() {
        let calls = Cell::new(0);
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        let host = NativeInvocationHost {
            uri: Some(&effect),
            command: Some(&effect),
            copy: Some(&effect),
            open_view: Some(&effect),
            ..Default::default()
        };
        let dispatcher = NativeInvocationDispatcher::default();
        for action in actions().iter().skip(1) {
            assert_eq!(
                dispatcher.invoke(NativeAction::Canonical(action), scope, &host),
                NativeInvocationOutcome::Denied
            );
        }
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn consent_cannot_preserve_revoked_permission_or_cancellation() {
        let permitted = Cell::new(true);
        let calls = Cell::new(0);
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let effect =
            |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                calls.set(calls.get() + 1);
                Ok(())
            };
        let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| permitted.get();
        let confirm =
            |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                permitted.set(false);
                Ok(true)
            };
        let host = NativeInvocationHost {
            rpc: Some(&effect),
            mutations: Some(&policy),
            confirm: Some(&confirm),
            ..Default::default()
        };
        assert_eq!(
            NativeInvocationDispatcher::default().invoke(
                NativeAction::Canonical(&actions()[0]),
                scope,
                &host
            ),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(calls.get(), 0);
        permitted.set(true);
        let cancel =
            |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                signal.cancel();
                Ok(true)
            };
        let host = NativeInvocationHost {
            confirm: Some(&cancel),
            ..host
        };
        assert_eq!(
            NativeInvocationDispatcher::default().invoke(
                NativeAction::Canonical(&actions()[0]),
                scope,
                &host
            ),
            NativeInvocationOutcome::Cancelled
        );
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn predicate_and_missing_capability_deny_before_host_policy_or_consent() {
        let calls = Cell::new(0);
        let base = context();
        let row = json!({"flag":false});
        let scope = NativeInvocationContext::new(&base).with_record(Some(&row));
        let policy = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| {
            calls.set(calls.get() + 1);
            true
        };
        let confirm =
            |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                calls.set(calls.get() + 1);
                Ok(true)
            };
        let host = NativeInvocationHost {
            admit: Some(&policy),
            confirm: Some(&confirm),
            ..Default::default()
        };
        let mut action = actions().remove(1);
        action.enabled_when = Some(RowFilter {
            field_path: "flag".into(),
            equals: "true".into(),
        });
        assert_eq!(
            NativeInvocationDispatcher::default().invoke(
                NativeAction::Canonical(&action),
                scope,
                &host
            ),
            NativeInvocationOutcome::Denied
        );
        action.enabled_when = None;
        assert_eq!(
            NativeInvocationDispatcher::default().invoke(
                NativeAction::Canonical(&action),
                scope,
                &host
            ),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn semantic_resolution_is_explicit_and_retains_raw_subject_without_inventing_navigation() {
        let base = context();
        let row = json!({"id":0});
        let scope = NativeInvocationContext::new(&base).with_record(Some(&row));
        let action = Action {
            id: "semantic-key".into(),
            ..Default::default()
        };
        let calls = Cell::new(0);
        let resolve = |source: &Action, current: NativeInvocationContext<'_>| {
            assert_eq!(source.id, "semantic-key");
            assert_eq!(current.selected_row(), Some(&row));
            Some(Affordance {
                invoke: Some(Invoke::Copy("resolved".into())),
                ..Default::default()
            })
        };
        let effect = |target: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            assert_eq!(target, "resolved");
            calls.set(calls.get() + 1);
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let dispatcher = NativeInvocationDispatcher::default();
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Legacy(&action),
                scope,
                &NativeInvocationHost::default()
            ),
            NativeInvocationOutcome::Denied
        );
        let host = NativeInvocationHost {
            resolve_semantic: Some(&resolve),
            copy: Some(&effect),
            admit: Some(&allow),
            ..Default::default()
        };
        assert_eq!(
            dispatcher.invoke(NativeAction::Legacy(&action), scope, &host),
            NativeInvocationOutcome::Succeeded
        );
        assert_eq!(calls.get(), 1);
    }
    #[test]
    fn reentrant_and_cancelled_operations_keep_the_guard_until_noncooperative_settlement() {
        let dispatcher = NativeInvocationDispatcher::default();
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let action = actions().remove(6);
        let refreshes = Cell::new(0);
        let effect = |_: &str, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
            assert!(dispatcher.pending());
            signal.cancel();
            assert_eq!(
                dispatcher.invoke(
                    NativeAction::Canonical(&action),
                    scope,
                    &NativeInvocationHost::default()
                ),
                NativeInvocationOutcome::Busy
            );
            Ok(())
        };
        let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
            refreshes.set(refreshes.get() + 1);
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let mut action = action.clone();
        action.refresh_on_success = Some(true);
        let host = NativeInvocationHost {
            copy: Some(&effect),
            admit: Some(&allow),
            refresh: Some(&refresh),
            ..Default::default()
        };
        assert_eq!(
            dispatcher.invoke(NativeAction::Canonical(&action), scope, &host),
            NativeInvocationOutcome::Cancelled
        );
        assert!(!dispatcher.pending());
        assert_eq!(refreshes.get(), 0);
    }
    #[test]
    fn failed_refresh_is_distinct_from_effect_failure_and_errors_do_not_leak() {
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let effects = Cell::new(0);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            effects.set(effects.get() + 1);
            Ok(())
        };
        let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
            Err(RpcError::Other("private refresh failure".into()))
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let action = Affordance {
            refresh_on_success: Some(true),
            invoke: Some(Invoke::Copy("private clipboard payload".into())),
            ..Default::default()
        };
        let host = NativeInvocationHost {
            copy: Some(&effect),
            admit: Some(&allow),
            refresh: Some(&refresh),
            ..Default::default()
        };
        let result = NativeInvocationDispatcher::default().invoke(
            NativeAction::Canonical(&action),
            scope,
            &host,
        );
        assert_eq!(result, NativeInvocationOutcome::RefreshFailed);
        assert_eq!(effects.get(), 1);
        assert!(!result.message().contains("private"));
    }
    #[test]
    fn unsafe_destinations_never_reach_a_permissive_host_and_commands_do_not_copy() {
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let calls = Cell::new(0);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            uri: Some(&effect),
            copy: Some(&effect),
            admit: Some(&allow),
            ..Default::default()
        };
        let dispatcher = NativeInvocationDispatcher::default();
        for uri in [
            "javascript:alert(1)",
            "DaTa:text/html,bad",
            "file:///secret",
            "blob:opaque",
            "vbscript:bad",
            "/bad\nvalue",
            "\n/leading-control",
            "/trailing-control\t",
        ] {
            let action = Affordance {
                invoke: Some(Invoke::Uri(uri.into())),
                ..Default::default()
            };
            assert_eq!(
                dispatcher.invoke(NativeAction::Canonical(&action), scope, &host),
                NativeInvocationOutcome::Denied
            );
        }
        let command = Affordance {
            invoke: Some(Invoke::Command("not-copy".into())),
            ..Default::default()
        };
        assert_eq!(
            dispatcher.invoke(NativeAction::Canonical(&command), scope, &host),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn bounded_context_and_rpc_copy_work_fail_closed_then_retry_current_values() {
        let base = context();
        let mut row = json!({"id":"x".repeat(600_000)});
        let effects = Cell::new(0);
        let call = RpcCall {
            bindings: (0..10)
                .map(|i| FieldBinding {
                    request_field: format!("copy{i}"),
                    source: Some(field_binding::Source::RowField("id".into())),
                })
                .collect(),
            ..rpc()
        };
        let action = Affordance {
            invoke: Some(Invoke::Rpc(call)),
            ..Default::default()
        };
        let effect = |_: &RpcCall,
                      request: Value,
                      _: NativeInvocationContext<'_>,
                      _: &NativeCancellation| {
            assert_eq!(request["copy0"], json!("small"));
            effects.set(effects.get() + 1);
            Ok(())
        };
        let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            rpc: Some(&effect),
            mutations: Some(&policy),
            ..Default::default()
        };
        let dispatcher = NativeInvocationDispatcher::default();
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                NativeInvocationContext::new(&base).with_record(Some(&row)),
                &host
            ),
            NativeInvocationOutcome::Failed
        );
        assert_eq!(effects.get(), 0);
        row["id"] = json!("small");
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                NativeInvocationContext::new(&base).with_record(Some(&row)),
                &host
            ),
            NativeInvocationOutcome::Succeeded
        );
        assert_eq!(effects.get(), 1);
        row["id"] = json!("x".repeat(5 * 1024 * 1024));
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                NativeInvocationContext::new(&base).with_record(Some(&row)),
                &host
            ),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(effects.get(), 1);
    }

    #[test]
    fn native_transport_failure_retries_current_values_without_raw_errors() {
        let mut base = context();
        let row = json!({"id":0,"flag":false});
        let requests = RefCell::new(vec![]);
        let fail = Cell::new(true);
        let effect = |_: &RpcCall,
                      request: Value,
                      _: NativeInvocationContext<'_>,
                      _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            if fail.replace(false) {
                Err(RpcError::Other("private transport failure".into()))
            } else {
                Ok(())
            }
        };
        let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            rpc: Some(&effect),
            mutations: Some(&policy),
            ..Default::default()
        };
        let dispatcher = NativeInvocationDispatcher::default();
        let action = actions().remove(0);
        let failed = dispatcher.invoke(
            NativeAction::Canonical(&action),
            NativeInvocationContext::new(&base).with_record(Some(&row)),
            &host,
        );
        assert_eq!(failed, NativeInvocationOutcome::Failed);
        assert!(!failed.message().contains("private"));
        assert!(!dispatcher.pending());
        base.form_values.insert("name".into(), json!("retry/raw"));
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                NativeInvocationContext::new(&base).with_record(Some(&row)),
                &host
            ),
            NativeInvocationOutcome::Succeeded
        );
        assert_eq!(
            *requests.borrow(),
            [
                json!({"id":0,"flag":false,"name":"raw/e\u{301}"}),
                json!({"id":0,"flag":false,"name":"retry/raw"})
            ]
        );
    }

    #[test]
    fn non_rpc_consent_rechecks_revocable_policy_and_false_never_refreshes() {
        let base = context();
        let scope = NativeInvocationContext::new(&base).with_record(None);
        let allowed = Cell::new(true);
        let calls = Cell::new(0);
        let refreshes = Cell::new(0);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            calls.set(calls.get() + 1);
            Ok(())
        };
        let policy = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| allowed.get();
        let confirm =
            |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                allowed.set(false);
                Ok(true)
            };
        let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
            refreshes.set(refreshes.get() + 1);
            Ok(())
        };
        let action = actions().remove(6);
        let dispatcher = NativeInvocationDispatcher::default();
        assert_eq!(
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                scope,
                &NativeInvocationHost {
                    copy: Some(&effect),
                    admit: Some(&policy),
                    confirm: Some(&confirm),
                    ..Default::default()
                }
            ),
            NativeInvocationOutcome::Denied
        );
        assert_eq!(calls.get(), 0);
        allowed.set(true);
        for flag in [None, Some(false)] {
            let action = Affordance {
                refresh_on_success: flag,
                ..action.clone()
            };
            assert_eq!(
                dispatcher.invoke(
                    NativeAction::Canonical(&action),
                    scope,
                    &NativeInvocationHost {
                        copy: Some(&effect),
                        admit: Some(&policy),
                        refresh: Some(&refresh),
                        ..Default::default()
                    }
                ),
                NativeInvocationOutcome::Succeeded
            );
        }
        assert_eq!(calls.get(), 2);
        assert_eq!(refreshes.get(), 0);
    }
}
