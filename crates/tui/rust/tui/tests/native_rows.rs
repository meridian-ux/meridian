//! Current-row admission through actual exported native widgets.
use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_tui::ratatui::{backend::TestBackend, Terminal};
use meridian_tui::{
    NativeAction, NativeCancellation, NativeInvocationContext, NativeInvocationHost,
    NativeInvocationOutcome, NativeTarget, PanelView, RpcError, RpcInvoker, ViewHost,
};
use meridian_uiview::{proto::*, Context};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};

struct Reads {
    rows: Value,
}
impl RpcInvoker for Reads {
    fn invoke(&self, _: &str, method: &str, _: Value) -> Result<Value, RpcError> {
        assert_eq!(method, "Rows", "rendering may only call the declared read");
        Ok(self.rows.clone())
    }
}
fn read() -> RpcCall {
    RpcCall {
        service: "raw.Records".into(),
        method: "Rows".into(),
        ..Default::default()
    }
}
#[allow(deprecated)] // Legacy row fixture; canonical tests override as a unit.
fn table() -> PanelDescriptor {
    PanelDescriptor {
        title: "Records".into(),
        body: Some(panel_descriptor::Body::Table(TablePanel {
            populate: Some(read()),
            rows_field: "rows".into(),
            columns: vec![TableColumn {
                field_path: "name".into(),
                header: "Name".into(),
                ..Default::default()
            }],
            actions: vec![RowAction {
                label: "Legacy trap".into(),
                rpc: Some(RpcCall {
                    method: "DeleteLegacyTrap".into(),
                    ..read()
                }),
                ..Default::default()
            }],
            affordances: Some(AffordanceCollection {
                items: vec![Affordance {
                    label: "Canonical archive".into(),
                    invoke: Some(affordance::Invoke::Copy("private literal".into())),
                    ..Default::default()
                }],
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}
fn table_mut(panel: &mut PanelDescriptor) -> &mut TablePanel {
    let Some(panel_descriptor::Body::Table(table)) = &mut panel.body else {
        panic!("not a table")
    };
    table
}
fn resource_mut(panel: &mut PanelDescriptor) -> &mut ResourceCardPanel {
    let Some(panel_descriptor::Body::ResourceCards(cards)) = &mut panel.body else {
        panic!("not resources")
    };
    cards
}
fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn call() -> RpcCall {
    RpcCall {
        service: "raw.Records".into(),
        method: "Get".into(),
        bindings: vec![
            FieldBinding {
                request_field: "row_id".into(),
                source: Some(field_binding::Source::RowField("id".into())),
            },
            FieldBinding {
                request_field: "zero".into(),
                source: Some(field_binding::Source::RowField("count".into())),
            },
            FieldBinding {
                request_field: "flag".into(),
                source: Some(field_binding::Source::RowField("enabled".into())),
            },
            FieldBinding {
                request_field: "name".into(),
                source: Some(field_binding::Source::RowField("token".into())),
            },
        ],
    }
}
fn rows() -> Reads {
    Reads {
        rows: json!({"rows":[{"id":0,"name":"Displayed first","token":"raw/e\u{301}","count":0,"enabled":false,"state":"ready"},{"id":1,"name":"Displayed second","token":"second","count":2,"enabled":true,"state":"hidden"}]}),
    }
}
fn paint_at(
    state: &mut PanelView,
    panel: &PanelDescriptor,
    context: &Context,
    reads: &Reads,
    width: u16,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 20)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), panel, context, reads))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
fn paint_view(
    state: &mut ViewHost,
    context: &Context,
    reads: &impl RpcInvoker,
    width: u16,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), context, reads))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
fn composed(panel: PanelDescriptor) -> ViewHost {
    use meridian_uiview::prost::Message;
    let descriptor = ViewDescriptor {
        slots: vec![Slot {
            panel: Some(panel),
            ..Default::default()
        }],
        ..Default::default()
    };
    ViewHost::new(ViewDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap()).unwrap()
}
fn activate(
    state: &mut PanelView,
    panel: &PanelDescriptor,
    context: &Context,
    host: &NativeInvocationHost<'_>,
) -> Option<NativeInvocationOutcome> {
    state.handle_action_key_with_invocation(panel, context, key(KeyCode::Enter), host)
}

#[test]
fn seven_canonical_targets_use_raw_selected_rows_in_standalone_and_composed_tables() {
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
                let mut panel = table();
                table_mut(&mut panel).affordances = Some(AffordanceCollection {
                    items: vec![Affordance {
                        label: "Canonical archive".into(),
                        invoke: Some(intent),
                        refresh_on_success: Some(false),
                        ..Default::default()
                    }],
                });
                let context = Context {
                    selected_row: Some(json!({"id":"ambient trap"})),
                    ..Default::default()
                };
                let reads = rows();
                let events = RefCell::new(vec![]);
                let check = |scope: NativeInvocationContext<'_>| {
                    let row = scope.selected_row().unwrap();
                    assert_eq!(row["id"], json!(0));
                    assert_eq!(row["count"], json!(0));
                    assert_eq!(row["enabled"], json!(false));
                    assert_eq!(row["token"], json!("raw/e\u{301}"));
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
                let navigate = |value: &Navigate,
                                scope: NativeInvocationContext<'_>,
                                _: &NativeCancellation| {
                    check(scope);
                    assert_eq!(value.route, "/raw");
                    events.borrow_mut().push("navigate");
                    Ok(())
                };
                let open_panel = |value: &PanelDescriptor,
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
                        json!({"row_id":0,"zero":0,"flag":false,"name":"raw/e\u{301}"})
                    );
                    events.borrow_mut().push("rpc");
                    Ok(())
                };
                let policy = |_: &RpcCall, scope: NativeInvocationContext<'_>| {
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
                    open_panel: Some(&open_panel),
                    open_view: Some(&view),
                    copy: Some(&copy),
                    mutations: Some(&policy),
                    admit: Some(&allow),
                    ..Default::default()
                };
                if in_view {
                    let mut state = composed(panel);
                    paint_view(&mut state, &context, &reads, width);
                    state.handle_key(key(KeyCode::Down), &context).unwrap();
                    let screen = paint_view(&mut state, &context, &reads, width);
                    assert!(screen.contains("Canonical archive"));
                    assert!(!screen.contains("Legacy trap"));
                    assert!(!screen.contains("private literal"));
                    assert!(state
                        .handle_key(key(KeyCode::Enter), &context)
                        .unwrap()
                        .is_none());
                    assert!(
                        paint_view(&mut state, &context, &reads, width).contains("Action denied:")
                    );
                    assert!(events.borrow().is_empty());
                    assert!(state
                        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
                        .unwrap()
                        .is_none());
                    assert!(paint_view(&mut state, &context, &reads, width)
                        .contains("Action completed."));
                } else {
                    let mut state = PanelView::new();
                    paint_at(&mut state, &panel, &context, &reads, width);
                    state.select_next();
                    paint_at(&mut state, &panel, &context, &reads, width);
                    assert_eq!(
                        activate(
                            &mut state,
                            &panel,
                            &context,
                            &NativeInvocationHost::default()
                        ),
                        Some(NativeInvocationOutcome::Denied)
                    );
                    assert!(paint_at(&mut state, &panel, &context, &reads, width)
                        .contains("Action denied:"));
                    assert!(events.borrow().is_empty());
                    assert_eq!(
                        activate(&mut state, &panel, &context, &host),
                        Some(NativeInvocationOutcome::Succeeded)
                    );
                }
                assert_eq!(*events.borrow(), [expected]);
            }
        }
    }
}

#[test]
fn empty_canonical_missing_subject_capability_and_intent_never_use_ambient_fallback() {
    let context = Context {
        selected_row: Some(json!({"id":"ambient trap"})),
        ..Default::default()
    };
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
    let mut panel = table();
    let mut state = PanelView::new();
    let reads = rows();
    paint(&mut state, &panel, &context, &reads);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    table_mut(&mut panel)
        .affordances
        .as_mut()
        .unwrap()
        .items
        .clear();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    let screen = paint(&mut state, &panel, &context, &reads);
    assert!(!screen.contains("Legacy trap"));
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    for intent in [
        None,
        Some(affordance::Invoke::Command("never-copy".into())),
        Some(affordance::Invoke::Uri("javascript:bad".into())),
        Some(affordance::Invoke::Rpc(call())),
    ] {
        table_mut(&mut panel).affordances = Some(AffordanceCollection {
            items: vec![Affordance {
                invoke: intent,
                ..Default::default()
            }],
        });
        let mut state = PanelView::new();
        paint(&mut state, &panel, &context, &reads);
        state.select_next();
        paint(&mut state, &panel, &context, &reads);
        assert_eq!(
            activate(&mut state, &panel, &context, &host),
            Some(NativeInvocationOutcome::Denied)
        );
    }
    assert_eq!(effects.get(), 0);
}

#[test]
#[allow(deprecated)] // Deliberately verifies the retained old row contract.
fn legacy_row_predicate_is_current_and_requests_never_invent_an_id_binding() {
    let mut panel = table();
    let table = table_mut(&mut panel);
    table.affordances = None;
    table.actions = vec![RowAction {
        label: "Legacy row".into(),
        rpc: Some(call()),
        enabled_when: Some(RowFilter {
            field_path: "enabled".into(),
            equals: "true".into(),
        }),
        ..Default::default()
    }];
    let context = Context {
        selected_row: Some(json!({"enabled":true})),
        ..Default::default()
    };
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let requests = RefCell::new(vec![]);
    let policies = Cell::new(0);
    let rpc =
        |_: &RpcCall, request: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            Ok(())
        };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| {
        policies.set(policies.get() + 1);
        true
    };
    let refreshes = Cell::new(0);
    let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
        refreshes.set(refreshes.get() + 1);
        Ok(())
    };
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        refresh: Some(&refresh),
        ..Default::default()
    };
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(policies.get(), 0);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(
        requests.borrow()[0],
        json!({"row_id":1,"zero":2,"flag":true,"name":"second"})
    );
    assert_eq!(refreshes.get(), 1);
    table_mut(&mut panel).actions[0]
        .rpc
        .as_mut()
        .unwrap()
        .bindings
        .clear();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(requests.borrow()[1], json!({}));
}

#[test]
fn resource_confirmation_is_literal_mandatory_and_does_not_preserve_revoked_permission() {
    let action = ResourceAction {
        id: "lifecycle-stop".into(),
        label: "Stop resource".into(),
        invoke: Some(call()),
        visible_when: "state == ready".into(),
        confirm: Some(ConfirmSpec {
            title: "Literal ${name}".into(),
            message: "<do not interpolate>".into(),
            confirm_label: "Proceed".into(),
            destructive: true,
        }),
        ..Default::default()
    };
    let panel = resources(action.clone());
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    let writes = Cell::new(0);
    let confirms = Cell::new(0);
    let permit = Cell::new(true);
    let consent = Cell::new(false);
    let revoke = Cell::new(false);
    let rpc = |_: &RpcCall,
               request: Value,
               scope: NativeInvocationContext<'_>,
               _: &NativeCancellation| {
        assert_eq!(
            request,
            json!({"row_id":0,"zero":0,"flag":false,"name":"raw/e\u{301}"})
        );
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        writes.set(writes.get() + 1);
        Ok(())
    };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| permit.get();
    let generic = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        panic!("generic consent must not replace required resource confirmation")
    };
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost {
                rpc: Some(&rpc),
                mutations: Some(&policy),
                confirm: Some(&generic),
                ..Default::default()
            }
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    let confirm = |spec: &ConfirmSpec,
                   target: NativeTarget<'_>,
                   scope: NativeInvocationContext<'_>,
                   _: &NativeCancellation| {
        assert_eq!(Some(spec), action.confirm.as_ref());
        assert!(matches!(target, NativeTarget::Rpc(_)));
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        confirms.set(confirms.get() + 1);
        if revoke.get() {
            permit.set(false);
        }
        Ok(consent.get())
    };
    let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| Ok(());
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        confirm_resource: Some(&confirm),
        refresh: Some(&refresh),
        ..Default::default()
    };
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Cancelled)
    );
    assert_eq!(writes.get(), 0);
    consent.set(true);
    revoke.set(true);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(writes.get(), 0);
    permit.set(true);
    revoke.set(false);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(writes.get(), 1);
    assert_eq!(confirms.get(), 3);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    assert!(!paint(&mut state, &panel, &context, &reads).contains("Stop resource"));
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(confirms.get(), 3);
}

#[test]
fn resource_semantic_ids_need_a_pure_typed_resolver_not_a_route_or_rpc_fallback() {
    let mut panel = resources(ResourceAction {
        id: "semantic:copy".into(),
        label: "Resolve resource".into(),
        ..Default::default()
    });
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    let effects = Cell::new(0);
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        assert_eq!(value, "resolved literal");
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost {
                copy: Some(&effect),
                admit: Some(&allow),
                ..Default::default()
            }
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    let resolve = |source: &ResourceAction, scope: NativeInvocationContext<'_>| {
        assert_eq!(source.id, "semantic:copy");
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        Some(Affordance {
            invoke: Some(affordance::Invoke::Copy("resolved literal".into())),
            refresh_on_success: Some(false),
            ..Default::default()
        })
    };
    let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
        panic!("explicit false suppresses legacy refresh")
    };
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost {
                copy: Some(&effect),
                admit: Some(&allow),
                resolve_resource: Some(&resolve),
                refresh: Some(&refresh),
                ..Default::default()
            }
        ),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.get(), 1);
    let spec = ConfirmSpec {
        title: "Literal ${name}".into(),
        message: "Do not interpolate".into(),
        confirm_label: "Proceed".into(),
        destructive: true,
    };
    resource_mut(&mut panel)
        .template
        .as_mut()
        .unwrap()
        .actions
        .as_mut()
        .unwrap()
        .actions[0]
        .confirm = Some(spec.clone());
    paint(&mut state, &panel, &context, &reads);
    let generic = |_: &Action, _: NativeInvocationContext<'_>| {
        panic!("resource IDs must not use the generic action resolver")
    };
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        resolve_resource: Some(&resolve),
        resolve_semantic: Some(&generic),
        refresh: Some(&refresh),
        ..Default::default()
    };
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Denied)
    );
    assert_eq!(effects.get(), 1);
    let confirm = |actual: &ConfirmSpec,
                   target: NativeTarget<'_>,
                   scope: NativeInvocationContext<'_>,
                   _: &NativeCancellation| {
        assert_eq!(actual, &spec);
        assert!(matches!(target, NativeTarget::Copy("resolved literal")));
        assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
        Ok(true)
    };
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost {
                confirm_resource: Some(&confirm),
                ..host
            }
        ),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.get(), 2);
}

#[test]
fn repeated_parent_request_freshness_protects_table_and_resource_children() {
    struct ParentReads {
        parents: RefCell<Vec<Value>>,
    }
    impl RpcInvoker for ParentReads {
        fn invoke(&self, _: &str, method: &str, request: Value) -> Result<Value, RpcError> {
            match method {
                "Parents" => {
                    self.parents.borrow_mut().push(request);
                    Ok(json!({"rows":[{"id":"parent"}]}))
                }
                "Rows" => Ok(rows().rows),
                _ => panic!("unexpected read"),
            }
        }
    }
    for resource in [false, true] {
        let panel = if resource {
            resources(ResourceAction {
                label: "Archive resource".into(),
                invoke: Some(call()),
                ..Default::default()
            })
        } else {
            table()
        };
        let descriptor = ViewDescriptor {
            slots: vec![Slot {
                sub_view: Some(ViewDescriptor {
                    slots: vec![Slot {
                        panel: Some(panel),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                sub_view_populate: Some(RpcCall {
                    method: "Parents".into(),
                    bindings: vec![FieldBinding {
                        request_field: "scope".into(),
                        source: Some(field_binding::Source::RowField("scope".into())),
                    }],
                    ..read()
                }),
                sub_view_rows_field: "rows".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut state = ViewHost::new(descriptor).unwrap();
        let reads = ParentReads {
            parents: RefCell::new(vec![]),
        };
        let mut context = Context {
            selected_row: Some(json!({"scope":"first"})),
            ..Default::default()
        };
        paint_view(&mut state, &context, &reads, 140);
        if !resource {
            state.handle_key(key(KeyCode::Down), &context).unwrap();
            paint_view(&mut state, &context, &reads, 140);
        }
        let effects = Cell::new(0);
        let copy = |_: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
            assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
            effects.set(effects.get() + 1);
            Ok(())
        };
        let rpc =
            |_: &RpcCall, _: Value, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
                assert_eq!(scope.selected_row().unwrap()["id"], json!(0));
                effects.set(effects.get() + 1);
                Ok(())
            };
        let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| Ok(());
        let host = NativeInvocationHost {
            rpc: Some(&rpc),
            mutations: Some(&policy),
            copy: Some(&copy),
            admit: Some(&allow),
            refresh: Some(&refresh),
            ..Default::default()
        };
        context.selected_row = Some(json!({"scope":"replacement"}));
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(effects.get(), 0, "stale parent resource={resource}");
        paint_view(&mut state, &context, &reads, 140);
        if !resource {
            state.handle_key(key(KeyCode::Down), &context).unwrap();
            paint_view(&mut state, &context, &reads, 140);
        }
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(effects.get(), 1, "fresh parent resource={resource}");
        assert_eq!(
            *reads.parents.borrow(),
            [json!({"scope":"first"}), json!({"scope":"replacement"})]
        );
    }
}

#[test]
fn source_context_and_selection_changes_require_a_current_draw_before_execution() {
    let mut panel = table();
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let effects = RefCell::new(vec![]);
    let effect = |value: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.borrow_mut().push((
            value.to_owned(),
            scope.selected_row().unwrap()["id"].clone(),
        ));
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    state.select_next();
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    assert!(effects.borrow().is_empty());
    paint(&mut state, &panel, &context, &reads);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.borrow()[0], ("private literal".into(), json!(1)));
    table_mut(&mut panel).affordances.as_mut().unwrap().items[0].invoke =
        Some(affordance::Invoke::Copy("replacement".into()));
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let context = Context {
        current_resource_path: Some("replacement scope".into()),
        ..Default::default()
    };
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let mut repeat = key(KeyCode::Enter);
    repeat.kind = KeyEventKind::Repeat;
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, repeat, &host),
        None
    );
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(effects.borrow()[1], ("replacement".into(), json!(0)));
}

#[test]
fn table_actions_beyond_numeric_shortcuts_are_navigable_without_hidden_digit_activation() {
    let mut panel = table();
    table_mut(&mut panel).affordances = Some(AffordanceCollection {
        items: (0..12)
            .map(|index| Affordance {
                label: format!("Action {index}"),
                invoke: Some(affordance::Invoke::Copy(index.to_string())),
                refresh_on_success: Some(false),
                ..Default::default()
            })
            .collect(),
    });
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let effects = RefCell::new(vec![]);
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Char('2')), &host),
        None
    );
    assert!(effects.borrow().is_empty());
    for _ in 0..11 {
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Right), &host);
    }
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    assert!(paint(&mut state, &panel, &context, &reads).contains("Action 11"));
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(*effects.borrow(), ["11"]);
}

#[test]
fn resource_window_keeps_the_active_card_visible_and_shortcuts_use_filtered_order() {
    let mut panel = resources(ResourceAction {
        id: "hidden".into(),
        label: "Hidden action".into(),
        visible_when: "state == absent".into(),
        ..Default::default()
    });
    resource_mut(&mut panel)
        .template
        .as_mut()
        .unwrap()
        .actions
        .as_mut()
        .unwrap()
        .actions
        .extend([
            ResourceAction {
                id: "first".into(),
                label: "First action".into(),
                ..Default::default()
            },
            ResourceAction {
                id: "second".into(),
                label: "Second action".into(),
                ..Default::default()
            },
        ]);
    let reads = Reads {
        rows: json!({"rows":(0..20).map(|id|json!({"id":id,"name":format!("Row {id}")})).collect::<Vec<_>>()}),
    };
    let context = Context::default();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    for _ in 0..10 {
        state.select_next();
    }
    let screen = paint(&mut state, &panel, &context, &reads);
    assert!(screen.contains("▶ 11."));
    assert!(screen.contains("Row 10"));
    assert!(!screen.contains("Row 0"));
    assert!(!screen.contains("Hidden action"));
    let effects = RefCell::new(vec![]);
    let resolve = |source: &ResourceAction, scope: NativeInvocationContext<'_>| {
        assert_eq!(scope.selected_row().unwrap()["id"], json!(10));
        Some(Affordance {
            invoke: Some(affordance::Invoke::Copy(source.id.clone())),
            refresh_on_success: Some(false),
            ..Default::default()
        })
    };
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        resolve_resource: Some(&resolve),
        ..Default::default()
    };
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Char('2')), &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(*effects.borrow(), ["second"]);
    state.invalidate();
    let smaller = Reads {
        rows: json!({"rows":[{"id":0,"name":"Only row"}]}),
    };
    paint(&mut state, &panel, &context, &smaller);
    assert!(state.selected_row().is_some());
}

#[test]
#[allow(deprecated)] // Legacy refresh behavior remains tested during 0.x.
fn refresh_failure_never_replays_completed_rows_and_transport_retry_is_sanitized() {
    let mut panel = table();
    let table = table_mut(&mut panel);
    table.affordances = None;
    table.actions = vec![RowAction {
        label: "Read-named mutation".into(),
        rpc: Some(call()),
        ..Default::default()
    }];
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    let requests = RefCell::new(vec![]);
    let fail = Cell::new(true);
    let rpc =
        |_: &RpcCall, request: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            if fail.get() {
                Err(RpcError::Other("private backend payload".into()))
            } else {
                Ok(())
            }
        };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::Failed)
    );
    let screen = paint(&mut state, &panel, &context, &reads);
    assert!(screen.contains("Action failed."));
    assert!(!screen.contains("private backend payload"));
    fail.set(false);
    assert_eq!(
        activate(&mut state, &panel, &context, &host),
        Some(NativeInvocationOutcome::RefreshFailed)
    );
    assert_eq!(requests.borrow().len(), 2);
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    assert!(paint(&mut state, &panel, &context, &reads).contains("Do not repeat"));
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
    state.select_prev();
    paint(&mut state, &panel, &context, &reads);
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    assert_eq!(requests.borrow().len(), 2);
}

#[test]
fn panel_bounds_and_malformed_resource_rows_fail_whole_without_effects() {
    let context = Context::default();
    let reads = rows();
    let mut panel = table();
    table_mut(&mut panel).affordances = Some(AffordanceCollection {
        items: vec![Affordance::default(); 1_001],
    });
    let mut state = PanelView::new();
    assert!(paint(&mut state, &panel, &context, &reads).contains("limit exceeded"));
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost::default()
        ),
        None
    );
    let panel = resources(ResourceAction {
        label: "Never run".into(),
        invoke: Some(call()),
        ..Default::default()
    });
    let malformed = Reads {
        rows: json!({"rows":[null]}),
    };
    let mut state = PanelView::new();
    assert!(paint(&mut state, &panel, &context, &malformed)
        .contains("Render construction limit exceeded"));
    assert_eq!(
        activate(
            &mut state,
            &panel,
            &context,
            &NativeInvocationHost::default()
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    assert!(state.selected_row().is_none());
    let source = ResourceAction {
        invoke: Some(call()),
        ..Default::default()
    };
    let context = Context {
        selected_row: Some(Value::Null),
        ..Default::default()
    };
    let calls = Cell::new(0);
    let rpc = |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        calls.set(calls.get() + 1);
        Ok(())
    };
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    assert_eq!(
        meridian_tui::NativeInvocationDispatcher::default().invoke(
            NativeAction::Resource(&source),
            NativeInvocationContext::new(&context),
            &NativeInvocationHost {
                rpc: Some(&rpc),
                mutations: Some(&policy),
                ..Default::default()
            }
        ),
        NativeInvocationOutcome::Denied
    );
    assert_eq!(calls.get(), 0);
}

#[test]
fn resource_danger_metadata_uses_the_existing_shared_semantic_palette_role() {
    let panel = resources(ResourceAction {
        label: "Danger action".into(),
        style: ActionStyle::Danger as i32,
        ..Default::default()
    });
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    let mut terminal = Terminal::new(TestBackend::new(140, 20)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), &panel, &context, &reads))
        .unwrap();
    let cells = &terminal.backend().buffer().content;
    let width = "Danger action".chars().count();
    let matches = cells
        .windows(width)
        .enumerate()
        .filter(|(_, part)| {
            part.iter().map(|cell| cell.symbol()).collect::<String>() == "Danger action"
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    assert!(
        matches.len() >= 2,
        "both the card and mounted action retain the semantic cue"
    );
    let expected = meridian_tui::Palette::default()
        .tone_style(Tone::Danger)
        .fg
        .unwrap();
    for index in matches {
        assert_eq!(cells[index].fg, expected);
    }
}

#[test]
fn row_lifecycle_cancels_owned_work_without_releasing_noncooperative_single_flight() {
    use std::{sync::mpsc, thread, time::Duration};
    for trigger in 0..7 {
        let mut panel = table();
        table_mut(&mut panel).affordances.as_mut().unwrap().items[0].refresh_on_success =
            Some(false);
        let mut context = Context::default();
        let reads = rows();
        let mut state = PanelView::new();
        paint(&mut state, &panel, &context, &reads);
        state.select_next();
        paint(&mut state, &panel, &context, &reads);
        let dispatcher = state.invocation_dispatcher();
        let retained = dispatcher.clone();
        let (start_tx, start_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let action = Affordance {
                invoke: Some(affordance::Invoke::Copy("worker".into())),
                ..Default::default()
            };
            let context = Context::default();
            let effect = |_: &str, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                start_tx.send(signal.clone()).unwrap();
                finish_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            };
            let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
            dispatcher.invoke(
                NativeAction::Canonical(&action),
                NativeInvocationContext::new(&context),
                &NativeInvocationHost {
                    copy: Some(&effect),
                    admit: Some(&allow),
                    ..Default::default()
                },
            )
        });
        let signal = start_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        paint(&mut state, &panel, &context, &reads);
        assert!(
            !signal.is_cancelled(),
            "unchanged redraw must not cancel work"
        );
        match trigger {
            0 => state.select_next(),
            1 => state.invalidate(),
            2 => {
                context.current_resource_path = Some("replacement".into());
                paint(&mut state, &panel, &context, &reads);
            }
            3 => {
                table_mut(&mut panel).affordances.as_mut().unwrap().items[0].label =
                    "Changed declaration".into();
                paint(&mut state, &panel, &context, &reads);
            }
            4 => drop(std::mem::take(&mut state)),
            5 => {
                state
                    .set_record(Some(std::sync::Arc::new(json!({"id":0}))))
                    .unwrap();
            }
            _ => {
                state.handle_action_key_with_invocation(
                    &panel,
                    &context,
                    key(KeyCode::Right),
                    &NativeInvocationHost::default(),
                );
            }
        }
        assert!(signal.is_cancelled());
        assert!(retained.pending());
        if trigger != 4 {
            paint(&mut state, &panel, &context, &reads);
            if state.selected_row().is_none() {
                state.select_next();
                paint(&mut state, &panel, &context, &reads);
            }
            assert_eq!(
                activate(
                    &mut state,
                    &panel,
                    &context,
                    &NativeInvocationHost::default()
                ),
                Some(NativeInvocationOutcome::Busy)
            );
        }
        finish_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), NativeInvocationOutcome::Cancelled);
        assert!(!retained.pending());
    }
}

#[test]
fn virtualized_rows_resources_forms_and_headers_cannot_activate_while_offscreen() {
    let context = Context::default();
    let reads = rows();
    for kind in 0..4 {
        let actor = match kind {
            0 => table(),
            1 => resources(ResourceAction {
                id: "semantic".into(),
                label: "Resource action".into(),
                ..Default::default()
            }),
            _ => PanelDescriptor {
                body: Some(panel_descriptor::Body::Form(Box::new(FormPanel {
                    mode: FormMode::Edit as i32,
                    submit_affordance: Some(Box::new(Affordance {
                        label: "Save".into(),
                        invoke: Some(affordance::Invoke::Copy("form".into())),
                        refresh_on_success: Some(false),
                        ..Default::default()
                    })),
                    ..Default::default()
                }))),
                ..Default::default()
            },
        };
        let mut descriptor = ViewDescriptor {
            slots: vec![Slot {
                panel: Some(actor),
                ..Default::default()
            }],
            ..Default::default()
        };
        if kind == 3 {
            descriptor.affordances = Some(AffordanceCollection {
                items: vec![Affordance {
                    label: "Header action".into(),
                    invoke: Some(affordance::Invoke::Copy("header".into())),
                    ..Default::default()
                }],
            });
        }
        descriptor.slots.extend((0..5).map(|index| Slot {
            panel: Some(PanelDescriptor {
                title: format!("Following {index}"),
                body: Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                    title: "Read-only following panel".into(),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            ..Default::default()
        }));
        let mut state = ViewHost::new(descriptor).unwrap();
        paint_view(&mut state, &context, &reads, 140);
        if kind == 0 {
            state.handle_key(key(KeyCode::Down), &context).unwrap();
            paint_view(&mut state, &context, &reads, 140);
        }
        let effects = Cell::new(0);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            effects.set(effects.get() + 1);
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let resolve = |_: &ResourceAction, _: NativeInvocationContext<'_>| {
            Some(Affordance {
                invoke: Some(affordance::Invoke::Copy("resource".into())),
                refresh_on_success: Some(false),
                ..Default::default()
            })
        };
        let host = NativeInvocationHost {
            copy: Some(&effect),
            admit: Some(&allow),
            resolve_resource: Some(&resolve),
            ..Default::default()
        };
        state.handle_key(key(KeyCode::PageDown), &context).unwrap();
        paint_view(&mut state, &context, &reads, 140);
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(effects.get(), 0, "offscreen kind {kind}");
        paint_view(&mut state, &context, &reads, 140);
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(effects.get(), 1, "visible kind {kind}");
    }
}

#[test]
fn zero_geometry_withdraws_previous_widget_and_view_control_ownership() {
    let panel = table();
    let context = Context::default();
    let reads = rows();
    let mut state = PanelView::new();
    paint(&mut state, &panel, &context, &reads);
    state.select_next();
    paint(&mut state, &panel, &context, &reads);
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
    let mut terminal = Terminal::new(TestBackend::new(0, 0)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), &panel, &context, &reads))
        .unwrap();
    assert_eq!(activate(&mut state, &panel, &context, &host), None);
    assert_eq!(effects.get(), 0);
    let mut state = composed(panel);
    paint_view(&mut state, &context, &reads, 140);
    state.handle_key(key(KeyCode::Down), &context).unwrap();
    paint_view(&mut state, &context, &reads, 140);
    terminal
        .draw(|f| state.render(f, f.area(), &context, &reads))
        .unwrap();
    state
        .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
        .unwrap();
    assert_eq!(effects.get(), 0);
}
fn resources(action: ResourceAction) -> PanelDescriptor {
    PanelDescriptor {
        title: "Resources".into(),
        body: Some(panel_descriptor::Body::ResourceCards(ResourceCardPanel {
            populate: Some(read()),
            rows_field: "rows".into(),
            template: Some(ResourceCardTemplate {
                title_field: "name".into(),
                actions: Some(ActionSet {
                    actions: vec![action],
                }),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}
fn paint(
    state: &mut PanelView,
    descriptor: &PanelDescriptor,
    context: &Context,
    reads: &Reads,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(140, 20)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), descriptor, context, reads))
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
fn canonical_table_controls_replace_legacy_metadata_without_disclosing_copy_values() {
    let mut state = PanelView::new();
    let descriptor = table();
    let context = Context::default();
    let reads = Reads {
        rows: json!({"rows":[{"id":0,"name":"First"}]}),
    };
    let screen = paint(&mut state, &descriptor, &context, &reads);
    assert!(screen.contains("Canonical archive"));
    assert!(!screen.contains("Legacy trap"));
    assert!(!screen.contains("private literal"));
}
#[test]
fn repeated_resource_action_labels_are_bounded_before_rendering() {
    let descriptor = resources(ResourceAction {
        label: "x".repeat(8_000),
        ..Default::default()
    });
    let mut state = PanelView::new();
    let reads = Reads {
        rows: json!({"rows":(0..600).map(|id|json!({"id":id,"name":"resource"})).collect::<Vec<_>>()}),
    };
    assert!(paint(&mut state, &descriptor, &Context::default(), &reads)
        .contains("Render construction limit exceeded"));
}
