//! Exercise content controls through the exported native host, not projections.
use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use meridian_tui::ratatui::{backend::TestBackend, Terminal};
use meridian_tui::{
    NativeAction, NativeCancellation, NativeInvocationContext, NativeInvocationHost,
    NativeInvocationOutcome, NativeTarget, PanelView, RpcError, RpcInvoker, ViewHost,
};
use meridian_uiview::{proto::*, Context};
use serde_json::{json, Value};
use std::cell::RefCell;

struct NoReads;
impl RpcInvoker for NoReads {
    fn invoke(&self, _: &str, _: &str, _: Value) -> Result<Value, RpcError> {
        panic!("content rendering must not execute RPCs")
    }
}
fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn draw(state: &mut PanelView, panel: &PanelDescriptor, context: &Context) -> String {
    let mut terminal = Terminal::new(TestBackend::new(100, 24)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), panel, context, &NoReads))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|c| c.symbol())
        .collect()
}
fn action(value: &str) -> PanelDescriptor {
    PanelDescriptor {
        body: Some(panel_descriptor::Body::Action(Box::new(ActionPanel {
            action: Some(Box::new(Affordance {
                label: "Copy literal".into(),
                invoke: Some(affordance::Invoke::Copy(value.into())),
                ..Default::default()
            })),
            ..Default::default()
        }))),
        ..Default::default()
    }
}
#[test]
fn actual_content_action_is_default_denied_then_uses_explicit_capability() {
    let panel = action("raw/e\u{301}");
    let context = Context::default();
    let mut state = PanelView::new();
    let shown = draw(&mut state, &panel, &context);
    assert!(!shown.contains("raw/e\u{301}"));
    assert_eq!(
        state.handle_action_key_with_invocation(
            &panel,
            &context,
            key(KeyCode::Enter),
            &NativeInvocationHost::default()
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    let copies = RefCell::new(vec![]);
    let copy = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        copies.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    assert_eq!(
        state.handle_action_key_with_invocation(
            &panel,
            &context,
            key(KeyCode::Enter),
            &NativeInvocationHost {
                copy: Some(&copy),
                admit: Some(&allow),
                ..Default::default()
            }
        ),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(*copies.borrow(), ["raw/e\u{301}"]);
}
#[test]
fn masked_copy_value_copies_literal_only_with_permission() {
    let panel = PanelDescriptor {
        body: Some(panel_descriptor::Body::CopyValue(CopyValuePanel {
            value: Some(CopyValue {
                value: "secret/raw".into(),
                secret: true,
                ..Default::default()
            }),
        })),
        ..Default::default()
    };
    let mut state = PanelView::new();
    let context = Context::default();
    assert!(!draw(&mut state, &panel, &context).contains("secret/raw"));
    assert_eq!(
        state.handle_action_key_with_invocation(
            &panel,
            &context,
            key(KeyCode::Char('c')),
            &NativeInvocationHost::default()
        ),
        Some(NativeInvocationOutcome::Denied)
    );
    let copies = RefCell::new(vec![]);
    let copy = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        copies.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&copy),
        admit: Some(&allow),
        ..Default::default()
    };
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Char('c')), &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
    assert_eq!(*copies.borrow(), ["secret/raw"]);
    // An external context change cannot retarget the old frame.
    let changed = Context {
        selected_row: Some(json!({"id":1})),
        ..Default::default()
    };
    state.handle_action_key_with_invocation(&panel, &changed, key(KeyCode::Char('c')), &host);
    assert_eq!(copies.borrow().len(), 1);
}

fn canonical(kind: usize, intent: Option<affordance::Invoke>) -> PanelDescriptor {
    let action = Affordance {
        label: "Mounted target".into(),
        invoke: intent,
        refresh_on_success: Some(false),
        ..Default::default()
    };
    let body = match kind {
        0 => panel_descriptor::Body::Action(Box::new(ActionPanel {
            action: Some(Box::new(action)),
            ..Default::default()
        })),
        1 => panel_descriptor::Body::Catalog(CatalogPanel {
            items: vec![CatalogItem {
                name: "Current item".into(),
                action: Some(action),
                ..Default::default()
            }],
            ..Default::default()
        }),
        2 => panel_descriptor::Body::ConnectFlow(ConnectFlowPanel {
            targets: vec![ConnectTarget {
                label: "Current target".into(),
                actions: vec![action],
                ..Default::default()
            }],
            ..Default::default()
        }),
        _ => panel_descriptor::Body::Steps(StepsPanel {
            steps: vec![Step {
                label: "Current step".into(),
                action: Some(action),
                ..Default::default()
            }],
            ..Default::default()
        }),
    };
    PanelDescriptor {
        body: Some(body),
        ..Default::default()
    }
}
fn view(panel: PanelDescriptor) -> ViewHost {
    ViewHost::new(ViewDescriptor {
        slots: vec![Slot {
            panel: Some(panel),
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap()
}
fn draw_view(state: &mut ViewHost, context: &Context, width: u16) {
    let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
    terminal
        .draw(|f| state.render(f, f.area(), context, &NoReads))
        .unwrap();
}

#[test]
fn seven_targets_across_four_content_shapes_two_widths_and_both_mounts() {
    for width in [80, 140] {
        for composed in [false, true] {
            for kind in 0..4 {
                for target in 0..7 {
                    let rpc = RpcCall {
                        service: "raw.Service".into(),
                        method: "Get".into(),
                        bindings: vec![FieldBinding {
                            request_field: "id".into(),
                            source: Some(field_binding::Source::RowField("id".into())),
                        }],
                    };
                    let intent = match target {
                        0 => affordance::Invoke::Rpc(rpc),
                        1 => affordance::Invoke::Uri("cursor://literal".into()),
                        2 => affordance::Invoke::Command("literal\ncommand".into()),
                        3 => affordance::Invoke::Navigate(Navigate {
                            route: "/literal".into(),
                        }),
                        4 => affordance::Invoke::OpenPanel(Box::new(PanelDescriptor {
                            panel_id: "inline".into(),
                            ..Default::default()
                        })),
                        5 => affordance::Invoke::OpenView("view".into()),
                        _ => affordance::Invoke::Copy("raw/e\u{301}".into()),
                    };
                    let panel = canonical(kind, Some(intent));
                    let context = Context {
                        selected_row: Some(json!({"id":0,"enabled":false})),
                        ..Default::default()
                    };
                    let events = RefCell::new(vec![]);
                    let check = |scope: NativeInvocationContext<'_>| {
                        assert_eq!(scope.selected_row(), context.selected_row.as_ref())
                    };
                    let effect = |value: &str,
                                  scope: NativeInvocationContext<'_>,
                                  _: &NativeCancellation| {
                        check(scope);
                        events.borrow_mut().push(value.to_owned());
                        Ok(())
                    };
                    let rpc = |_: &RpcCall,
                               request: Value,
                               scope: NativeInvocationContext<'_>,
                               _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(request, json!({"id":0}));
                        events.borrow_mut().push("rpc".into());
                        Ok(())
                    };
                    let navigate = |route: &Navigate,
                                    scope: NativeInvocationContext<'_>,
                                    _: &NativeCancellation| {
                        check(scope);
                        events.borrow_mut().push(route.route.clone());
                        Ok(())
                    };
                    let open = |panel: &PanelDescriptor,
                                scope: NativeInvocationContext<'_>,
                                _: &NativeCancellation| {
                        check(scope);
                        assert_eq!(panel.panel_id, "inline");
                        events.borrow_mut().push("panel".into());
                        Ok(())
                    };
                    let admit = |_: NativeTarget<'_>, scope: NativeInvocationContext<'_>| {
                        check(scope);
                        true
                    };
                    let mutations = |_: &RpcCall, scope: NativeInvocationContext<'_>| {
                        check(scope);
                        true
                    };
                    let host = NativeInvocationHost {
                        rpc: Some(&rpc),
                        uri: Some(&effect),
                        command: Some(&effect),
                        navigate: Some(&navigate),
                        open_panel: Some(&open),
                        open_view: Some(&effect),
                        copy: Some(&effect),
                        admit: Some(&admit),
                        mutations: Some(&mutations),
                        ..Default::default()
                    };
                    if composed {
                        let mut state = view(panel);
                        draw_view(&mut state, &context, width);
                        state
                            .handle_key_with_invocation(
                                key(KeyCode::Enter),
                                &context,
                                &NativeInvocationHost::default(),
                            )
                            .unwrap();
                        assert!(events.borrow().is_empty());
                        state
                            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
                            .unwrap();
                    } else {
                        let mut state = PanelView::new();
                        let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
                        terminal
                            .draw(|f| state.render(f, f.area(), &panel, &context, &NoReads))
                            .unwrap();
                        assert_eq!(
                            state.handle_action_key_with_invocation(
                                &panel,
                                &context,
                                key(KeyCode::Enter),
                                &NativeInvocationHost::default()
                            ),
                            Some(NativeInvocationOutcome::Denied)
                        );
                        assert_eq!(
                            state.handle_action_key_with_invocation(
                                &panel,
                                &context,
                                key(KeyCode::Enter),
                                &host
                            ),
                            Some(NativeInvocationOutcome::Succeeded)
                        );
                    }
                    assert_eq!(
                        *events.borrow(),
                        [match target {
                            0 => "rpc",
                            1 => "cursor://literal",
                            2 => "literal\ncommand",
                            3 => "/literal",
                            4 => "panel",
                            5 => "view",
                            _ => "raw/e\u{301}",
                        }],
                        "kind{kind}/target{target}/composed{composed}/width{width}"
                    );
                }
            }
        }
    }
}

#[test]
fn connect_selection_exposes_all_actions_configs_and_shared_endpoint_without_command_copy_fallback()
{
    let mut panel = canonical(2, Some(affordance::Invoke::Command("not-a-copy".into())));
    let Some(panel_descriptor::Body::ConnectFlow(p)) = &mut panel.body else {
        unreachable!()
    };
    p.targets[0].configs = vec![
        Snippet {
            content: "first/raw\n".into(),
            ..Default::default()
        },
        Snippet {
            content: String::new(),
            ..Default::default()
        },
    ];
    p.endpoint = Some(CopyValue {
        value: "secret/endpoint".into(),
        secret: true,
        ..Default::default()
    });
    let context = Context::default();
    let mut state = PanelView::new();
    assert!(!draw(&mut state, &panel, &context).contains("secret/endpoint"));
    let values = RefCell::new(vec![]);
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        values.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let admit = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        command: Some(&effect),
        admit: Some(&admit),
        ..Default::default()
    };
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Char('c')), &host),
        None
    );
    assert!(values.borrow().is_empty());
    for expected in ["first/raw\n", "", "secret/endpoint"] {
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Right), &host);
        assert_eq!(
            state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host),
            None,
            "selection requires redraw"
        );
        draw(&mut state, &panel, &context);
        assert_eq!(
            state.handle_action_key_with_invocation(
                &panel,
                &context,
                key(KeyCode::Char('c')),
                &host
            ),
            Some(NativeInvocationOutcome::Succeeded)
        );
        assert_eq!(values.borrow().last().unwrap(), expected);
    }
}

#[test]
fn missing_intent_and_missing_capability_never_execute_or_fall_back() {
    let context = Context::default();
    for kind in 0..4 {
        let mut state = PanelView::new();
        let panel = canonical(kind, None);
        draw(&mut state, &panel, &context);
        let trap = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            panic!("missing intent must not execute")
        };
        let admit = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            copy: Some(&trap),
            admit: Some(&admit),
            ..Default::default()
        };
        assert_eq!(
            state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host),
            Some(NativeInvocationOutcome::Denied)
        );
    }
}

#[test]
fn snippet_copy_is_literal_and_refresh_failure_remains_completed_after_navigation() {
    let panel = PanelDescriptor {
        body: Some(panel_descriptor::Body::Snippet(SnippetPanel {
            snippet: Some(Snippet {
                content: "raw\n\t/e\u{301}".into(),
                ..Default::default()
            }),
        })),
        ..Default::default()
    };
    let context = Context::default();
    let mut state = PanelView::new();
    draw(&mut state, &panel, &context);
    let copies = RefCell::new(vec![]);
    let copy = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        copies.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let admit = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&copy),
        admit: Some(&admit),
        ..Default::default()
    };
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Char('c')), &host);
    assert_eq!(*copies.borrow(), ["raw\n\t/e\u{301}"]);
    let mut panel = action("literal");
    let Some(panel_descriptor::Body::Action(p)) = &mut panel.body else {
        unreachable!()
    };
    p.action.as_mut().unwrap().refresh_on_success = Some(true);
    let refresh = |_: NativeInvocationContext<'_>, _: &NativeCancellation| {
        Err(RpcError::Transport("private-error".into()))
    };
    let host = NativeInvocationHost {
        refresh: Some(&refresh),
        ..host
    };
    draw(&mut state, &panel, &context);
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host),
        Some(NativeInvocationOutcome::RefreshFailed)
    );
    state.select_next();
    draw(&mut state, &panel, &context);
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host);
    assert_eq!(copies.borrow().len(), 2);
    assert!(!draw(&mut state, &panel, &context).contains("private-error"));
}

#[test]
fn content_selection_and_source_changes_require_current_draw_and_preserve_default_target() {
    let first = Affordance {
        label: "First".into(),
        invoke: Some(affordance::Invoke::Copy("first".into())),
        ..Default::default()
    };
    let second = Affordance {
        label: "Second".into(),
        invoke: Some(affordance::Invoke::Copy("second".into())),
        ..Default::default()
    };
    let panel = PanelDescriptor {
        body: Some(panel_descriptor::Body::ConnectFlow(ConnectFlowPanel {
            default_target_id: "second".into(),
            targets: vec![
                ConnectTarget {
                    id: "first".into(),
                    actions: vec![first],
                    ..Default::default()
                },
                ConnectTarget {
                    id: "second".into(),
                    actions: vec![second],
                    ..Default::default()
                },
            ],
            ..Default::default()
        })),
        ..Default::default()
    };
    let mut state = PanelView::new();
    let context = Context::default();
    draw(&mut state, &panel, &context);
    let values = RefCell::new(vec![]);
    let copy = |v: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        values.borrow_mut().push(v.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&copy),
        admit: Some(&allow),
        ..Default::default()
    };
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host);
    assert_eq!(*values.borrow(), ["second"]);
    state.select_prev();
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host);
    assert_eq!(values.borrow().len(), 1);
    draw(&mut state, &panel, &context);
    // The default applies once; navigation can reach the first actual target.
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host);
    assert_eq!(values.borrow().len(), 2);
    assert_eq!(values.borrow().last().unwrap(), "first");
    let replacement = action("replacement");
    state.handle_action_key_with_invocation(&replacement, &context, key(KeyCode::Enter), &host);
    assert_eq!(values.borrow().len(), 2);
    draw(&mut state, &replacement, &context);
    state.handle_action_key_with_invocation(&replacement, &context, key(KeyCode::Enter), &host);
    assert_eq!(values.borrow().last().unwrap(), "replacement");
}

#[test]
fn repeated_content_uses_local_raw_record_and_revalidates_parent_read_scope() {
    struct Parents(RefCell<Vec<Value>>);
    impl RpcInvoker for Parents {
        fn invoke(&self, _: &str, method: &str, request: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "Parents");
            self.0.borrow_mut().push(request);
            Ok(json!({"rows":[{"id":0,"flag":false}]}))
        }
    }
    for kind in 0..4 {
        let descriptor = ViewDescriptor {
            slots: vec![Slot {
                sub_view: Some(ViewDescriptor {
                    slots: vec![Slot {
                        panel: Some(canonical(
                            kind,
                            Some(affordance::Invoke::Copy("literal".into())),
                        )),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                sub_view_populate: Some(RpcCall {
                    service: "raw.Records".into(),
                    method: "Parents".into(),
                    bindings: vec![FieldBinding {
                        request_field: "scope".into(),
                        source: Some(field_binding::Source::RowField("scope".into())),
                    }],
                }),
                sub_view_rows_field: "rows".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut state = ViewHost::new(descriptor).unwrap();
        let reads = Parents(RefCell::new(vec![]));
        let mut context = Context {
            selected_row: Some(json!({"scope":"first","id":"ambient-trap"})),
            ..Default::default()
        };
        let mut terminal = Terminal::new(TestBackend::new(140, 24)).unwrap();
        terminal
            .draw(|f| state.render(f, f.area(), &context, &reads))
            .unwrap();
        let values = RefCell::new(vec![]);
        let copy = |v: &str, scope: NativeInvocationContext<'_>, _: &NativeCancellation| {
            assert_eq!(scope.selected_row(), Some(&json!({"id":0,"flag":false})));
            values.borrow_mut().push(v.to_owned());
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            copy: Some(&copy),
            admit: Some(&allow),
            ..Default::default()
        };
        context.selected_row = Some(json!({"scope":"replacement","id":"other-trap"}));
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert!(values.borrow().is_empty());
        terminal
            .draw(|f| state.render(f, f.area(), &context, &reads))
            .unwrap();
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(*values.borrow(), ["literal"]);
        assert_eq!(
            *reads.0.borrow(),
            [json!({"scope":"first"}), json!({"scope":"replacement"})]
        );
    }
}

#[test]
fn content_bounds_and_zero_geometry_withdraw_execution_without_raw_error_output() {
    let context = Context::default();
    let mut state = PanelView::new();
    let panel = action("literal");
    draw(&mut state, &panel, &context);
    let values = RefCell::new(vec![]);
    let copy = |v: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        values.borrow_mut().push(v.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&copy),
        admit: Some(&allow),
        ..Default::default()
    };
    let mut zero = Terminal::new(TestBackend::new(0, 0)).unwrap();
    zero.draw(|f| state.render(f, f.area(), &panel, &context, &NoReads))
        .unwrap();
    state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host);
    assert!(values.borrow().is_empty());
    let mut oversized = canonical(2, None);
    let Some(panel_descriptor::Body::ConnectFlow(p)) = &mut oversized.body else {
        unreachable!()
    };
    p.targets[0].configs = vec![Snippet::default(); 1000];
    assert!(draw(&mut state, &oversized, &context).contains("limit exceeded"));
    state.handle_action_key_with_invocation(&oversized, &context, key(KeyCode::Enter), &host);
    assert!(values.borrow().is_empty());
    draw(&mut state, &panel, &context);
    let fail = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        Err(RpcError::Transport("raw-private-error".into()))
    };
    assert_eq!(
        state.handle_action_key_with_invocation(
            &panel,
            &context,
            key(KeyCode::Enter),
            &NativeInvocationHost {
                copy: Some(&fail),
                ..host
            }
        ),
        Some(NativeInvocationOutcome::Failed)
    );
    assert!(!draw(&mut state, &panel, &context).contains("raw-private-error"));
    assert_eq!(
        state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host),
        Some(NativeInvocationOutcome::Succeeded)
    );
}

#[test]
fn content_owned_workers_cancel_on_lifecycle_changes_but_hold_single_flight_until_settlement() {
    use std::{
        sync::{mpsc, Arc},
        thread,
        time::Duration,
    };
    for trigger in 0..6 {
        let mut state = PanelView::new();
        let mut panel = action("literal");
        let mut context = Context::default();
        draw(&mut state, &panel, &context);
        let dispatcher = state.invocation_dispatcher();
        let retained = dispatcher.clone();
        let (start_tx, start_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let context = Context::default();
            let copy = |_: &str, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                start_tx.send(signal.clone()).unwrap();
                finish_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            };
            let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
            dispatcher.invoke(
                NativeAction::Copy("worker"),
                NativeInvocationContext::new(&context),
                &NativeInvocationHost {
                    copy: Some(&copy),
                    admit: Some(&allow),
                    ..Default::default()
                },
            )
        });
        let signal = start_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        draw(&mut state, &panel, &context);
        assert!(!signal.is_cancelled());
        match trigger {
            0 => state.select_next(),
            1 => state.invalidate(),
            2 => {
                context.current_resource_path = Some("replacement".into());
                draw(&mut state, &panel, &context);
            }
            3 => {
                panel.title = "Replacement".into();
                draw(&mut state, &panel, &context);
            }
            4 => state.set_record(Some(Arc::new(json!({"id":0})))).unwrap(),
            _ => drop(std::mem::take(&mut state)),
        }
        assert!(signal.is_cancelled());
        assert!(retained.pending());
        if trigger != 5 {
            draw(&mut state, &panel, &context);
            assert_eq!(
                state.handle_action_key_with_invocation(
                    &panel,
                    &context,
                    key(KeyCode::Enter),
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
fn content_predicates_and_permission_revocation_deny_before_effects() {
    use std::cell::Cell;
    let context = Context {
        selected_row: Some(json!({"enabled":false})),
        ..Default::default()
    };
    for kind in 0..4 {
        let mut panel = canonical(kind, Some(affordance::Invoke::Copy("literal".into())));
        let affordance = match panel.body.as_mut().unwrap() {
            panel_descriptor::Body::Action(p) => p.action.as_mut().unwrap().as_mut(),
            panel_descriptor::Body::Catalog(p) => p.items[0].action.as_mut().unwrap(),
            panel_descriptor::Body::ConnectFlow(p) => &mut p.targets[0].actions[0],
            panel_descriptor::Body::Steps(p) => p.steps[0].action.as_mut().unwrap(),
            _ => unreachable!(),
        };
        affordance.enabled_when = Some(RowFilter {
            field_path: "enabled".into(),
            equals: "true".into(),
        });
        let mut state = PanelView::new();
        draw(&mut state, &panel, &context);
        let effects = Cell::new(0);
        let allowed = Cell::new(true);
        let revoke = Cell::new(false);
        let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            effects.set(effects.get() + 1);
            Ok(())
        };
        let admit = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| allowed.get();
        let confirm =
            |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                if revoke.get() {
                    allowed.set(false);
                }
                Ok(true)
            };
        let host = NativeInvocationHost {
            copy: Some(&effect),
            admit: Some(&admit),
            confirm: Some(&confirm),
            ..Default::default()
        };
        assert_eq!(
            state.handle_action_key_with_invocation(&panel, &context, key(KeyCode::Enter), &host),
            Some(NativeInvocationOutcome::Denied)
        );
        let enabled = Context {
            selected_row: Some(json!({"enabled":true})),
            ..Default::default()
        };
        draw(&mut state, &panel, &enabled);
        revoke.set(true);
        assert_eq!(
            state.handle_action_key_with_invocation(&panel, &enabled, key(KeyCode::Enter), &host),
            Some(NativeInvocationOutcome::Denied)
        );
        assert_eq!(effects.get(), 0);
        allowed.set(true);
        revoke.set(false);
        assert_eq!(
            state.handle_action_key_with_invocation(&panel, &enabled, key(KeyCode::Enter), &host),
            Some(NativeInvocationOutcome::Succeeded)
        );
        assert_eq!(effects.get(), 1);
    }
}

#[test]
fn all_content_shapes_withdraw_offscreen_controls_until_revealed() {
    for kind in 0..6 {
        let panel = match kind {
            0..=3 => canonical(kind, Some(affordance::Invoke::Copy("literal".into()))),
            4 => PanelDescriptor {
                body: Some(panel_descriptor::Body::CopyValue(CopyValuePanel {
                    value: Some(CopyValue {
                        value: "literal".into(),
                        ..Default::default()
                    }),
                })),
                ..Default::default()
            },
            _ => PanelDescriptor {
                body: Some(panel_descriptor::Body::Snippet(SnippetPanel {
                    snippet: Some(Snippet {
                        content: "literal".into(),
                        ..Default::default()
                    }),
                })),
                ..Default::default()
            },
        };
        let mut descriptor = ViewDescriptor {
            slots: vec![Slot {
                panel: Some(panel),
                ..Default::default()
            }],
            ..Default::default()
        };
        descriptor.slots.extend((0..5).map(|_| Slot {
            panel: Some(PanelDescriptor {
                body: Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                    title: "Following panel".into(),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            ..Default::default()
        }));
        let mut state = ViewHost::new(descriptor).unwrap();
        let context = Context::default();
        draw_view(&mut state, &context, 140);
        let effects = RefCell::new(vec![]);
        let effect = |v: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            effects.borrow_mut().push(v.to_owned());
            Ok(())
        };
        let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
        let host = NativeInvocationHost {
            copy: Some(&effect),
            admit: Some(&allow),
            ..Default::default()
        };
        state.handle_key(key(KeyCode::PageDown), &context).unwrap();
        draw_view(&mut state, &context, 140);
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert!(effects.borrow().is_empty(), "offscreen kind{kind}");
        draw_view(&mut state, &context, 140);
        state
            .handle_key_with_invocation(key(KeyCode::Enter), &context, &host)
            .unwrap();
        assert_eq!(*effects.borrow(), ["literal"], "revealed kind{kind}");
    }
}
