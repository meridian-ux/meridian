//! Actual native form submission through the exported host seam.
use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_tui::ratatui::{backend::TestBackend, Terminal};
use meridian_tui::{
    NativeCancellation, NativeInvocationContext, NativeInvocationHost, NativeInvocationOutcome,
    NativeTarget, PanelView, RpcError, RpcInvoker, ViewHost,
};
use meridian_uiview::{proto::*, Context};
use prost::Message;
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

struct ReadHost;
impl RpcInvoker for ReadHost {
    fn invoke(&self, _: &str, _: &str, _: Value) -> Result<Value, RpcError> {
        panic!("no populate or mutation transport should be invoked");
    }
}
fn retired_submit(form: FormPanel, call: RpcCall) -> FormPanel {
    let mut wire = form.encode_to_vec();
    let payload = call.encode_to_vec();
    prost::encoding::encode_key(3, prost::encoding::WireType::LengthDelimited, &mut wire);
    prost::encoding::encode_varint(payload.len() as u64, &mut wire);
    wire.extend_from_slice(&payload);
    FormPanel::decode(wire.as_slice()).unwrap()
}

fn descriptor(canonical: bool) -> PanelDescriptor {
    PanelDescriptor {
        title: "Edit record".into(),
        body: Some(panel_descriptor::Body::Form(Box::new(retired_submit(
            FormPanel {
                fields: vec![FormField {
                    field_id: "name".into(),
                    label: "Name".into(),
                    kind: Some(form_field::Kind::Text(TextInput {
                        default_value: "raw/e\u{301}".into(),
                        ..Default::default()
                    })),
                    ..Default::default()
                }],
                mode: FormMode::Edit as i32,
                submit_affordance: canonical.then(|| Box::new(Affordance::default())),
                ..Default::default()
            },
            RpcCall {
                service: "raw.Records".into(),
                method: "DeleteLegacyTrap".into(),
                ..Default::default()
            },
        )))),
        ..Default::default()
    }
}
fn form_mut(descriptor: &mut PanelDescriptor) -> &mut FormPanel {
    let Some(panel_descriptor::Body::Form(form)) = &mut descriptor.body else {
        panic!("not a form")
    };
    form
}
fn field(id: &str, kind: form_field::Kind) -> FormField {
    FormField {
        field_id: id.into(),
        label: id.into(),
        kind: Some(kind),
        ..Default::default()
    }
}
fn actual_form(invoke: Option<affordance::Invoke>) -> PanelDescriptor {
    let mut descriptor = descriptor(true);
    let form = form_mut(&mut descriptor);
    form.fields.push(field(
        "count",
        form_field::Kind::Integer(IntegerSpinner::default()),
    ));
    form.fields.push(field(
        "flag",
        form_field::Kind::Boolean(BooleanToggle::default()),
    ));
    form.submit_affordance = Some(Box::new(Affordance {
        label: "Save canonical".into(),
        invoke,
        refresh_on_success: Some(false),
        ..Default::default()
    }));
    descriptor
}
fn call() -> RpcCall {
    RpcCall {
        service: "raw.Records".into(),
        method: "Get".into(),
        bindings: vec![
            FieldBinding {
                request_field: "alias".into(),
                source: Some(field_binding::Source::FormField("name".into())),
            },
            FieldBinding {
                request_field: "row_id".into(),
                source: Some(field_binding::Source::RowField("id".into())),
            },
            FieldBinding {
                request_field: "hidden".into(),
                source: Some(field_binding::Source::FormField("hidden".into())),
            },
        ],
    }
}
fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn submit(
    view: &mut PanelView,
    descriptor: &PanelDescriptor,
    context: &Context,
    host: &NativeInvocationHost<'_>,
) -> Option<NativeInvocationOutcome> {
    view.handle_form_key_with_invocation(form(descriptor), context, key(KeyCode::Enter), host)
}
fn paint_at(
    view: &mut PanelView,
    descriptor: &PanelDescriptor,
    context: &Context,
    width: u16,
    reads: &impl RpcInvoker,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 16)).unwrap();
    terminal
        .draw(|f| view.render(f, f.area(), descriptor, context, reads))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
fn composed(descriptor: PanelDescriptor) -> ViewHost {
    use meridian_uiview::prost::Message;
    let view = ViewDescriptor {
        slots: vec![Slot {
            panel: Some(descriptor),
            ..Default::default()
        }],
        ..Default::default()
    };
    ViewHost::new(ViewDescriptor::decode(view.encode_to_vec().as_slice()).unwrap()).unwrap()
}
fn paint_view(
    view: &mut ViewHost,
    context: &Context,
    width: u16,
    reads: &impl RpcInvoker,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
    terminal
        .draw(|f| view.render(f, f.area(), context, reads))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}

#[test]
fn all_seven_targets_use_current_validated_values_in_standalone_and_composed_forms() {
    use affordance::Invoke;
    for width in [80, 140] {
        for in_view in [false, true] {
            for (intent, expected) in [
                (Invoke::Rpc(call()), "rpc"),
                (Invoke::Uri("cursor://raw".into()), "uri"),
                (Invoke::Command("literal\ncommand".into()), "command"),
                (
                    Invoke::Navigate(Navigate {
                        route: "/raw".into(),
                    }),
                    "navigate",
                ),
                (
                    Invoke::OpenPanel(Box::new(PanelDescriptor {
                        panel_id: "inline".into(),
                        ..Default::default()
                    })),
                    "panel",
                ),
                (Invoke::OpenView("raw-view".into()), "view"),
                (Invoke::Copy("private literal".into()), "copy"),
            ] {
                let descriptor = actual_form(Some(intent));
                let events = RefCell::new(vec![]);
                let context = Context {
                    selected_row: Some(json!({"id":0})),
                    form_values: [
                        ("name".into(), json!("ambient trap")),
                        ("hidden".into(), json!("private ambient")),
                    ]
                    .into(),
                    ..Default::default()
                };
                let check = |scope: NativeInvocationContext<'_>| {
                    assert_eq!(scope.form_value("name"), Some(&json!("raw/e\u{301}")));
                    assert_eq!(scope.form_value("flag"), Some(&json!(false)));
                    assert_eq!(scope.form_value("count"), Some(&json!(0)));
                    assert_eq!(scope.form_value("hidden"), None);
                    assert_eq!(scope.form_values().count(), 3);
                };
                let uri =
                    |value: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(value, "cursor://raw");
                        events.borrow_mut().push("uri");
                        Ok(())
                    };
                let command =
                    |value: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(value, "literal\ncommand");
                        events.borrow_mut().push("command");
                        Ok(())
                    };
                let view =
                    |value: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(value, "raw-view");
                        events.borrow_mut().push("view");
                        Ok(())
                    };
                let copy =
                    |value: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(value, "private literal");
                        events.borrow_mut().push("copy");
                        Ok(())
                    };
                let navigate = |route: &Navigate,
                                scope: NativeInvocationContext<'_>,
                                _: &NativeCancellation| {
                    check(scope);
                    assert_eq!(route.route, "/raw");
                    events.borrow_mut().push("navigate");
                    Ok(())
                };
                let panel = |value: &PanelDescriptor,
                             scope: NativeInvocationContext<'_>,
                             _: &NativeCancellation| {
                    check(scope);
                    assert_eq!(value.panel_id, "inline");
                    events.borrow_mut().push("panel");
                    Ok(())
                };
                let rpc = |source: &RpcCall,
                           request: Value,
                           scope: NativeInvocationContext<'_>,
                           _: &NativeCancellation| {
                    check(scope);
                    assert_eq!(source.method, "Get");
                    assert_eq!(
                        request,
                        json!({"alias":"raw/e\u{301}","row_id":0,"name":"raw/e\u{301}","count":0,"flag":false})
                    );
                    events.borrow_mut().push("rpc");
                    Ok(())
                };
                let mutations = |_: &RpcCall, scope: NativeInvocationContext<'_>| {
                    check(scope);
                    true
                };
                let allow = |_: NativeTarget<'_>, scope: NativeInvocationContext<'_>| {
                    check(scope);
                    true
                };
                let host = NativeInvocationHost {
                    rpc: Some(&rpc),
                    uri: Some(&uri),
                    command: Some(&command),
                    navigate: Some(&navigate),
                    open_panel: Some(&panel),
                    open_view: Some(&view),
                    copy: Some(&copy),
                    mutations: Some(&mutations),
                    admit: Some(&allow),
                    ..Default::default()
                };
                if in_view {
                    let mut state = composed(descriptor);
                    let screen = paint_view(&mut state, &context, width, &ReadHost);
                    assert!(screen.contains("Edit record"));
                    assert!(screen.contains("Save canonical"));
                    assert!(!screen.contains("private literal"));
                    assert!(events.borrow().is_empty());
                    assert!(state
                        .handle_key(key(KeyCode::Enter), &context)
                        .unwrap()
                        .is_none());
                    assert!(paint_view(&mut state, &context, width, &ReadHost)
                        .contains("Action denied:"));
                    assert!(state
                        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
                        .unwrap()
                        .is_none());
                    assert!(paint_view(&mut state, &context, width, &ReadHost)
                        .contains("Action completed."));
                } else {
                    let mut state = PanelView::new();
                    let screen = paint_at(&mut state, &descriptor, &context, width, &ReadHost);
                    assert!(screen.contains("Save canonical"));
                    assert!(!screen.contains("private literal"));
                    assert!(events.borrow().is_empty());
                    assert_eq!(
                        submit(
                            &mut state,
                            &descriptor,
                            &context,
                            &NativeInvocationHost::default()
                        ),
                        Some(NativeInvocationOutcome::Denied)
                    );
                    assert!(
                        paint_at(&mut state, &descriptor, &context, width, &ReadHost)
                            .contains("Action denied:")
                    );
                    assert_eq!(
                        submit(&mut state, &descriptor, &context, &host),
                        Some(NativeInvocationOutcome::Succeeded)
                    );
                    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
                }
                assert_eq!(*events.borrow(), [expected]);
            }
        }
    }
}

#[test]
fn invalid_values_and_unresolved_remote_enum_options_never_reach_policy_or_consent() {
    let context = Context::default();
    let work = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        work.set(work.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| {
        work.set(work.get() + 1);
        true
    };
    let confirm = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        work.set(work.get() + 1);
        Ok(true)
    };
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        confirm: Some(&confirm),
        ..Default::default()
    };
    for pattern in ["^allowed$", "(?=lookaround)", "[invalid"] {
        let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
        let Some(form_field::Kind::Text(spec)) = &mut form_mut(&mut descriptor).fields[0].kind
        else {
            panic!()
        };
        spec.pattern = pattern.into();
        let mut state = PanelView::new();
        paint(&mut state, &descriptor, &context);
        assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
        assert!(!paint(&mut state, &descriptor, &context).contains("Action completed."));
    }
    let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    form_mut(&mut descriptor).fields = vec![field(
        "choice",
        form_field::Kind::EnumSelection(EnumSelection {
            default_value: "stale".into(),
            allowed_values: vec!["stale".into()],
            options_source: Some(OptionsSource {
                service: "raw.Options".into(),
                method: "List".into(),
                ..Default::default()
            }),
            ..Default::default()
        }),
    )];
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(work.get(), 0);
}

#[test]
fn missing_intent_read_named_rpc_and_non_rpc_capability_are_not_fallback_grants() {
    let context = Context::default();
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let rpc = |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    for intent in [
        None,
        Some(affordance::Invoke::Rpc(call())),
        Some(affordance::Invoke::Command("never-copy".into())),
        Some(affordance::Invoke::Uri("javascript:bad".into())),
    ] {
        let descriptor = actual_form(intent);
        let mut state = PanelView::new();
        paint(&mut state, &descriptor, &context);
        assert_eq!(
            submit(&mut state, &descriptor, &context, &host),
            Some(NativeInvocationOutcome::Denied)
        );
        assert!(paint(&mut state, &descriptor, &context).contains("Action denied:"));
    }
    assert_eq!(effects.get(), 0);
}

#[test]
fn consent_revocation_transport_failure_retry_and_completed_refresh_failure_keep_edits() {
    let descriptor = actual_form(Some(affordance::Invoke::Rpc(call())));
    let context = Context::default();
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    let requests = RefCell::new(vec![]);
    let permitted = Cell::new(true);
    let fail = Cell::new(true);
    let rpc =
        |_: &RpcCall, request: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            if fail.get() {
                Err(RpcError::Other("private transport response".into()))
            } else {
                Ok(())
            }
        };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| permitted.get();
    let revoke = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        permitted.set(false);
        Ok(true)
    };
    assert_eq!(
        submit(
            &mut state,
            &descriptor,
            &context,
            &NativeInvocationHost {
                rpc: Some(&rpc),
                mutations: Some(&policy),
                confirm: Some(&revoke),
                ..Default::default()
            }
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    assert!(requests.borrow().is_empty());
    permitted.set(true);
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Failed)
    );
    let screen = paint(&mut state, &descriptor, &context);
    assert!(screen.contains("raw/e\u{301}"));
    assert!(!screen.contains("private transport response"));
    state.handle_form_key_with_invocation(
        form(&descriptor),
        &context,
        key(KeyCode::Char('x')),
        &host,
    );
    fail.set(false);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(requests.borrow().len(), 2);
    assert_eq!(requests.borrow()[1]["name"], json!("raw/e\u{301}x"));
    let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    form_mut(&mut descriptor)
        .submit_affordance
        .as_mut()
        .unwrap()
        .refresh_on_success = Some(true);
    let mut state = PanelView::new();
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    paint(&mut state, &descriptor, &context);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::RefreshFailed)
    );
    assert!(paint(&mut state, &descriptor, &context).contains("Do not repeat"));
    state.handle_form_key_with_invocation(form(&descriptor), &context, key(KeyCode::Tab), &host);
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    assert!(paint(&mut state, &descriptor, &context).contains("Do not repeat"));
    assert_eq!(effects.get(), 1);
}

#[test]
fn retired_submission_cannot_revive_and_canonical_submission_is_admitted_without_a_raw_handoff() {
    let mut descriptor = actual_form(None);
    let panel = form_mut(&mut descriptor);
    panel.submit_affordance = None;
    let context = Context::default();
    let requests = RefCell::new(vec![]);
    let rpc =
        |_: &RpcCall, request: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            Ok(())
        };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    let mut state = composed(descriptor.clone());
    paint_view(&mut state, &context, 140, &ReadHost);
    assert!(state
        .handle_key_with_invocation(
            key(KeyCode::Enter),
            &context,
            &NativeInvocationHost::default()
        )
        .unwrap()
        .is_none());
    assert!(requests.borrow().is_empty());
    assert!(state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap()
        .is_none());
    assert_eq!(
        requests.borrow().len(),
        0,
        "retired wire submit cannot grant a canonical target"
    );
    form_mut(&mut descriptor).submit_affordance = Some(Box::new(Affordance {
        invoke: Some(affordance::Invoke::Rpc(call())),
        ..Default::default()
    }));
    let mut state = composed(descriptor.clone());
    paint_view(&mut state, &context, 140, &ReadHost);
    assert!(state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap()
        .is_none());
    assert_eq!(requests.borrow().len(), 1);
    form_mut(&mut descriptor).mode = FormMode::Readonly as i32;
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    assert_eq!(requests.borrow().len(), 1);
}

#[test]
fn ambient_record_nested_values_and_declared_field_ids_use_the_real_form_assembler() {
    let mut descriptor = actual_form(Some(affordance::Invoke::Rpc(call())));
    let Some(affordance::Invoke::Rpc(call)) = form_mut(&mut descriptor)
        .submit_affordance
        .as_mut()
        .unwrap()
        .invoke
        .as_mut()
    else {
        panic!()
    };
    call.bindings.push(FieldBinding {
        request_field: "name".into(),
        source: Some(field_binding::Source::RowField("backend_name".into())),
    });
    form_mut(&mut descriptor).fields.extend([
        field(
            "nested",
            form_field::Kind::Nested(NestedForm {
                fields: vec![field(
                    "enabled",
                    form_field::Kind::Boolean(BooleanToggle::default()),
                )],
            }),
        ),
        field(
            "items",
            form_field::Kind::Repeated(Box::new(RepeatedField {
                element: Some(repeated_field::Element::Scalar(Box::new(field(
                    "item",
                    form_field::Kind::Integer(IntegerSpinner::default()),
                )))),
                ..Default::default()
            })),
        ),
        field(
            "map",
            form_field::Kind::KeyValueMap(KeyValueMapField::default()),
        ),
    ]);
    let record = json!({"id":0,"name":"raw/e\u{301}","backend_name":"binding wins","flag":false,"count":0,"nested":{"enabled":false},"items":[0,1],"map":{"raw":"value"},"hidden":"unmodeled trap"});
    let context = Context {
        selected_row: Some(json!({"id":"ambient trap"})),
        ..Default::default()
    };
    let mut state = PanelView::new();
    state.set_record(Some(Arc::new(record))).unwrap();
    paint(&mut state, &descriptor, &context);
    let requests = RefCell::new(vec![]);
    let rpc = |_: &RpcCall,
               request: Value,
               scope: NativeInvocationContext<'_>,
               _: &NativeCancellation| {
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        assert_eq!(scope.form_value("name"), Some(&json!("raw/e\u{301}")));
        assert_eq!(scope.form_value("hidden"), None);
        requests.borrow_mut().push(request);
        Ok(())
    };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(
        requests.borrow()[0],
        json!({"name":"binding wins","alias":"raw/e\u{301}","flag":false,"count":0,"row_id":0,"nested":{"enabled":false},"items":[0,1],"map":{"raw":"value"}})
    );
}

#[test]
fn repeated_enter_and_old_declaration_do_not_duplicate_a_completed_form() {
    let descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    let context = Context::default();
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    let mut repeat = key(KeyCode::Enter);
    repeat.kind = KeyEventKind::Repeat;
    assert_eq!(
        state.handle_form_key_with_invocation(form(&descriptor), &context, repeat, &host),
        None
    );
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    let mut replacement = descriptor.clone();
    form_mut(&mut replacement)
        .submit_affordance
        .as_mut()
        .unwrap()
        .invoke = Some(affordance::Invoke::Copy("replacement".into()));
    assert_eq!(submit(&mut state, &replacement, &context, &host), None);
    assert_eq!(effects.get(), 1);
}

#[test]
fn prefill_refetches_changed_context_and_cumulative_merge_limit_fails_before_copy() {
    struct Prefill {
        requests: RefCell<Vec<Value>>,
        large: bool,
    }
    impl RpcInvoker for Prefill {
        fn invoke(&self, _: &str, method: &str, request: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "Prefill");
            self.requests.borrow_mut().push(request.clone());
            Ok(if self.large {
                json!({"right":"x".repeat(2_100_000)})
            } else {
                json!({"name":request["path"],"hidden":"unmodeled prefill"})
            })
        }
    }
    let mut descriptor = actual_form(Some(affordance::Invoke::Rpc(call())));
    form_mut(&mut descriptor).prefill = Some(RpcCall {
        service: "raw.Records".into(),
        method: "Prefill".into(),
        bindings: vec![FieldBinding {
            request_field: "path".into(),
            source: Some(field_binding::Source::Context(
                ContextSource::CurrentResourcePath as i32,
            )),
        }],
    });
    let reads = Prefill {
        requests: RefCell::new(vec![]),
        large: false,
    };
    let mut context = Context {
        current_resource_path: Some("first".into()),
        ..Default::default()
    };
    let mut state = PanelView::new();
    assert!(paint_at(&mut state, &descriptor, &context, 140, &reads).contains("Name: first"));
    paint_at(&mut state, &descriptor, &context, 140, &reads);
    assert_eq!(reads.requests.borrow().len(), 1);
    context.current_resource_path = Some("replacement".into());
    let writes = RefCell::new(vec![]);
    let rpc = |_: &RpcCall,
               request: Value,
               scope: NativeInvocationContext<'_>,
               _: &NativeCancellation| {
        assert_eq!(scope.form_value("hidden"), None);
        writes.borrow_mut().push(request);
        Ok(())
    };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    assert!(writes.borrow().is_empty());
    assert!(paint_at(&mut state, &descriptor, &context, 140, &reads).contains("Name: replacement"));
    assert_eq!(reads.requests.borrow().len(), 2);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(writes.borrow()[0]["name"], json!("replacement"));
    let reads = Prefill {
        requests: RefCell::new(vec![]),
        large: true,
    };
    let mut state = PanelView::new();
    state
        .set_record(Some(Arc::new(json!({"left":"x".repeat(2_100_000)}))))
        .unwrap();
    assert!(paint_at(&mut state, &descriptor, &context, 140, &reads)
        .contains("Request construction limit exceeded"));
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    assert_eq!(writes.borrow().len(), 1);
}

#[test]
fn local_record_predicate_and_rust_unicode_validation_are_authoritative() {
    let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    form_mut(&mut descriptor)
        .submit_affordance
        .as_mut()
        .unwrap()
        .enabled_when = Some(RowFilter {
        field_path: "enabled".into(),
        equals: "true".into(),
    });
    let context = Context {
        selected_row: Some(json!({"enabled":true})),
        ..Default::default()
    };
    let mut state = PanelView::new();
    state
        .set_record(Some(Arc::new(json!({"enabled":false}))))
        .unwrap();
    paint(&mut state, &descriptor, &context);
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(effects.get(), 0);
    state
        .set_record(Some(Arc::new(json!({"enabled":true}))))
        .unwrap();
    paint(&mut state, &descriptor, &context);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    let Some(form_field::Kind::Text(spec)) = &mut form_mut(&mut descriptor).fields[0].kind else {
        panic!()
    };
    spec.pattern = "^\\d+$".into();
    spec.default_value = "١٢".into();
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.get(), 2);
}

#[test]
fn committing_a_compound_editor_is_not_submitting_the_form() {
    let mut descriptor = actual_form(Some(affordance::Invoke::Copy("literal".into())));
    form_mut(&mut descriptor).fields = vec![field(
        "nested",
        form_field::Kind::Nested(NestedForm {
            fields: vec![field(
                "enabled",
                form_field::Kind::Boolean(BooleanToggle::default()),
            )],
        }),
    )];
    let context = Context::default();
    let mut state = PanelView::new();
    paint(&mut state, &descriptor, &context);
    let effects = Cell::new(0);
    let effect = |_: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
        assert_eq!(scope.form_value("nested"), Some(&json!({"enabled":true})));
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    state.handle_form_key_with_invocation(form(&descriptor), &context, key(KeyCode::F(2)), &host);
    state.handle_form_key_with_invocation(form(&descriptor), &context, key(KeyCode::Delete), &host);
    for c in "{\"enabled\":true}".chars() {
        state.handle_form_key_with_invocation(
            form(&descriptor),
            &context,
            key(KeyCode::Char(c)),
            &host,
        );
    }
    assert_eq!(submit(&mut state, &descriptor, &context, &host), None);
    assert_eq!(effects.get(), 0);
    assert_eq!(
        submit(&mut state, &descriptor, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.get(), 1);
}

#[test]
fn composed_form_and_header_share_single_flight_until_owned_worker_settles() {
    use std::{sync::mpsc, thread, time::Duration};
    let descriptor = actual_form(Some(affordance::Invoke::Copy("form".into())));
    let panel = form(&descriptor).clone();
    let mut state = ViewHost::new(ViewDescriptor {
        affordances: Some(AffordanceCollection {
            items: vec![Affordance {
                label: "Header".into(),
                invoke: Some(affordance::Invoke::Copy("header".into())),
                ..Default::default()
            }],
        }),
        slots: vec![Slot {
            panel: Some(descriptor),
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let mut context = Context::default();
    paint_view(&mut state, &context, 140, &ReadHost);
    let dispatcher = state.invocation_dispatcher();
    let retained = dispatcher.clone();
    let (start_tx, start_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let values = json!({"name":"worker","count":0,"flag":false});
        let context = Context::default();
        let effect = |_: &str, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
            start_tx.send(signal.clone()).unwrap();
            finish_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        dispatcher.invoke(
            meridian_tui::NativeAction::Form(&panel, &values),
            NativeInvocationContext::new(&context),
            &NativeInvocationHost {
                copy: Some(&effect),
                admit: Some(&allow),
                ..Default::default()
            },
        )
    });
    let signal = start_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    assert!(state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap()
        .is_none());
    assert!(paint_view(&mut state, &context, 140, &ReadHost).contains("already running"));
    state
        .handle_key_with_invocation(key(KeyCode::F(6)), &context, &host)
        .unwrap();
    state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap();
    assert!(paint_view(&mut state, &context, 140, &ReadHost).contains("already running"));
    assert_eq!(effects.get(), 0);
    context.current_resource_path = Some("replacement".into());
    paint_view(&mut state, &context, 140, &ReadHost);
    assert!(signal.is_cancelled());
    assert!(retained.pending());
    finish_tx.send(()).unwrap();
    assert_eq!(worker.join().unwrap(), NativeInvocationOutcome::Cancelled);
    assert!(!retained.pending());
    state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap();
    assert_eq!(effects.get(), 1);
}

#[test]
fn repeated_form_parent_read_is_revalidated_even_when_local_record_is_unchanged() {
    struct Rows(RefCell<Vec<Value>>);
    impl RpcInvoker for Rows {
        fn invoke(&self, _: &str, method: &str, request: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "Rows");
            self.0.borrow_mut().push(request);
            Ok(json!({"rows":[{"id":0}]}))
        }
    }
    let child = ViewDescriptor {
        slots: vec![Slot {
            panel: Some(actual_form(Some(affordance::Invoke::Copy(
                "literal".into(),
            )))),
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut state = ViewHost::new(ViewDescriptor {
        slots: vec![Slot {
            sub_view: Some(child),
            sub_view_populate: Some(RpcCall {
                service: "raw.Records".into(),
                method: "Rows".into(),
                bindings: vec![FieldBinding {
                    request_field: "scope".into(),
                    source: Some(field_binding::Source::RowField("scope".into())),
                }],
            }),
            sub_view_rows_field: "rows".into(),
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let reads = Rows(RefCell::new(vec![]));
    let mut context = Context {
        selected_row: Some(json!({"scope":"first"})),
        ..Default::default()
    };
    paint_view(&mut state, &context, 140, &reads);
    let effects = Cell::new(0);
    let effect = |_: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    context.selected_row = Some(json!({"scope":"replacement"}));
    state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap();
    assert_eq!(effects.get(), 0);
    paint_view(&mut state, &context, 140, &reads);
    state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap();
    assert_eq!(effects.get(), 1);
    assert_eq!(
        *reads.0.borrow(),
        [json!({"scope":"first"}), json!({"scope":"replacement"})]
    );
}
fn form(descriptor: &PanelDescriptor) -> &FormPanel {
    let Some(panel_descriptor::Body::Form(form)) = &descriptor.body else {
        panic!("not a form")
    };
    form
}
fn paint(view: &mut PanelView, descriptor: &PanelDescriptor, context: &Context) -> String {
    let mut terminal = Terminal::new(TestBackend::new(140, 16)).unwrap();
    terminal
        .draw(|f| view.render(f, f.area(), descriptor, context, &ReadHost))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
#[test]
fn canonical_submission_presence_never_returns_the_legacy_rpc_trap() {
    let descriptor = descriptor(true);
    let context = Context::default();
    let mut view = PanelView::new();
    paint(&mut view, &descriptor, &context);
    assert!(view
        .handle_form_key(form(&descriptor), &context, KeyCode::Enter)
        .is_none());
}
#[test]
fn obsolete_form_context_cannot_retarget_old_values_before_redraw() {
    let descriptor = descriptor(false);
    let mut context = Context {
        current_resource_path: Some("first".into()),
        ..Default::default()
    };
    let mut view = PanelView::new();
    paint(&mut view, &descriptor, &context);
    context.current_resource_path = Some("replacement".into());
    assert!(view
        .handle_form_key(form(&descriptor), &context, KeyCode::Enter)
        .is_none());
}
