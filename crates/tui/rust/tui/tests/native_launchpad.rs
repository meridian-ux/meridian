//! External consumer proof for actual native palette admission and lifecycle.
use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_tui::ratatui::{backend::TestBackend, Terminal};
use meridian_tui::{
    LaunchpadState, NativeAction, NativeCancellation, NativeInvocationContext,
    NativeInvocationHost, NativeInvocationOutcome, NativeLaunchpadResponse, NativeTarget, Palette,
    RpcError,
};
use meridian_uiview::{
    proto::{
        affordance::Invoke, field_binding, Affordance, Command, CommandGroup, FieldBinding,
        Launchpad, Navigate, PanelDescriptor, RowFilter, RpcCall,
    },
    Context,
};
use prost::Message;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn command(id: &str, title: &str) -> Command {
    Command {
        id: id.into(),
        title: title.into(),
        ..Default::default()
    }
}

fn palette(command: Command) -> Launchpad {
    Launchpad {
        groups: vec![CommandGroup {
            commands: vec![command],
            ..Default::default()
        }],
        ..Default::default()
    }
}
fn retired_command(command: Command, tag: u32, payload: &[u8]) -> Command {
    let mut wire = command.encode_to_vec();
    prost::encoding::encode_key(tag, prost::encoding::WireType::LengthDelimited, &mut wire);
    prost::encoding::encode_varint(payload.len() as u64, &mut wire);
    wire.extend_from_slice(payload);
    Command::decode(wire.as_slice()).unwrap()
}
fn canonical(invoke: Option<Invoke>) -> Command {
    retired_command(
        Command {
            affordance: Some(Affordance {
                label: "Canonical run".into(),
                invoke,
                refresh_on_success: Some(false),
                ..Default::default()
            }),
            deep_link: "/deep-link-trap".into(),
            ..command("same", "Run command")
        },
        11,
        &Navigate {
            route: "/legacy-trap".into(),
        }
        .encode_to_vec(),
    )
}
fn paint(
    state: &mut LaunchpadState,
    descriptor: &Launchpad,
    context: &Context,
    width: u16,
) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 16)).unwrap();
    terminal
        .draw(|f| state.draw_with_invocation(f, f.area(), descriptor, context, &Palette::default()))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..16)
        .map(|y| {
            (0..width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn run(
    state: &mut LaunchpadState,
    descriptor: &Launchpad,
    context: &Context,
    host: &NativeInvocationHost<'_>,
) -> Option<NativeLaunchpadResponse> {
    state.on_key_with_invocation(key(KeyCode::Enter), descriptor, context, host)
}

#[test]
fn actual_palette_seven_targets_default_deny_then_execute_once_without_raw_handoff() {
    let call = RpcCall {
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
    };
    for width in [80, 140] {
        for (intent, expected) in [
            (Invoke::Rpc(call.clone()), "rpc"),
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
            (Invoke::Copy("private clipboard".into()), "copy"),
        ] {
            let descriptor = palette(canonical(Some(intent)));
            let mut state = LaunchpadState::new();
            let context = Context {
                selected_row: Some(json!({"id":0,"flag":false})),
                form_values: [("name".into(), json!("raw/e\u{301}"))].into(),
                ..Default::default()
            };
            let events = RefCell::new(vec![]);
            let uri = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                assert_eq!(value, "cursor://raw");
                events.borrow_mut().push("uri");
                Ok(())
            };
            let command = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                assert_eq!(value, "literal\ncommand");
                events.borrow_mut().push("command");
                Ok(())
            };
            let view = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                assert_eq!(value, "raw-view");
                events.borrow_mut().push("view");
                Ok(())
            };
            let copy = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                assert_eq!(value, "private clipboard");
                events.borrow_mut().push("copy");
                Ok(())
            };
            let rpc = |source: &RpcCall,
                       request: Value,
                       current: NativeInvocationContext<'_>,
                       _: &NativeCancellation| {
                assert_eq!(source.method, "Get");
                assert_eq!(current.selected_row(), context.selected_row.as_ref());
                assert_eq!(request, json!({"id":0,"flag":false,"name":"raw/e\u{301}"}));
                events.borrow_mut().push("rpc");
                Ok(())
            };
            let navigate =
                |route: &Navigate, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
                    assert_eq!(route.route, "/raw");
                    events.borrow_mut().push("navigate");
                    Ok(())
                };
            let panel = |value: &PanelDescriptor,
                         _: NativeInvocationContext<'_>,
                         _: &NativeCancellation| {
                assert_eq!(value.panel_id, "inline");
                events.borrow_mut().push("panel");
                Ok(())
            };
            let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
            let mutations = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
            let host = NativeInvocationHost {
                rpc: Some(&rpc),
                uri: Some(&uri),
                command: Some(&command),
                navigate: Some(&navigate),
                open_panel: Some(&panel),
                open_view: Some(&view),
                copy: Some(&copy),
                admit: Some(&allow),
                mutations: Some(&mutations),
                ..Default::default()
            };
            let screen = paint(&mut state, &descriptor, &context, width);
            assert!(screen.contains("Run command"));
            assert!(!screen.contains("private clipboard"));
            assert!(events.borrow().is_empty());
            assert_eq!(
                run(
                    &mut state,
                    &descriptor,
                    &context,
                    &NativeInvocationHost::default()
                ),
                None
            );
            assert!(paint(&mut state, &descriptor, &context, width).contains("Action denied:"));
            assert!(events.borrow().is_empty());
            assert_eq!(
                run(&mut state, &descriptor, &context, &host),
                Some(NativeLaunchpadResponse::Executed)
            );
            assert_eq!(*events.borrow(), [expected]);
            assert_eq!(run(&mut state, &descriptor, &context, &host), None);
            assert_eq!(*events.borrow(), [expected]);
        }
    }
}

#[test]
fn empty_canonical_missing_capabilities_and_rpc_read_names_do_not_grant_execution() {
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let navigate = |_: &Navigate, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let rpc = |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let confirms = Cell::new(0);
    let confirm = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        confirms.set(confirms.get() + 1);
        Ok(true)
    };
    let context = Context::default();
    for intent in [
        None,
        Some(Invoke::Uri("javascript:bad".into())),
        Some(Invoke::Command("do-not-copy".into())),
        Some(Invoke::Rpc(RpcCall {
            service: "raw.Records".into(),
            method: "List".into(),
            ..Default::default()
        })),
    ] {
        let descriptor = palette(canonical(intent));
        let mut state = LaunchpadState::new();
        paint(&mut state, &descriptor, &context, 140);
        let host = NativeInvocationHost {
            uri: Some(&effect),
            copy: Some(&effect),
            navigate: Some(&navigate),
            rpc: Some(&rpc),
            admit: Some(&allow),
            confirm: Some(&confirm),
            ..Default::default()
        };
        assert_eq!(run(&mut state, &descriptor, &context, &host), None);
        assert!(paint(&mut state, &descriptor, &context, 140).contains("Action denied:"));
    }
    assert_eq!(effects.get(), 0);
    assert_eq!(confirms.get(), 0);
}

#[test]
fn all_four_canonical_typed_commands_use_the_admitted_path_not_hint_routing() {
    let context = Context::default();
    let events = RefCell::new(vec![]);
    let rpc = |_: &RpcCall, _: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        events.borrow_mut().push("rpc");
        Ok(())
    };
    let navigate = |_: &Navigate, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        events.borrow_mut().push("navigate");
        Ok(())
    };
    let panel = |_: &PanelDescriptor, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        events.borrow_mut().push("panel");
        Ok(())
    };
    let view = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        events.borrow_mut().push("view");
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let mutations = |_: &RpcCall, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        navigate: Some(&navigate),
        open_panel: Some(&panel),
        open_view: Some(&view),
        admit: Some(&allow),
        mutations: Some(&mutations),
        ..Default::default()
    };
    for (action, expected) in [
        (
            Invoke::Rpc(RpcCall {
                service: "raw.Records".into(),
                method: "Get".into(),
                ..Default::default()
            }),
            "rpc",
        ),
        (
            Invoke::Navigate(Navigate {
                route: "/raw".into(),
            }),
            "navigate",
        ),
        (Invoke::OpenView("view".into()), "view"),
        (Invoke::OpenPanel(Box::default()), "panel"),
    ] {
        let descriptor = palette(Command {
            affordance: Some(Affordance {
                invoke: Some(action),
                ..Default::default()
            }),
            deep_link: "/not-a-route-grant".into(),
            ..command("x", "Run")
        });
        let mut state = LaunchpadState::new();
        paint(&mut state, &descriptor, &context, 140);
        assert_eq!(
            run(
                &mut state,
                &descriptor,
                &context,
                &NativeInvocationHost::default()
            ),
            None
        );
        assert_eq!(
            run(&mut state, &descriptor, &context, &host),
            Some(NativeLaunchpadResponse::Executed)
        );
        assert_eq!(events.borrow().last(), Some(&expected));
    }
    for retired in [false, true] {
        let command = Command {
            deep_link: "/never".into(),
            ..command("semantic-id", "Run")
        };
        let descriptor = palette(if retired {
            retired_command(command, 9, &[])
        } else {
            command
        });
        let mut state = LaunchpadState::new();
        paint(&mut state, &descriptor, &context, 140);
        assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    }
    assert_eq!(events.borrow().len(), 4);
}

#[test]
fn stale_same_id_descriptor_context_and_duplicate_id_selection_require_current_draw() {
    let mut descriptor = palette(canonical(Some(Invoke::Copy("first".into()))));
    descriptor.groups[0]
        .commands
        .push(canonical(Some(Invoke::Copy("second".into()))));
    let mut state = LaunchpadState::new();
    let mut context = Context::default();
    let events = RefCell::new(vec![]);
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        events.borrow_mut().push(value.to_owned());
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    paint(&mut state, &descriptor, &context, 140);
    descriptor.groups[0].commands[0] = canonical(Some(Invoke::Copy("replacement".into())));
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    assert!(paint(&mut state, &descriptor, &context, 140).contains("Command stopped"));
    context.current_resource_path = Some("new-context".into());
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    paint(&mut state, &descriptor, &context, 140);
    state.on_key_with_invocation(key(KeyCode::Down), &descriptor, &context, &host);
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    paint(&mut state, &descriptor, &context, 140);
    let mut repeat = key(KeyCode::Enter);
    repeat.kind = KeyEventKind::Repeat;
    assert_eq!(
        state.on_key_with_invocation(repeat, &descriptor, &context, &host),
        None
    );
    assert!(events.borrow().is_empty());
    assert_eq!(
        run(&mut state, &descriptor, &context, &host),
        Some(NativeLaunchpadResponse::Executed)
    );
    assert_eq!(*events.borrow(), ["second"]);
}

#[test]
fn policy_revocation_failure_retry_and_refresh_failure_preserve_palette_lifecycle() {
    let call = RpcCall {
        service: "raw.Records".into(),
        method: "Get".into(),
        bindings: vec![FieldBinding {
            request_field: "name".into(),
            source: Some(field_binding::Source::FormField("name".into())),
        }],
    };
    let descriptor = palette(canonical(Some(Invoke::Rpc(call))));
    let mut state = LaunchpadState::new();
    let mut context = Context {
        form_values: [("name".into(), json!("first"))].into(),
        ..Default::default()
    };
    let permitted = Cell::new(true);
    let fail = Cell::new(true);
    let requests = RefCell::new(vec![]);
    let policy = |_: &RpcCall, _: NativeInvocationContext<'_>| permitted.get();
    let revoke = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        permitted.set(false);
        Ok(true)
    };
    let rpc =
        |_: &RpcCall, request: Value, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
            requests.borrow_mut().push(request);
            if fail.get() {
                Err(RpcError::Other("private server response".into()))
            } else {
                Ok(())
            }
        };
    paint(&mut state, &descriptor, &context, 140);
    assert_eq!(
        run(
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
        None
    );
    assert!(requests.borrow().is_empty());
    permitted.set(true);
    let host = NativeInvocationHost {
        rpc: Some(&rpc),
        mutations: Some(&policy),
        ..Default::default()
    };
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    let screen = paint(&mut state, &descriptor, &context, 140);
    assert!(screen.contains("Action failed."));
    assert!(!screen.contains("private server response"));
    fail.set(false);
    context
        .form_values
        .insert("name".into(), json!("raw/e\u{301}"));
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    paint(&mut state, &descriptor, &context, 140);
    assert_eq!(
        run(&mut state, &descriptor, &context, &host),
        Some(NativeLaunchpadResponse::Executed)
    );
    assert_eq!(
        *requests.borrow(),
        [json!({"name":"first"}), json!({"name":"raw/e\u{301}"})]
    );
    let effects = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let mut c = canonical(Some(Invoke::Copy("literal".into())));
    c.affordance.as_mut().unwrap().refresh_on_success = Some(true);
    let descriptor = palette(c);
    let mut state = LaunchpadState::new();
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    paint(&mut state, &descriptor, &context, 140);
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    assert!(paint(&mut state, &descriptor, &context, 140).contains("Do not repeat"));
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    assert_eq!(effects.get(), 1);
}

#[test]
fn canonical_predicate_checks_the_current_subject_before_consent() {
    let mut c = canonical(Some(Invoke::Copy("literal".into())));
    c.affordance.as_mut().unwrap().enabled_when = Some(RowFilter {
        field_path: "enabled".into(),
        equals: "true".into(),
    });
    let descriptor = palette(c);
    let mut state = LaunchpadState::new();
    let mut context = Context {
        selected_row: Some(json!({"enabled":false})),
        ..Default::default()
    };
    let effects = Cell::new(0);
    let confirms = Cell::new(0);
    let effect = |_: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let confirm = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        confirms.set(confirms.get() + 1);
        Ok(true)
    };
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        confirm: Some(&confirm),
        ..Default::default()
    };
    paint(&mut state, &descriptor, &context, 140);
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    assert_eq!(confirms.get(), 0);
    context.selected_row = Some(json!({"enabled":true}));
    paint(&mut state, &descriptor, &context, 140);
    assert_eq!(
        run(&mut state, &descriptor, &context, &host),
        Some(NativeLaunchpadResponse::Executed)
    );
    assert_eq!(effects.get(), 1);
    assert_eq!(confirms.get(), 1);
}

#[test]
fn agent_query_tokens_reject_aba_close_and_cross_owner_replies_and_clear_old_results() {
    let descriptor = Launchpad::default();
    let mut state = LaunchpadState::new();
    state.set_query("alpha");
    let old = state.query_token();
    assert!(
        state.set_agent_commands_for_query(&old, vec![canonical(Some(Invoke::Copy("old".into())))])
    );
    state.set_query("beta");
    assert!(state.agent_commands().is_empty());
    state.set_query("alpha");
    assert!(!state.set_agent_commands_for_query(&old, vec![command("late", "Late")]));
    let current = state.query_token();
    let mut copy = state.clone();
    assert!(!copy.set_agent_commands_for_query(&current, vec![command("foreign", "Foreign")]));
    assert!(state.set_agent_commands_for_query(
        &current,
        vec![canonical(Some(Invoke::Copy("current".into())))]
    ));
    assert_eq!(state.commands(&descriptor).len(), 1);
    state.close();
    assert!(state.agent_commands().is_empty());
    assert!(!state.set_agent_commands_for_query(&current, vec![command("closed", "Closed")]));
    let current = state.query_token();
    assert!(!state.set_agent_commands_for_query(&current, vec![Command::default(); 1_001]));
    assert!(state.agent_commands().is_empty());
}

#[test]
fn current_agent_command_executes_through_the_same_host_and_success_retires_its_token() {
    let descriptor = palette(command("local", "Local command"));
    let mut state = LaunchpadState::new();
    state.set_query("no local matches");
    let token = state.query_token();
    assert!(state.set_agent_commands_for_query(
        &token,
        vec![canonical(Some(Invoke::Copy("agent literal".into())))]
    ));
    let effects = Cell::new(0);
    let effect = |value: &str, _: NativeInvocationContext<'_>, _: &NativeCancellation| {
        assert_eq!(value, "agent literal");
        effects.set(effects.get() + 1);
        Ok(())
    };
    let allow = |_: NativeTarget<'_>, _: NativeInvocationContext<'_>| true;
    let host = NativeInvocationHost {
        copy: Some(&effect),
        admit: Some(&allow),
        ..Default::default()
    };
    let context = Context::default();
    assert!(paint(&mut state, &descriptor, &context, 140).contains("ASK THE AGENT"));
    assert_eq!(effects.get(), 0);
    assert_eq!(
        run(&mut state, &descriptor, &context, &host),
        Some(NativeLaunchpadResponse::Executed)
    );
    assert!(!state.set_agent_commands_for_query(&token, vec![command("late", "Late")]));
    assert_eq!(effects.get(), 1);
}

#[test]
fn palette_bounds_fail_whole_without_filtering_or_host_work() {
    let context = Context::default();
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
    for descriptor in [
        Launchpad {
            groups: vec![CommandGroup::default(); 1_001],
            ..Default::default()
        },
        palette(canonical(Some(Invoke::Copy("x".repeat(4 * 1024 * 1024))))),
        palette(Command {
            keywords: vec![String::new(); 1_001],
            ..canonical(Some(Invoke::Copy("x".into())))
        }),
    ] {
        let mut state = LaunchpadState::new();
        assert!(paint(&mut state, &descriptor, &context, 140).contains("limit exceeded"));
        assert_eq!(run(&mut state, &descriptor, &context, &host), None);
        assert_eq!(
            state.on_key_with_invocation(key(KeyCode::Down), &descriptor, &context, &host),
            None
        );
        assert_eq!(
            state.on_key_with_invocation(key(KeyCode::Esc), &descriptor, &context, &host),
            Some(NativeLaunchpadResponse::Cancelled)
        );
    }
    let descriptor = palette(canonical(Some(Invoke::Copy("x".into()))));
    let mut state = LaunchpadState::new();
    state.set_query("x".repeat(16 * 1024 + 1));
    assert!(paint(&mut state, &descriptor, &context, 140).contains("limit exceeded"));
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    state.on_key_with_invocation(key(KeyCode::Backspace), &descriptor, &context, &host);
    assert_eq!(state.query().len(), 16 * 1024);
    assert!(!paint(&mut state, &descriptor, &context, 140).contains("limit exceeded"));
    state.set_query("");
    state.set_agent_commands(vec![Command::default(); 1_000]);
    assert!(paint(&mut state, &descriptor, &context, 140).contains("limit exceeded"));
    assert_eq!(run(&mut state, &descriptor, &context, &host), None);
    state.set_agent_commands(vec![]);
    let invalid_context = Context {
        selected_row: Some(json!("x".repeat(5 * 1024 * 1024))),
        ..Default::default()
    };
    assert!(paint(&mut state, &descriptor, &invalid_context, 140).contains("limit exceeded"));
    assert_eq!(run(&mut state, &descriptor, &invalid_context, &host), None);
    assert_eq!(effects.get(), 0);
}

#[test]
fn palette_lifecycle_cancels_owned_worker_and_holds_single_flight_until_settlement() {
    use std::{sync::mpsc, thread, time::Duration};
    for trigger in 0..7 {
        let mut state = LaunchpadState::new();
        let mut descriptor = palette(canonical(Some(Invoke::Copy("literal".into()))));
        let mut context = Context::default();
        paint(&mut state, &descriptor, &context, 140);
        let dispatcher = state.invocation_dispatcher();
        let retained = dispatcher.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let action = Affordance {
                invoke: Some(Invoke::Copy("worker".into())),
                ..Default::default()
            };
            let context = Context::default();
            let effect = |_: &str, _: NativeInvocationContext<'_>, signal: &NativeCancellation| {
                started_tx.send(signal.clone()).unwrap();
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
        let signal = started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let clone = state.clone();
        drop(clone);
        assert!(!signal.is_cancelled());
        match trigger {
            0 => state.set_query("Run"),
            1 => state.set_agent_commands(vec![canonical(Some(Invoke::Copy("agent".into())))]),
            2 => {
                assert_eq!(
                    state.on_key_with_invocation(
                        key(KeyCode::Esc),
                        &descriptor,
                        &context,
                        &NativeInvocationHost::default()
                    ),
                    Some(NativeLaunchpadResponse::Cancelled)
                );
            }
            3 => {
                descriptor.groups[0].commands[0] =
                    canonical(Some(Invoke::Copy("replacement".into())));
                paint(&mut state, &descriptor, &context, 140);
            }
            4 => drop(std::mem::take(&mut state)),
            5 => {
                context.current_resource_path = Some("replacement".into());
                paint(&mut state, &descriptor, &context, 140);
            }
            _ => state.close(),
        }
        assert!(signal.is_cancelled());
        assert!(retained.pending());
        if trigger != 4 {
            paint(&mut state, &descriptor, &context, 140);
            assert_eq!(
                run(
                    &mut state,
                    &descriptor,
                    &context,
                    &NativeInvocationHost::default()
                ),
                None
            );
            assert!(paint(&mut state, &descriptor, &context, 140).contains("already running"));
        }
        finish_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), NativeInvocationOutcome::Cancelled);
        assert!(!retained.pending());
    }
}
