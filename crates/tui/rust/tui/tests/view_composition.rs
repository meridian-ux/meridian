//! Whole canonical ViewDescriptor wires rendered by the real native host.
use meridian_tui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use meridian_tui::{RpcError, RpcInvoker, ViewHost, ViewResponse};
use meridian_uiview::{proto::*, Context};
use prost::Message;
use ratatui::{backend::TestBackend, Terminal};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::BTreeSet};

#[derive(Default)]
struct Host {
    calls: RefCell<Vec<(String, Value)>>,
    fail: RefCell<bool>,
    rows: RefCell<Option<Value>>,
}
impl RpcInvoker for Host {
    fn invoke(&self, _: &str, method: &str, request: Value) -> Result<Value, RpcError> {
        self.calls.borrow_mut().push((method.into(), request));
        if *self.fail.borrow() {
            return Err(RpcError::Other("Read denied".into()));
        }
        Ok(match method {
            "Rows" => {
                self.rows.borrow().clone().unwrap_or_else(|| json!({"rows": [{"id": "a", "name": "001.20", "enabled": false, "count": 0}, {"id": "b", "name": "Second", "enabled": true, "count": 2}]}))
            }
            _ => json!({"title": format!("Fetched {method}")}),
        })
    }
}
fn call(method: &str) -> RpcCall {
    RpcCall {
        service: "fixture.Records".into(),
        method: method.into(),
        ..Default::default()
    }
}
fn slot(id: &str, position: i32) -> Slot {
    Slot {
        id: id.into(),
        title: format!("Section {id}"),
        position,
        panel: Some(PanelDescriptor {
            title: format!("Panel {id}"),
            body: Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                title: format!("Content {id}"),
                ..Default::default()
            })),
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn view(mode: Option<layout::Mode>) -> ViewDescriptor {
    let mut header = slot("header", 99);
    header.placement = Some(Placement {
        header_row: true,
        ..Default::default()
    });
    ViewDescriptor {
        id: "composed".into(),
        title: "Whole native view".into(),
        layout: Some(Layout { mode }),
        slots: vec![
            slot("last", 20),
            slot("first", -1),
            slot("tie-a", 5),
            slot("tie-b", 5),
            header,
        ],
        ..Default::default()
    }
}
fn wire(view: ViewDescriptor) -> ViewHost {
    ViewHost::new(ViewDescriptor::decode(view.encode_to_vec().as_slice()).unwrap()).unwrap()
}
fn draw(view: &mut ViewHost, context: &Context, host: &Host, width: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, 24)).unwrap();
    terminal
        .draw(|f| view.render(f, f.area(), context, host))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..24)
        .map(|y| {
            (0..width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn key(view: &mut ViewHost, context: &Context, code: KeyCode) -> Option<ViewResponse> {
    view.handle_key(KeyEvent::new(code, KeyModifiers::NONE), context)
        .unwrap()
}
fn sections(view: &mut ViewHost, context: &Context, host: &Host, width: u16) -> String {
    let mut output = draw(view, context, host, width);
    for _ in 0..25 {
        key(view, context, KeyCode::PageDown);
        output.push_str(&draw(view, context, host, width));
    }
    output
}

#[test]
fn list_stacked_and_unknown_layouts_preserve_full_view_order_at_80_and_wide() {
    for mode in [
        None,
        Some(layout::Mode::List(ListLayout {})),
        Some(layout::Mode::Stacked(StackedLayout {})),
    ] {
        for width in [80, 140] {
            let mut host = wire(view(mode));
            let output = sections(&mut host, &Context::default(), &Host::default(), width);
            let mut previous = 0;
            for id in ["header", "first", "tie-a", "tie-b", "last"] {
                let found = output.find(&format!("Section: Section {id}")).unwrap();
                assert!(found >= previous, "{id} out of order");
                previous = found;
                assert!(
                    output.contains(&format!("Content {id}")),
                    "missing real panel {id}"
                );
            }
            assert!(output.contains("Whole native view"));
        }
    }
}

#[test]
fn two_columns_stack_main_then_labeled_sidebar_without_dropping_unknown_columns() {
    let mut descriptor = view(Some(layout::Mode::TwoColumn(TwoColumnLayout {})));
    descriptor.slots[1].placement = Some(Placement {
        column: 2,
        ..Default::default()
    });
    descriptor.slots[2].placement = Some(Placement {
        column: 999,
        ..Default::default()
    });
    for width in [80, 140] {
        let output = sections(
            &mut wire(descriptor.clone()),
            &Context::default(),
            &Host::default(),
            width,
        );
        assert!(output.find("Section: Section last").unwrap() < output.find("Sidebar").unwrap());
        assert!(output.find("Sidebar").unwrap() < output.find("Section: Section first").unwrap());
        assert!(output.contains("Content tie-a"));
    }
}

#[test]
fn tabs_are_manual_keep_persistent_regions_and_never_read_inactive_or_gated_bodies() {
    let mut descriptor = view(Some(layout::Mode::Tabbed(TabbedLayout {})));
    descriptor.slots.truncate(3);
    for (index, id) in [(0, "Later"), (1, "Earlier")] {
        descriptor.slots[index].placement = Some(Placement {
            tab_label: id.into(),
            tab_position: index as i32,
            ..Default::default()
        });
        descriptor.slots[index].panel.as_mut().unwrap().body =
            Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                populate: Some(call(id)),
                title_source_path: "title".into(),
                ..Default::default()
            }));
    }
    descriptor.slots[1].depends_on_selection_key = "scope".into();
    descriptor.slots[1].depends_on_placeholder = "Choose a scope first".into();
    let mut view = wire(descriptor);
    let host = Host::default();
    let mut context = Context::default();
    let output = sections(&mut view, &context, &host, 80);
    assert!(output.contains("Content tie-a"));
    assert!(output.contains("Tab: Later") && output.contains("Tab: Earlier"));
    assert_eq!(
        host.calls
            .borrow()
            .iter()
            .map(|c| c.0.as_str())
            .collect::<Vec<_>>(),
        ["Later"]
    );
    // First target is persistent panel, followed by the two tab selectors.
    key(&mut view, &context, KeyCode::F(6));
    draw(&mut view, &context, &host, 80);
    key(&mut view, &context, KeyCode::Right);
    draw(&mut view, &context, &host, 80);
    assert_eq!(host.calls.borrow().len(), 1);
    key(&mut view, &context, KeyCode::Enter);
    let output = sections(&mut view, &context, &host, 80);
    assert!(output.contains("Choose a scope first"));
    assert_eq!(host.calls.borrow().len(), 1);
    context.selections.insert("scope".into(), json!("scope-A"));
    let output = sections(&mut view, &context, &host, 80);
    assert!(output.contains("Fetched Earlier"));
    assert_eq!(host.calls.borrow().len(), 2);
    context.selections.remove("scope");
    sections(&mut view, &context, &host, 80);
    assert_eq!(host.calls.borrow().len(), 2);
}

#[test]
fn repeated_nested_views_bind_real_raw_form_values_and_emit_host_owned_mutations() {
    let mut fields = vec![FormField {
        field_id: "name".into(),
        kind: Some(form_field::Kind::Text(TextInput::default())),
        ..Default::default()
    }];
    fields.extend([
        FormField {
            field_id: "enabled".into(),
            kind: Some(form_field::Kind::Boolean(BooleanToggle::default())),
            ..Default::default()
        },
        FormField {
            field_id: "count".into(),
            kind: Some(form_field::Kind::Integer(IntegerSpinner::default())),
            ..Default::default()
        },
    ]);
    let save = RpcCall {
        bindings: vec![FieldBinding {
            request_field: "recordId".into(),
            source: Some(field_binding::Source::RowField("id".into())),
        }],
        ..call("Save")
    };
    let child = ViewDescriptor {
        id: "child".into(),
        title: "Repeated child".into(),
        slots: vec![Slot {
            id: "editor".into(),
            panel: Some(PanelDescriptor {
                title: "Native row editor".into(),
                body: Some(panel_descriptor::Body::Form(FormPanel {
                    fields,
                    mode: FormMode::Edit as i32,
                    submit: Some(save.clone()),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            actions: vec![Action {
                id: "save".into(),
                label: "Save row".into(),
                call: Some(save),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let descriptor = ViewDescriptor {
        id: "root".into(),
        title: "Native repeated root".into(),
        slots: vec![Slot {
            id: "rows".into(),
            sub_view: Some(child),
            sub_view_populate: Some(call("Rows")),
            sub_view_rows_field: "rows".into(),
            panel: slot("ignored", 0).panel,
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut view = wire(descriptor);
    let host = Host::default();
    let context = Context::default();
    let output = sections(&mut view, &context, &host, 80);
    assert!(output.contains("001.20") && output.contains("Second"));
    assert!(!output.contains("Content ignored"));
    assert_eq!(host.calls.borrow().len(), 1);
    // Initial focus is the first row's slot action, then its real form.
    let Some(ViewResponse::Action {
        request, method, ..
    }) = key(&mut view, &context, KeyCode::Enter)
    else {
        panic!("action missing")
    };
    assert_eq!(method, "Save");
    assert_eq!(request, json!({"recordId": "a"}));
    key(&mut view, &context, KeyCode::F(6));
    draw(&mut view, &context, &host, 80);
    let Some(ViewResponse::Form(submission)) = key(&mut view, &context, KeyCode::Enter) else {
        panic!("form missing")
    };
    assert_eq!(
        submission.request,
        json!({"recordId": "a", "name": "001.20", "enabled": false, "count": 0})
    );
    key(&mut view, &context, KeyCode::F(6));
    draw(&mut view, &context, &host, 80);
    key(&mut view, &context, KeyCode::F(6));
    draw(&mut view, &context, &host, 80);
    let Some(ViewResponse::Form(submission)) = key(&mut view, &context, KeyCode::Enter) else {
        panic!("second form missing")
    };
    assert_eq!(
        submission.request,
        json!({"recordId": "b", "name": "Second", "enabled": true, "count": 2})
    );
    assert_eq!(
        host.calls.borrow().len(),
        1,
        "mutations are host-owned, not automatic RPCs"
    );
}

#[test]
fn closed_gate_blocks_reads_and_stale_action_events_even_before_redraw() {
    let mut descriptor = view(None);
    descriptor.slots.truncate(1);
    descriptor.slots[0].depends_on_selection_key = "scope".into();
    descriptor.slots[0].actions.push(Action {
        id: "danger".into(),
        label: "Delete".into(),
        call: Some(call("Delete")),
        ..Default::default()
    });
    let host = Host::default();
    let mut context = Context::default();
    let mut view = wire(descriptor);
    context.selections.insert("scope".into(), json!("scope-A"));
    draw(&mut view, &context, &host, 80);
    context.selections.clear();
    assert!(key(&mut view, &context, KeyCode::Enter).is_none());
    assert!(host.calls.borrow().is_empty());
}

#[test]
fn falsey_scope_gates_block_reads_and_stale_actions_at_native_widths() {
    for width in [80, 140] {
        for value in [
            None,
            Some(Value::Null),
            Some(json!(false)),
            Some(json!(0)),
            Some(json!(-0.0)),
            Some(json!("")),
        ] {
            let mut descriptor = view(None);
            descriptor.slots.truncate(1);
            let slot = &mut descriptor.slots[0];
            slot.depends_on_selection_key = "scope".into();
            slot.depends_on_placeholder = "Choose a scope first".into();
            slot.panel.as_mut().unwrap().body =
                Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                    populate: Some(call("Scoped")),
                    title_source_path: "title".into(),
                    ..Default::default()
                }));
            slot.actions.push(Action {
                id: "danger".into(),
                label: "Delete".into(),
                call: Some(call("Delete")),
                ..Default::default()
            });
            let mut context = Context::default();
            if let Some(value) = value.clone() {
                context.selections.insert("scope".into(), value);
            }
            let host = Host::default();
            let mut native = wire(descriptor);
            let output = draw(&mut native, &context, &host, width);
            assert!(
                output.contains("Choose a scope first"),
                "{width}: {value:?}"
            );
            assert!(
                host.calls.borrow().is_empty(),
                "closed gate fetched: {value:?}"
            );

            context.selections.insert("scope".into(), json!("scope-A"));
            draw(&mut native, &context, &host, width);
            assert_eq!(host.calls.borrow().len(), 1);
            context.selections.remove("scope");
            if let Some(value) = value {
                context.selections.insert("scope".into(), value);
            }
            assert!(
                key(&mut native, &context, KeyCode::Enter).is_none(),
                "stale action escaped a closed gate"
            );
            assert_eq!(host.calls.borrow().len(), 1);
        }
    }
}

#[test]
fn failed_repeated_reads_require_explicit_retry_and_keep_visible_errors() {
    let descriptor = ViewDescriptor {
        slots: vec![Slot {
            id: "rows".into(),
            sub_view: Some(ViewDescriptor::default()),
            sub_view_populate: Some(call("Rows")),
            sub_view_rows_field: "rows".into(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut view = wire(descriptor);
    let host = Host::default();
    *host.fail.borrow_mut() = true;
    assert!(draw(&mut view, &Context::default(), &host, 80).contains("Read denied"));
    draw(&mut view, &Context::default(), &host, 80);
    assert_eq!(host.calls.borrow().len(), 1);
    *host.fail.borrow_mut() = false;
    key(&mut view, &Context::default(), KeyCode::Enter);
    sections(&mut view, &Context::default(), &host, 80);
    assert_eq!(host.calls.borrow().len(), 2);
}

#[test]
fn descriptor_depth_node_and_label_limits_reject_before_mounting() {
    let mut deep = ViewDescriptor::default();
    for _ in 0..66 {
        deep = ViewDescriptor {
            slots: vec![Slot {
                sub_view: Some(deep),
                ..Default::default()
            }],
            ..Default::default()
        };
    }
    assert!(ViewHost::new(deep).is_err());
    assert!(ViewHost::new(ViewDescriptor {
        slots: vec![Slot::default(); 1000],
        ..Default::default()
    })
    .is_err());
    assert!(ViewHost::new(ViewDescriptor {
        title: "x".repeat(17 * 1024),
        ..Default::default()
    })
    .is_err());
}

#[test]
fn empty_views_keep_identity_and_header_actions_and_long_labels_are_reachable() {
    let mut descriptor = ViewDescriptor {
        id: "empty".into(),
        title: "Still here".into(),
        actions: vec![Action {
            id: "export".into(),
            label: "Export".into(),
            call: Some(call("Export")),
            ..Default::default()
        }],
        ..Default::default()
    };
    let host = Host::default();
    let mut view = wire(descriptor.clone());
    let output = draw(&mut view, &Context::default(), &host, 80);
    assert!(
        output.contains("Still here")
            && output.contains("No sections.")
            && output.contains("Export")
    );
    assert!(matches!(
        key(&mut view, &Context::default(), KeyCode::Enter),
        Some(ViewResponse::Action { .. })
    ));
    descriptor.actions[0].label = "長い label ".repeat(30);
    let output = sections(&mut wire(descriptor), &Context::default(), &host, 80);
    let symbols: BTreeSet<_> = output.chars().collect();
    assert!(symbols.contains(&'長'));
    assert!(
        output.contains("[export]"),
        "wrapped label tail must remain reachable"
    );
    assert!(host.calls.borrow().is_empty());
}

#[test]
fn malformed_or_overexpanded_repeated_rows_fail_before_child_mounts() {
    for rows in [
        json!({"rows": "bad"}),
        json!({"rows": [null]}),
        json!({"rows": vec![json!({}); 1001]}),
        json!({"rows": [{"huge": "x".repeat(5 * 1024 * 1024)}]}),
    ] {
        let mut child_slot = slot("child", 0);
        child_slot.panel.as_mut().unwrap().body =
            Some(panel_descriptor::Body::DetailHeader(DetailHeaderPanel {
                populate: Some(call("Never")),
                ..Default::default()
            }));
        let descriptor = ViewDescriptor {
            slots: vec![Slot {
                id: "rows".into(),
                sub_view: Some(ViewDescriptor {
                    slots: vec![child_slot],
                    ..Default::default()
                }),
                sub_view_populate: Some(call("Rows")),
                sub_view_rows_field: "rows".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let host = Host::default();
        *host.rows.borrow_mut() = Some(rows);
        let output = draw(&mut wire(descriptor), &Context::default(), &host, 80);
        assert!(output.contains("Enter to retry"));
        assert_eq!(host.calls.borrow().len(), 1);
        assert_eq!(host.calls.borrow()[0].0, "Rows");
    }
}

#[test]
fn switching_tabs_closes_live_streams_before_the_next_draw() {
    use meridian_tui::{StreamError, StreamInvoker, StreamSession};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    };
    #[derive(Default)]
    struct Streams {
        closed: Arc<AtomicUsize>,
        senders: RefCell<Vec<mpsc::Sender<StreamFrame>>>,
    }
    impl StreamInvoker for Streams {
        fn subscribe(&self, _: &RpcCall, _: Value) -> Result<StreamSession, StreamError> {
            let (tx, rx) = mpsc::channel();
            self.senders.borrow_mut().push(tx);
            let closed = self.closed.clone();
            Ok(StreamSession::new(rx, move || {
                closed.fetch_add(1, Ordering::SeqCst);
            }))
        }
    }
    let mut first = slot("stream", 0);
    first.placement = Some(Placement {
        tab_label: "Live".into(),
        ..Default::default()
    });
    first.panel.as_mut().unwrap().body = Some(panel_descriptor::Body::Stream(StreamPanel {
        subscribe: Some(call("Watch")),
        ..Default::default()
    }));
    let mut second = slot("other", 1);
    second.placement = Some(Placement {
        tab_label: "Other".into(),
        ..Default::default()
    });
    let mut view = wire(ViewDescriptor {
        layout: Some(Layout {
            mode: Some(layout::Mode::Tabbed(TabbedLayout {})),
        }),
        slots: vec![first, second],
        ..Default::default()
    });
    let streams = Streams::default();
    let host = Host::default();
    let context = Context::default();
    draw(&mut view, &context, &host, 80);
    view.poll_streams(&context, &streams);
    assert_eq!(streams.senders.borrow().len(), 1);
    assert_eq!(streams.closed.load(Ordering::SeqCst), 0);
    key(&mut view, &context, KeyCode::Right);
    assert_eq!(
        streams.closed.load(Ordering::SeqCst),
        0,
        "manual focus must not activate"
    );
    key(&mut view, &context, KeyCode::Enter);
    assert_eq!(streams.closed.load(Ordering::SeqCst), 1);
    view.poll_streams(&context, &streams);
    assert_eq!(
        streams.senders.borrow().len(),
        1,
        "obsolete target must not resubscribe"
    );
}

#[test]
fn operation_callbacks_route_by_token_across_focus_and_reject_unmounted_runs() {
    let mut first = slot("operation", 0);
    first.panel.as_mut().unwrap().body = Some(panel_descriptor::Body::Lro(LroPanel {
        start: Some(call("Start")),
        ..Default::default()
    }));
    let mut view = wire(ViewDescriptor {
        slots: vec![first, slot("other", 1)],
        ..Default::default()
    });
    let context = Context::default();
    let host = Host::default();
    draw(&mut view, &context, &host, 80);
    let Some(ViewResponse::Lro(submission)) = key(&mut view, &context, KeyCode::Enter) else {
        panic!("start missing")
    };
    key(&mut view, &context, KeyCode::F(6));
    draw(&mut view, &context, &host, 80);
    assert!(view.complete_lro(&submission.run_id, &Default::default()));
    assert!(!view.complete_lro(&submission.run_id, &Default::default()));
    view.invalidate();
    assert!(!view.update_lro_progress(&submission.run_id, "operations/old", &Default::default()));
    assert!(host.calls.borrow().is_empty());
}

#[test]
fn shared_browser_wire_fixture_renders_as_a_complete_native_view() {
    use std::path::PathBuf;
    let mut roots = vec![PathBuf::from("schemas/conformance/fixtures")];
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        roots.push(PathBuf::from(manifest).join("../../../../schemas/conformance/fixtures"));
    }
    let root = roots
        .iter()
        .find(|p| p.join("media/typical.view.binpb").is_file())
        .unwrap();
    let descriptor = ViewDescriptor::decode(
        std::fs::read(root.join("media/typical.view.binpb"))
            .unwrap()
            .as_slice(),
    )
    .unwrap();
    let expected_title = descriptor.title.clone();
    let expected_panel = descriptor.slots[0].panel.as_ref().unwrap().title.clone();
    let output = sections(
        &mut ViewHost::new(descriptor).unwrap(),
        &Context::default(),
        &Host::default(),
        80,
    );
    assert!(output.contains(&expected_title));
    assert!(output.contains(&expected_panel));
    assert!(output.contains("F6/Shift+F6"));
}

#[test]
fn prompt_preview_keeps_native_paging_while_control_paging_scrolls_the_view() {
    let mut prompt = slot("preview", 0);
    prompt.panel.as_mut().unwrap().body = Some(panel_descriptor::Body::LlmPrompt(LlmPromptPanel {
        user_template: (0..40)
            .map(|i| format!("Preview line {i:02}"))
            .collect::<Vec<_>>()
            .join("\n"),
        ..Default::default()
    }));
    let mut view = wire(ViewDescriptor {
        slots: vec![prompt, slot("after-preview", 1)],
        ..Default::default()
    });
    let host = Host::default();
    let context = Context::default();
    assert!(draw(&mut view, &context, &host, 80).contains("Preview line 00"));
    key(&mut view, &context, KeyCode::PageDown);
    let paged = draw(&mut view, &context, &host, 80);
    assert!(!paged.contains("Preview line 00"));
    assert!(paged.contains("Preview line 05"));
    view.handle_key(
        KeyEvent::new(KeyCode::PageDown, KeyModifiers::CONTROL),
        &context,
    )
    .unwrap();
    assert!(draw(&mut view, &context, &host, 80).contains("Content after-preview"));
    assert!(host.calls.borrow().is_empty());
}
