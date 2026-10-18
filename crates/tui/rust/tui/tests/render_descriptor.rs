//! End-to-end: wire bytes → `PanelDescriptor` → drawn terminal cells.
//!
//! This is the path `src/main.rs` runs, minus the TTY. It exists because the
//! binary itself cannot be gated in CI — it takes over a terminal — and a
//! renderer whose only proof is someone looking at it is a renderer that breaks
//! quietly. `ratatui::backend::TestBackend` draws into a buffer, so the same
//! render call the binary makes is assertable headlessly.
//!
//! It also closes the loop the monorepo merge opened. Until the merge this crate
//! could not be compiled at all — it named `meridian_uiview` and `theme_proto`,
//! which only Bazel's `rust_prost_library` produced — so *nothing* here had ever
//! been executed against a descriptor. The first `cargo build` immediately found
//! a `Block.view` arm missing since schemas 0.21.0 and three test fixtures
//! enumerating fields the schema had outgrown.

#![allow(clippy::needless_update)]

use std::path::PathBuf;

use crossterm::event::KeyCode;
use prost::Message as _;
use ratatui::{backend::TestBackend, Terminal};

use meridian_tui::{Palette, PanelView, RpcError, RpcInvoker};
use meridian_uiview::proto::{
    form_field::Kind, panel_descriptor::Body, BooleanToggle, CardSpec, DescriptorRow,
    DetailHeaderPanel, EnumOption, EnumSelection, FormField, FormMode, FormPanel, GalleryPanel,
    IntegerSpinner, LroPanel, MediaChapter, MediaPanel, PanelDescriptor, RecordCardPanel, RpcCall,
    StatPanel, TextInput,
};
use meridian_uiview::Context;

/// Refuses everything, loudly — the same posture as the binary's OfflineInvoker.
/// A `Result::Ok(json!({}))` here would let a panel that never got its data look
/// like it rendered fine, which is the failure this whole test is guarding.
struct Refuse;

impl RpcInvoker for Refuse {
    fn invoke(
        &self,
        s: &str,
        m: &str,
        _r: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Err(RpcError::Transport(format!("{s}/{m}: no transport")))
    }
}

struct GalleryData;

mod host_admission {
    use super::*;
    use meridian_tui::prost_types::Struct;
    use meridian_uiview::proto::{field_binding::Source, FieldBinding, TablePanel};
    use std::cell::{Cell, RefCell};
    use std::collections::HashSet;

    const DENIED: &str = "Denied by host policy";

    #[derive(Default)]
    struct Backend {
        calls: Cell<usize>,
    }

    impl RpcInvoker for Backend {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            self.calls.set(self.calls.get() + 1);
            Ok(serde_json::json!({"name": "operations/admitted"}))
        }
    }

    // Runtime host policy fixture, not a renderer-owned authorization engine or
    // serialized DTO. Denial happens before the backend is ever called.
    struct Host<'a> {
        backend: &'a Backend,
        allowed: RefCell<HashSet<(String, String)>>,
        attempts: RefCell<Vec<(String, String, serde_json::Value)>>,
    }

    impl<'a> Host<'a> {
        fn new(backend: &'a Backend) -> Self {
            Self {
                backend,
                allowed: RefCell::new(HashSet::new()),
                attempts: RefCell::new(Vec::new()),
            }
        }

        fn allow(&self, service: &str, method: &str) {
            self.allowed
                .borrow_mut()
                .insert((service.into(), method.into()));
        }
    }

    impl RpcInvoker for Host<'_> {
        fn invoke(
            &self,
            service: &str,
            method: &str,
            request: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            let key = (service.to_owned(), method.to_owned());
            self.attempts
                .borrow_mut()
                .push((key.0.clone(), key.1.clone(), request.clone()));
            if !self.allowed.borrow().contains(&key) {
                return Err(RpcError::Other(DENIED.into()));
            }
            self.backend.invoke(service, method, request)
        }
    }

    fn paint<I: RpcInvoker>(
        view: &mut PanelView,
        descriptor: &PanelDescriptor,
        context: &Context,
        invoker: &I,
    ) -> String {
        let mut terminal = Terminal::new(TestBackend::new(120, 28)).unwrap();
        terminal
            .draw(|frame| view.render(frame, frame.area(), descriptor, context, invoker))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    fn call(method: &str) -> RpcCall {
        RpcCall {
            service: "fixture.Admission".into(),
            method: method.into(),
            bindings: vec![FieldBinding {
                request_field: "tenant".into(),
                source: Some(Source::Literal("scope-1".into())),
            }],
        }
    }

    #[test]
    fn denied_populate_and_prefill_render_the_host_denial_not_empty_success() {
        for body in [
            Body::Table(TablePanel {
                populate: Some(call("Read")),
                rows_field: "items".into(),
                item_noun: "records".into(),
                ..Default::default()
            }),
            Body::Form(
                FormPanel {
                    mode: FormMode::Edit as i32,
                    prefill: Some(call("Read")),
                    fields: vec![FormField {
                        field_id: "name".into(),
                        kind: Some(Kind::Text(TextInput {
                            default_value: "retained".into(),
                            ..Default::default()
                        })),
                        ..Default::default()
                    }],
                    ..Default::default()
                }
                .into(),
            ),
        ] {
            let descriptor = PanelDescriptor {
                body: Some(body),
                ..Default::default()
            };
            let wire = descriptor.encode_to_vec();
            let decoded = PanelDescriptor::decode(wire.as_slice()).unwrap();
            let backend = Backend::default();
            let host = Host::new(&backend);
            let context = Context::default();
            let mut view = PanelView::new();
            let first = paint(&mut view, &decoded, &context, &host);
            assert!(first.contains(DENIED), "{first}");
            assert_eq!(host.attempts.borrow().len(), 1);
            assert_eq!(
                host.attempts.borrow()[0],
                (
                    "fixture.Admission".into(),
                    "Read".into(),
                    serde_json::json!({"tenant": "scope-1"})
                )
            );
            assert_eq!(backend.calls.get(), 0);
            let second = paint(&mut view, &decoded, &context, &host);
            assert!(second.contains(DENIED), "{second}");
            assert_eq!(host.attempts.borrow().len(), 1, "repaint must not retry");
            assert_eq!(backend.calls.get(), 0);
            assert_eq!(decoded.encode_to_vec(), wire);
        }
    }

    #[test]
    fn denied_lro_start_is_visible_retryable_and_cannot_overwrite_an_admitted_retry() {
        let descriptor = PanelDescriptor {
            body: Some(Body::Lro(LroPanel {
                start: Some(call("Start")),
                inputs: vec![FormField {
                    field_id: "name".into(),
                    request_field: "settings.name".into(),
                    label: "Name".into(),
                    kind: Some(Kind::Text(TextInput {
                        default_value: "001.20".into(),
                        ..Default::default()
                    })),
                    ..Default::default()
                }],
                ..Default::default()
            })),
            ..Default::default()
        };
        let wire = descriptor.encode_to_vec();
        let decoded = PanelDescriptor::decode(wire.as_slice()).unwrap();
        let Some(Body::Lro(panel)) = decoded.body.as_ref() else {
            panic!("expected LRO fixture")
        };
        let backend = Backend::default();
        let host = Host::new(&backend);
        let context = Context::default();
        let mut view = PanelView::new();
        paint(&mut view, &decoded, &context, &host);
        let denied = view
            .handle_lro_key(panel, &context, KeyCode::Enter)
            .unwrap();
        assert!(view
            .handle_lro_key(panel, &context, KeyCode::Enter)
            .is_none());
        let expected = serde_json::json!({"tenant": "scope-1", "settings": {"name": "001.20"}});
        assert_eq!(denied.request, expected);
        let error = host
            .invoke(&denied.service, &denied.method, denied.request.clone())
            .unwrap_err();
        assert_eq!(backend.calls.get(), 0);
        assert!(view.fail_lro(&denied.run_id, &error.to_string()));
        let text = paint(&mut view, &decoded, &context, &host);
        assert!(text.contains(DENIED), "{text}");
        assert!(!view.complete_lro(&denied.run_id, &Struct::default()));

        host.allow("fixture.Admission", "Start");
        let retry = view
            .handle_lro_key(panel, &context, KeyCode::Enter)
            .unwrap();
        assert_ne!(retry.run_id, denied.run_id);
        assert_eq!(retry.request, expected, "denial must retain raw input");
        let response = host
            .invoke(&retry.service, &retry.method, retry.request)
            .unwrap();
        assert_eq!(backend.calls.get(), 1);
        assert_eq!(host.attempts.borrow().len(), 2);
        assert!(view.update_lro_progress(
            &retry.run_id,
            response["name"].as_str().unwrap(),
            &Struct::default()
        ));
        assert!(!view.fail_lro(&denied.run_id, "stale denial"));
        let text = paint(&mut view, &decoded, &context, &host);
        assert!(!text.contains(DENIED), "{text}");
        assert!(!text.contains("stale denial"), "{text}");
        assert!(text.contains("operations/admitted"), "{text}");
        assert_eq!(decoded.encode_to_vec(), wire);
    }
}

mod bounded_requests {
    use super::*;
    use meridian_uiview::proto::{field_binding::Source, FieldBinding};
    use std::cell::Cell;
    const ERROR: &str = "Request construction limit exceeded.";
    struct Spy(Cell<usize>);
    impl RpcInvoker for Spy {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            self.0.set(self.0.get() + 1);
            Ok(serde_json::json!({}))
        }
    }
    #[test]
    fn row_action_rejection_is_fallible_and_preserves_the_selected_row() {
        struct Rows;
        impl RpcInvoker for Rows {
            fn invoke(
                &self,
                _: &str,
                _: &str,
                _: serde_json::Value,
            ) -> Result<serde_json::Value, RpcError> {
                Ok(serde_json::json!({"claims":[{"id":0}], "services":[{"id":0}]}))
            }
        }
        let descriptor =
            PanelDescriptor::decode(read_canonical_fixture("table.binpb").as_slice()).unwrap();
        let mut view = PanelView::new();
        let context = Context::default();
        Terminal::new(TestBackend::new(120, 30))
            .unwrap()
            .draw(|frame| {
                view.render(frame, frame.area(), &descriptor, &context, &Rows);
            })
            .unwrap();
        if view.selected_row().is_none() {
            view.select_next();
        }
        let before = view.selected_row().unwrap().clone();
        assert!(view
            .try_selected_row_request(&bad_call(), &context, false)
            .is_err());
        assert!(view
            .selected_row_request(&bad_call(), &context, false)
            .is_none());
        let oversized_legacy = RpcCall {
            service: "x".repeat(65_537),
            ..Default::default()
        };
        assert!(view
            .try_selected_row_request(&oversized_legacy, &context, true)
            .is_err());
        assert_eq!(view.selected_row(), Some(&before));
    }

    fn bad_call() -> RpcCall {
        RpcCall {
            service: "fixture.Bounded".into(),
            method: "Read".into(),
            bindings: vec![FieldBinding {
                request_field: "a.".repeat(100) + "leaf",
                source: Some(Source::Literal("not sent".into())),
            }],
        }
    }
    #[test]
    fn form_field_ids_are_literal_and_lro_only_request_paths_are_ignored() {
        let form = FormPanel {
            mode: FormMode::Edit as i32,
            fields: vec![FormField {
                field_id: "input.name".into(),
                request_field: "ignored.".repeat(100),
                kind: Some(Kind::Text(TextInput {
                    default_value: "raw".into(),
                    ..Default::default()
                })),
                ..Default::default()
            }],
            submit: Some(RpcCall {
                service: "fixture.Form".into(),
                method: "Save".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let descriptor = PanelDescriptor {
            body: Some(Body::Form(form.clone().into())),
            ..Default::default()
        };
        let mut view = PanelView::new();
        buffer(&mut view, &descriptor, &Spy(Cell::new(0)));
        let submitted = view
            .handle_form_key(&form, &Context::default(), KeyCode::Enter)
            .unwrap();
        assert_eq!(submitted.request, serde_json::json!({"input.name":"raw"}));
    }
    fn buffer<I: RpcInvoker>(
        view: &mut PanelView,
        descriptor: &PanelDescriptor,
        invoker: &I,
    ) -> String {
        let mut terminal = Terminal::new(TestBackend::new(120, 30)).unwrap();
        terminal
            .draw(|frame| {
                view.render(
                    frame,
                    frame.area(),
                    descriptor,
                    &Context::default(),
                    invoker,
                )
            })
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<Vec<_>>()
            .concat()
    }
    #[test]
    fn every_populate_family_rejects_before_invocation_and_renders_the_reason() {
        for name in [
            "table",
            "stat",
            "chart",
            "resource_cards",
            "gallery",
            "record_card",
            "detail_header",
        ] {
            let mut descriptor = PanelDescriptor::decode(
                read_canonical_fixture(&format!("{name}.binpb")).as_slice(),
            )
            .unwrap();
            match descriptor.body.as_mut().unwrap() {
                Body::Table(panel) => panel.populate = Some(bad_call()),
                Body::Stat(panel) => panel.populate = Some(bad_call()),
                Body::Chart(panel) => panel.chart.as_mut().unwrap().populate = Some(bad_call()),
                Body::ResourceCards(panel) => panel.populate = Some(bad_call()),
                Body::Gallery(panel) => panel.populate = Some(bad_call()),
                Body::RecordCard(panel) => panel.populate = Some(bad_call()),
                Body::DetailHeader(panel) => panel.populate = Some(bad_call()),
                _ => unreachable!(),
            }
            let spy = Spy(Cell::new(0));
            let mut view = PanelView::new();
            let output = buffer(&mut view, &descriptor, &spy);
            assert_eq!(spy.0.get(), 0, "{name}");
            assert!(output.contains(ERROR), "{name}: {output}");
        }
    }
    struct Data {
        calls: Cell<usize>,
        response: serde_json::Value,
    }
    #[test]
    fn excessive_descriptor_only_headers_fail_before_constructing_terminal_cells() {
        use meridian_uiview::proto::{TableColumn, TablePanel};
        let descriptor = PanelDescriptor {
            body: Some(Body::Table(TablePanel {
                columns: vec![TableColumn::default(); 4096],
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut view = PanelView::new();
        let spy = Spy(Cell::new(0));
        assert!(
            buffer(&mut view, &descriptor, &spy).contains("Render construction limit exceeded.")
        );
        assert_eq!(spy.0.get(), 0);
    }
    impl RpcInvoker for Data {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            self.calls.set(self.calls.get() + 1);
            Ok(self.response.clone())
        }
    }
    #[test]
    fn repeated_table_and_gallery_projections_fail_visibly_without_rows() {
        use meridian_uiview::proto::{CardSpec, TableColumn, TablePanel};
        let call = RpcCall {
            service: "fixture.Data".into(),
            method: "List".into(),
            ..Default::default()
        };
        for body in [
            Body::Table(TablePanel {
                rows_field: "rows".into(),
                populate: Some(call.clone()),
                columns: vec![
                    TableColumn {
                        field_path: "value".into(),
                        ..Default::default()
                    };
                    8
                ],
                ..Default::default()
            }),
            Body::Gallery(GalleryPanel {
                rows_field: "rows".into(),
                populate: Some(call.clone()),
                card: Some(CardSpec {
                    title_field: "value".into(),
                    subtitle_field: "value".into(),
                    status_field: "value".into(),
                    href_field: "value".into(),
                    icon_field: "value".into(),
                    action_label_field: "value".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        ] {
            let descriptor = PanelDescriptor {
                body: Some(body),
                ..Default::default()
            };
            let descriptor =
                PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
            let data = Data {
                calls: Cell::new(0),
                response: serde_json::json!({"rows":[{"value":"x".repeat(400_000)}]}),
            };
            let mut view = PanelView::new();
            assert!(buffer(&mut view, &descriptor, &data)
                .contains("Render construction limit exceeded."));
            assert!(view.selected_row().is_none());
            assert!(buffer(&mut view, &descriptor, &data)
                .contains("Render construction limit exceeded."));
            assert_eq!(data.calls.get(), 1);
        }
    }

    #[test]
    fn every_populate_family_rejects_oversized_responses_before_retaining_them() {
        for name in [
            "table",
            "stat",
            "chart",
            "resource_cards",
            "gallery",
            "record_card",
            "detail_header",
        ] {
            let mut descriptor = PanelDescriptor::decode(
                read_canonical_fixture(&format!("{name}.binpb")).as_slice(),
            )
            .unwrap();
            let call = RpcCall {
                service: "fixture.Data".into(),
                method: "Get".into(),
                ..Default::default()
            };
            match descriptor.body.as_mut().unwrap() {
                Body::Table(p) => p.populate = Some(call),
                Body::Stat(p) => p.populate = Some(call),
                Body::Chart(p) => p.chart.as_mut().unwrap().populate = Some(call),
                Body::ResourceCards(p) => p.populate = Some(call),
                Body::Gallery(p) => p.populate = Some(call),
                Body::RecordCard(p) => p.populate = Some(call),
                Body::DetailHeader(p) => p.populate = Some(call),
                _ => unreachable!(),
            }
            let data = Data {
                calls: Cell::new(0),
                response: serde_json::json!({"unused":"x".repeat(5*1024*1024)}),
            };
            let mut view = PanelView::new();
            let result = buffer(&mut view, &descriptor, &data);
            assert!(
                result.contains("Response construction limit exceeded."),
                "{name}: {result}"
            );
            assert_eq!(data.calls.get(), 1);
        }
    }
    #[test]
    fn automatic_form_and_lro_paths_are_bounded_without_returning_a_submission() {
        let field = FormField {
            field_id: "input".into(),
            label: "Input".into(),
            request_field: "a.".repeat(100) + "leaf",
            kind: Some(Kind::Text(TextInput {
                default_value: "raw".into(),
                ..Default::default()
            })),
            ..Default::default()
        };
        let call = RpcCall {
            service: "fixture.Bounded".into(),
            method: "Start".into(),
            ..Default::default()
        };
        let spy = Spy(Cell::new(0));
        let form = FormPanel {
            mode: FormMode::Edit as i32,
            fields: vec![field.clone()],
            submit: Some(bad_call()),
            ..Default::default()
        };
        let descriptor = PanelDescriptor {
            body: Some(Body::Form(form.clone().into())),
            ..Default::default()
        };
        let mut view = PanelView::new();
        buffer(&mut view, &descriptor, &spy);
        assert!(view
            .handle_form_key(&form, &Context::default(), KeyCode::Enter)
            .is_none());
        assert!(buffer(&mut view, &descriptor, &spy).contains(ERROR));
        let lro = LroPanel {
            inputs: vec![field],
            start: Some(call),
            ..Default::default()
        };
        let descriptor = PanelDescriptor {
            body: Some(Body::Lro(lro.clone())),
            ..Default::default()
        };
        let mut view = PanelView::new();
        buffer(&mut view, &descriptor, &spy);
        assert!(view
            .handle_lro_key(&lro, &Context::default(), KeyCode::Enter)
            .is_none());
        assert!(buffer(&mut view, &descriptor, &spy).contains(ERROR));
        assert_eq!(spy.0.get(), 0);
    }
    #[test]
    fn rejected_stream_request_never_subscribes_or_falls_back_to_empty_scope() {
        struct StreamSpy(Cell<usize>);
        impl meridian_tui::StreamInvoker for StreamSpy {
            fn subscribe(
                &self,
                _: &RpcCall,
                _: serde_json::Value,
            ) -> Result<meridian_tui::StreamSession, meridian_tui::StreamError> {
                self.0.set(self.0.get() + 1);
                panic!("Rejected request reached subscription")
            }
        }
        let mut descriptor =
            PanelDescriptor::decode(read_canonical_fixture("stream.binpb").as_slice()).unwrap();
        let Some(Body::Stream(panel)) = descriptor.body.as_mut() else {
            unreachable!()
        };
        panel.subscribe = Some(bad_call());
        let mut view = PanelView::new();
        let stream = StreamSpy(Cell::new(0));
        view.poll_stream(&descriptor, &Context::default(), &stream);
        assert_eq!(stream.0.get(), 0);
        assert!(buffer(&mut view, &descriptor, &Spy(Cell::new(0))).contains(ERROR));
    }
}

mod inline_form_validation {
    use super::*;
    use meridian_uiview::proto::{
        repeated_field, KeyValueMapField, MaskedInput, NestedForm, NumberInput, RepeatedField,
    };
    use serde_json::json;
    fn field(id: &str, kind: Kind) -> FormField {
        FormField {
            field_id: id.into(),
            label: id.into(),
            kind: Some(kind),
            ..Default::default()
        }
    }
    fn descriptor(fields: Vec<FormField>) -> PanelDescriptor {
        let authored = PanelDescriptor {
            body: Some(Body::Form(
                FormPanel {
                    fields,
                    mode: FormMode::Edit as i32,
                    submit: Some(RpcCall {
                        service: "fixture.Forms".into(),
                        method: "Save".into(),
                        ..Default::default()
                    }),
                    ..Default::default()
                }
                .into(),
            )),
            ..Default::default()
        };
        PanelDescriptor::decode(authored.encode_to_vec().as_slice()).unwrap()
    }
    fn form(descriptor: &PanelDescriptor) -> &FormPanel {
        match descriptor.body.as_ref().unwrap() {
            Body::Form(form) => form,
            _ => panic!("form required"),
        }
    }
    fn draw(view: &mut PanelView, descriptor: &PanelDescriptor) -> String {
        let mut term = Terminal::new(TestBackend::new(100, 20)).unwrap();
        term.draw(|frame| {
            view.render(
                frame,
                frame.area(),
                descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
        term.backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }
    fn edit(view: &mut PanelView, form: &FormPanel, text: &str) {
        let ctx = Context::default();
        assert!(view.handle_form_key(form, &ctx, KeyCode::F(2)).is_none());
        view.handle_form_key(form, &ctx, KeyCode::Delete);
        for character in text.chars() {
            view.handle_form_key(form, &ctx, KeyCode::Char(character));
        }
        assert!(view.handle_form_key(form, &ctx, KeyCode::Enter).is_none());
    }
    #[test]
    fn all_nine_kinds_edit_and_emit_raw_typed_values() {
        let descriptor = descriptor(vec![
            field(
                "text",
                Kind::Text(TextInput {
                    default_value: "0001".into(),
                    ..Default::default()
                }),
            ),
            field(
                "secret",
                Kind::Masked(MaskedInput {
                    default_value: "hidden".into(),
                    ..Default::default()
                }),
            ),
            field("integer", Kind::Integer(IntegerSpinner::default())),
            field(
                "number",
                Kind::Number(NumberInput {
                    default_value: 0.25,
                    ..Default::default()
                }),
            ),
            field("boolean", Kind::Boolean(BooleanToggle::default())),
            field(
                "enum",
                Kind::EnumSelection(EnumSelection {
                    allowed_values: vec!["RAW".into()],
                    ..Default::default()
                }),
            ),
            field(
                "nested",
                Kind::Nested(NestedForm {
                    fields: vec![field("enabled", Kind::Boolean(BooleanToggle::default()))],
                }),
            ),
            field(
                "array",
                Kind::Repeated(Box::new(RepeatedField {
                    element: Some(repeated_field::Element::Scalar(Box::new(field(
                        "element",
                        Kind::Text(TextInput::default()),
                    )))),
                    ..Default::default()
                })),
            ),
            field("map", Kind::KeyValueMap(KeyValueMapField::default())),
        ]);
        let form = form(&descriptor);
        let mut view = PanelView::new();
        let output = draw(&mut view, &descriptor);
        assert!(!output.contains("hidden"));
        for _ in 0..6 {
            view.handle_form_key(form, &Context::default(), KeyCode::Tab);
        }
        edit(&mut view, form, r#"{"enabled":true}"#);
        view.handle_form_key(form, &Context::default(), KeyCode::Tab);
        edit(&mut view, form, r#"["", "0001"]"#);
        view.handle_form_key(form, &Context::default(), KeyCode::Tab);
        view.handle_form_key(form, &Context::default(), KeyCode::F(2));
        assert!(draw(&mut view, &descriptor).contains("as JSON"));
        view.handle_form_key(form, &Context::default(), KeyCode::Esc);
        edit(&mut view, form, r#"{"empty":"", "zero":"0"}"#);
        let response = view
            .handle_form_key(form, &Context::default(), KeyCode::Enter)
            .unwrap();
        assert_eq!(
            response.request,
            json!({ "text":"0001", "secret":"hidden", "integer":0, "number":0.25, "boolean":false, "enum":"RAW", "nested":{"enabled":true}, "array":["", "0001"], "map":{"empty":"", "zero":"0"} })
        );
    }
    #[test]
    fn invalid_values_block_submission_and_recover_without_losing_edits() {
        let descriptor = descriptor(vec![field(
            "name",
            Kind::Text(TextInput {
                default_value: "x".into(),
                min_length: 2,
                ..Default::default()
            }),
        )]);
        let mut view = PanelView::new();
        draw(&mut view, &descriptor);
        assert!(view
            .handle_form_key(form(&descriptor), &Context::default(), KeyCode::Enter)
            .is_none());
        assert!(draw(&mut view, &descriptor).contains("invalid length"));
        view.handle_form_key(form(&descriptor), &Context::default(), KeyCode::Char('y'));
        assert_eq!(
            view.handle_form_key(form(&descriptor), &Context::default(), KeyCode::Enter)
                .unwrap()
                .request["name"],
            "xy"
        );
    }
    #[test]
    fn invalid_compound_edits_stay_open_and_replacement_discards_stale_state() {
        let original = descriptor(vec![field(
            "map",
            Kind::KeyValueMap(KeyValueMapField::default()),
        )]);
        let mut view = PanelView::new();
        draw(&mut view, &original);
        edit(&mut view, form(&original), r#"{"bad":false}"#);
        assert!(draw(&mut view, &original).contains("invalid map"));
        let replacement = descriptor(vec![field(
            "name",
            Kind::Text(TextInput {
                default_value: "replacement".into(),
                ..Default::default()
            }),
        )]);
        assert!(view
            .handle_form_key(form(&replacement), &Context::default(), KeyCode::Enter)
            .is_none());
        assert!(draw(&mut view, &replacement).contains("replacement"));
        assert_eq!(
            view.handle_form_key(form(&replacement), &Context::default(), KeyCode::Enter)
                .unwrap()
                .request,
            json!({"name":"replacement"})
        );
    }
    #[test]
    fn compound_editor_uses_the_same_core_constraints_as_submission() {
        let descriptor = descriptor(vec![field(
            "nested",
            Kind::Nested(NestedForm {
                fields: vec![
                    field(
                        "unicode",
                        Kind::Text(TextInput {
                            min_length: 2,
                            max_length: 2,
                            ..Default::default()
                        }),
                    ),
                    field(
                        "pattern",
                        Kind::Text(TextInput {
                            pattern: "ready".into(),
                            ..Default::default()
                        }),
                    ),
                ],
            }),
        )]);
        let mut view = PanelView::new();
        draw(&mut view, &descriptor);
        edit(
            &mut view,
            form(&descriptor),
            r#"{"unicode":"🦀","pattern":"already ready"}"#,
        );
        assert_eq!(
            view.handle_form_key(form(&descriptor), &Context::default(), KeyCode::Enter)
                .unwrap()
                .request,
            json!({"nested":{"unicode":"🦀","pattern":"already ready"}})
        );
    }
    #[test]
    fn readonly_fields_ignore_all_edit_and_submit_keys() {
        let mut descriptor = descriptor(vec![field(
            "name",
            Kind::Text(TextInput {
                default_value: "original".into(),
                ..Default::default()
            }),
        )]);
        if let Some(Body::Form(form)) = descriptor.body.as_mut() {
            form.mode = FormMode::Readonly as i32;
        }
        let mut view = PanelView::new();
        let before = draw(&mut view, &descriptor);
        for key in [
            KeyCode::Char('x'),
            KeyCode::Backspace,
            KeyCode::F(2),
            KeyCode::Enter,
        ] {
            assert!(view
                .handle_form_key(form(&descriptor), &Context::default(), key)
                .is_none());
        }
        assert_eq!(draw(&mut view, &descriptor), before);
    }
    #[test]
    fn empty_forms_submit_explicitly_without_navigation_panics() {
        let descriptor = descriptor(vec![]);
        let mut view = PanelView::new();
        draw(&mut view, &descriptor);
        for key in [
            KeyCode::Tab,
            KeyCode::Up,
            KeyCode::Down,
            KeyCode::BackTab,
            KeyCode::F(2),
        ] {
            assert!(view
                .handle_form_key(form(&descriptor), &Context::default(), key)
                .is_none());
        }
        assert_eq!(
            view.handle_form_key(form(&descriptor), &Context::default(), KeyCode::Enter)
                .unwrap()
                .request,
            json!({})
        );
    }
    #[test]
    fn lro_bounds_are_checked_before_emitting_start_requests() {
        let descriptor = PanelDescriptor {
            body: Some(Body::Lro(LroPanel {
                inputs: vec![field(
                    "count",
                    Kind::Integer(IntegerSpinner {
                        min: 1,
                        ..Default::default()
                    }),
                )],
                start: Some(RpcCall {
                    service: "fixture.Jobs".into(),
                    method: "Start".into(),
                    ..Default::default()
                }),
                ..Default::default()
            })),
            ..Default::default()
        };
        let Some(Body::Lro(panel)) = &descriptor.body else {
            panic!()
        };
        let mut view = PanelView::new();
        draw(&mut view, &descriptor);
        assert!(view
            .handle_lro_key(panel, &Context::default(), KeyCode::Enter)
            .is_none());
        assert!(draw(&mut view, &descriptor).contains("invalid number"));
        view.handle_lro_key(panel, &Context::default(), KeyCode::Right);
        assert_eq!(
            view.handle_lro_key(panel, &Context::default(), KeyCode::Enter)
                .unwrap()
                .request["count"],
            1
        );
    }
}

mod inline_prompts {
    use super::*;
    use crossterm::event::{KeyEvent, KeyModifiers};
    use meridian_tui::PanelPromptResponse;
    use meridian_uiview::proto::{
        repeated_field, LlmPromptPanel, MaskedInput, NestedForm, NumberInput, ParameterSlot,
        PromptPanel, RepeatedField,
    };
    use prost_types::{value::Kind as ValueKind, Struct};

    fn field(id: &str, kind: Kind) -> FormField {
        FormField {
            field_id: id.into(),
            label: id.into(),
            kind: Some(kind),
            ..Default::default()
        }
    }
    fn text(value: &str) -> Kind {
        Kind::Text(TextInput {
            default_value: value.into(),
            ..Default::default()
        })
    }
    fn prompt(fields: Vec<FormField>) -> PanelDescriptor {
        PanelDescriptor {
            panel_id: "inline".into(),
            title: "Inline prompt".into(),
            body: Some(Body::Prompt(PromptPanel {
                fields,
                ..Default::default()
            })),
            ..Default::default()
        }
    }
    fn key(
        view: &mut PanelView,
        descriptor: &PanelDescriptor,
        code: KeyCode,
    ) -> Option<PanelPromptResponse> {
        view.handle_prompt_key(descriptor, KeyEvent::new(code, KeyModifiers::NONE))
    }
    fn buffer(
        view: &mut PanelView,
        descriptor: &PanelDescriptor,
        width: u16,
        height: u16,
    ) -> String {
        struct NoCalls;
        impl RpcInvoker for NoCalls {
            fn invoke(
                &self,
                _: &str,
                _: &str,
                _: serde_json::Value,
            ) -> Result<serde_json::Value, RpcError> {
                panic!("local prompts must not execute RPCs")
            }
        }
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| {
                let area = frame.area();
                view.render(frame, area, descriptor, &Context::default(), &NoCalls);
            })
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    }
    fn value<'a>(values: &'a Struct, key: &str) -> &'a ValueKind {
        values.fields[key].kind.as_ref().unwrap()
    }

    #[test]
    fn focused_fields_remain_visible_in_short_viewports() {
        let fields = (0..20)
            .map(|index| {
                field(
                    &format!("Field{index:02}"),
                    text(&format!("Value{index:02}")),
                )
            })
            .collect();
        let descriptor = prompt(fields);
        let mut view = PanelView::new();
        for _ in 0..19 {
            key(&mut view, &descriptor, KeyCode::Tab);
        }
        let output = buffer(&mut view, &descriptor, 40, 12);
        assert!(output.contains("Field19"));
        assert!(output.contains("Value19"));
    }

    #[test]
    fn nested_masked_values_stay_concealed_while_protobuf_preserves_them() {
        let descriptor = prompt(vec![field(
            "credentials",
            Kind::Nested(NestedForm {
                fields: vec![field(
                    "token",
                    Kind::Masked(MaskedInput {
                        default_value: "nested-secret".into(),
                        ..Default::default()
                    }),
                )],
                ..Default::default()
            }),
        )]);
        let mut view = PanelView::new();
        let output = buffer(&mut view, &descriptor, 80, 24);
        assert!(!output.contains("nested-secret"));
        assert!(output.contains("******"));
        let Some(PanelPromptResponse::Submitted(values)) =
            key(&mut view, &descriptor, KeyCode::Enter)
        else {
            panic!("expected nested response")
        };
        assert!(
            matches!(value(&values,"credentials"),ValueKind::StructValue(credentials) if matches!(value(credentials,"token"),ValueKind::StringValue(value) if value == "nested-secret"))
        );
    }

    #[test]
    fn long_wrapped_llm_previews_can_page_to_schema_and_metadata() {
        let descriptor = PanelDescriptor {
            body: Some(Body::LlmPrompt(LlmPromptPanel {
                user_template: "long word ".repeat(200),
                output_json_schema: "SCHEMA-END".into(),
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut view = PanelView::new();
        for _ in 0..100 {
            key(&mut view, &descriptor, KeyCode::PageDown);
        }
        let output = buffer(&mut view, &descriptor, 40, 12);
        assert!(output.contains("SCHEMA-END"));
        for _ in 0..100 {
            key(&mut view, &descriptor, KeyCode::PageUp);
        }
        assert!(buffer(&mut view, &descriptor, 40, 12).contains("User prompt:"));
    }

    #[test]
    fn full_prompt_context_and_authored_labels_remain_accessible_without_submitting() {
        let mut descriptor = prompt(vec![field("text", text("value"))]);
        if let Some(Body::Prompt(panel)) = &mut descriptor.body {
            panel.description = format!("{}\nDESCRIPTION-END", "Context ".repeat(100));
            panel.detail = format!("{}\nDETAIL-END", "Diff ".repeat(100));
            panel.accept_label = "Apply".into();
            panel.cancel_label = "Dismiss".into();
        }
        let mut view = PanelView::new();
        let output = buffer(&mut view, &descriptor, 100, 24);
        assert!(output.contains("Apply [Enter]"));
        assert!(output.contains("Dismiss [Esc]"));
        key(&mut view, &descriptor, KeyCode::F(1));
        assert!(key(&mut view, &descriptor, KeyCode::Enter).is_none());
        for _ in 0..100 {
            key(&mut view, &descriptor, KeyCode::PageDown);
        }
        assert!(buffer(&mut view, &descriptor, 40, 12).contains("DETAIL-END"));
        key(&mut view, &descriptor, KeyCode::F(1));
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Enter),
            Some(PanelPromptResponse::Submitted(_))
        ));
        descriptor.body = Some(Body::Prompt(PromptPanel {
            is_confirmation: true,
            fields: vec![FormField::default()],
            ..Default::default()
        }));
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Enter),
            Some(PanelPromptResponse::Confirmed(false))
        ));
    }

    #[test]
    fn inline_prompt_dispatch_collects_all_field_kinds_as_wire_roundtrippable_protobuf() {
        let descriptor = prompt(vec![
            field("text", text("")),
            field("integer", Kind::Integer(IntegerSpinner::default())),
            field(
                "number",
                Kind::Number(NumberInput {
                    default_value: -1.5,
                    ..Default::default()
                }),
            ),
            field("boolean", Kind::Boolean(BooleanToggle::default())),
            field(
                "enum",
                Kind::EnumSelection(EnumSelection {
                    options: vec![EnumOption {
                        value: "stored".into(),
                        label: "Shown".into(),
                        ..Default::default()
                    }],
                    default_value: "stored".into(),
                    ..Default::default()
                }),
            ),
            field(
                "masked",
                Kind::Masked(MaskedInput {
                    default_value: "secret-value".into(),
                    ..Default::default()
                }),
            ),
            field(
                "nested",
                Kind::Nested(NestedForm {
                    fields: vec![field("label", text("Ada"))],
                    ..Default::default()
                }),
            ),
            field(
                "items",
                Kind::Repeated(Box::new(RepeatedField {
                    min_items: 1,
                    element: Some(repeated_field::Element::Scalar(Box::new(field(
                        "",
                        Kind::Number(NumberInput {
                            default_value: 1.5,
                            ..Default::default()
                        }),
                    )))),
                    ..Default::default()
                })),
            ),
            field(
                "rows",
                Kind::Repeated(Box::new(RepeatedField {
                    min_items: 1,
                    element: Some(repeated_field::Element::Object(NestedForm {
                        fields: vec![field("enabled", Kind::Boolean(BooleanToggle::default()))],
                        ..Default::default()
                    })),
                    ..Default::default()
                })),
            ),
            field("map", Kind::KeyValueMap(Default::default())),
        ]);
        let bytes = descriptor.encode_to_vec();
        let descriptor = PanelDescriptor::decode(bytes.as_slice()).unwrap();
        let mut view = PanelView::new();
        let output = buffer(&mut view, &descriptor, 80, 24);
        assert!(output.contains("Inline prompt"));
        assert!(!output.contains("standalone"));
        assert!(!output.contains("secret-value"));
        let Some(PanelPromptResponse::Submitted(values)) =
            key(&mut view, &descriptor, KeyCode::Enter)
        else {
            panic!("expected valid typed defaults")
        };
        let values = Struct::decode(values.encode_to_vec().as_slice()).unwrap();
        assert_eq!(values.fields.len(), 10);
        assert!(matches!(value(&values,"text"), ValueKind::StringValue(value) if value.is_empty()));
        assert!(matches!(
            value(&values, "integer"),
            ValueKind::NumberValue(0.0)
        ));
        assert!(matches!(
            value(&values, "number"),
            ValueKind::NumberValue(-1.5)
        ));
        assert!(matches!(
            value(&values, "boolean"),
            ValueKind::BoolValue(false)
        ));
        assert!(
            matches!(value(&values,"enum"), ValueKind::StringValue(value) if value == "stored")
        );
        assert!(
            matches!(value(&values,"masked"), ValueKind::StringValue(value) if value == "secret-value")
        );
        assert!(
            matches!(value(&values,"nested"), ValueKind::StructValue(nested) if matches!(value(nested,"label"), ValueKind::StringValue(value) if value == "Ada"))
        );
        assert!(
            matches!(value(&values,"items"), ValueKind::ListValue(items) if matches!(items.values[0].kind, Some(ValueKind::NumberValue(1.5))))
        );
        assert!(
            matches!(value(&values,"rows"), ValueKind::ListValue(items) if matches!(&items.values[0].kind, Some(ValueKind::StructValue(row)) if matches!(value(row,"enabled"), ValueKind::BoolValue(false))))
        );
        assert!(
            matches!(value(&values,"map"), ValueKind::StructValue(map) if map.fields.is_empty())
        );
        assert!(key(&mut view, &descriptor, KeyCode::Enter).is_none());
        assert!(key(&mut view, &descriptor, KeyCode::Esc).is_none());
        assert_eq!(descriptor.encode_to_vec(), bytes);
    }

    #[test]
    fn nested_json_edits_validate_recover_and_reject_inexact_integers() {
        let descriptor = prompt(vec![field(
            "nested",
            Kind::Nested(NestedForm {
                fields: vec![field("count", Kind::Integer(IntegerSpinner::default()))],
                ..Default::default()
            }),
        )]);
        let mut view = PanelView::new();
        buffer(&mut view, &descriptor, 80, 24);
        for raw in [
            "[]",
            "{\"count\":9007199254740992}",
            "{\"count\":1.5}",
            "{\"extra\":0}",
        ] {
            view.handle_prompt_key(
                &descriptor,
                KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
            );
            for ch in raw.chars() {
                key(&mut view, &descriptor, KeyCode::Char(ch));
            }
            assert!(key(&mut view, &descriptor, KeyCode::Enter).is_none());
            assert!(buffer(&mut view, &descriptor, 80, 24).contains('✗'));
        }
        view.handle_prompt_key(
            &descriptor,
            KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
        );
        for ch in "{\"count\":0}".chars() {
            key(&mut view, &descriptor, KeyCode::Char(ch));
        }
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Enter),
            Some(PanelPromptResponse::Submitted(_))
        ));
    }

    #[test]
    fn dispatch_preserves_edits_across_resize_resets_replaced_descriptors_and_separates_cancel_from_false(
    ) {
        let mut descriptor = prompt(vec![field("text", text("base"))]);
        let mut view = PanelView::new();
        key(&mut view, &descriptor, KeyCode::Char('🦀'));
        view.invalidate();
        assert!(buffer(&mut view, &descriptor, 40, 12).contains("base🦀"));
        if let Some(Body::Prompt(panel)) = &mut descriptor.body {
            panel.fields[0] = field("text", text("replacement"));
        }
        let Some(PanelPromptResponse::Submitted(values)) =
            key(&mut view, &descriptor, KeyCode::Enter)
        else {
            panic!("expected replacement response")
        };
        assert!(
            matches!(value(&values,"text"),ValueKind::StringValue(value) if value == "replacement")
        );
        descriptor.body = Some(Body::Prompt(PromptPanel {
            is_confirmation: true,
            detail: "Dangerous operation".into(),
            ..Default::default()
        }));
        assert!(buffer(&mut view, &descriptor, 80, 24).contains("Dangerous operation"));
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Enter),
            Some(PanelPromptResponse::Confirmed(false))
        ));
        descriptor.panel_id = "other".into();
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Esc),
            Some(PanelPromptResponse::Cancelled)
        ));
    }

    #[test]
    fn inline_llm_preview_is_local_literal_multiline_and_masked_in_the_display() {
        let descriptor = PanelDescriptor {
            panel_id: "llm".into(),
            body: Some(Body::LlmPrompt(LlmPromptPanel {
                system_template: "Use {{secret}}".into(),
                user_template: "{{document}} / {{missing}}".into(),
                slots: vec![
                    ParameterSlot {
                        name: "document".into(),
                        multi_line: true,
                        rows: 4,
                        field: Some(field("unrelated", text("{{secret}}\r\nlast"))),
                        ..Default::default()
                    },
                    ParameterSlot {
                        name: "secret".into(),
                        field: Some(field(
                            "also-unrelated",
                            Kind::Masked(MaskedInput {
                                default_value: "secret-value".into(),
                                ..Default::default()
                            }),
                        )),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut view = PanelView::new();
        let tall = buffer(&mut view, &descriptor, 100, 30);
        let mut short = descriptor.clone();
        if let Some(Body::LlmPrompt(panel)) = &mut short.body {
            panel.slots[0].rows = 1;
        }
        let compact = buffer(&mut PanelView::new(), &short, 100, 30);
        assert!(
            tall.find("also-unrelated").unwrap() / 100
                > compact.find("also-unrelated").unwrap() / 100
        );
        assert!(tall.matches("{{secret}}").count() > compact.matches("{{secret}}").count());
        view.handle_prompt_key(
            &descriptor,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT),
        );
        for ch in "next🦀".chars() {
            key(&mut view, &descriptor, KeyCode::Char(ch));
        }
        let Some(PanelPromptResponse::Preview {
            slots,
            rendered_system,
            rendered_user,
        }) = key(&mut view, &descriptor, KeyCode::Enter)
        else {
            panic!("expected preview")
        };
        assert_eq!(rendered_system, "Use secret-value");
        assert_eq!(rendered_user, "{{secret}}\r\nlast\nnext🦀 / {{missing}}");
        assert!(
            matches!(value(&slots,"document"),ValueKind::StringValue(value) if value == "{{secret}}\r\nlast\nnext🦀")
        );
        let output = buffer(&mut view, &descriptor, 100, 30);
        assert!(!output.contains("secret-value"));
        assert!(output.contains("Use ******"));
        assert!(output.contains("next🦀"));
        assert!(matches!(
            key(&mut view, &descriptor, KeyCode::Enter),
            Some(PanelPromptResponse::Preview { .. })
        ));
    }

    #[test]
    fn hostile_defaults_fail_but_empty_prompts_and_slotless_previews_collect_valid_values() {
        let duplicate = prompt(vec![field("same", text("one")), field("same", text("two"))]);
        let mut invalid = PanelView::new();
        assert!(buffer(&mut invalid, &duplicate, 100, 24).contains("duplicate field identifier"));
        assert!(key(&mut invalid, &duplicate, KeyCode::Enter).is_none());
        let bad_slot = PanelDescriptor {
            body: Some(Body::LlmPrompt(LlmPromptPanel {
                slots: vec![ParameterSlot::default()],
                ..Default::default()
            })),
            ..Default::default()
        };
        assert!(buffer(&mut invalid, &bad_slot, 100, 24).contains("nonempty and unique"));
        let descriptor = prompt(vec![field(
            "huge",
            Kind::Repeated(Box::new(RepeatedField {
                min_items: u32::MAX,
                element: Some(repeated_field::Element::Scalar(Box::new(field(
                    "",
                    text("default"),
                )))),
                ..Default::default()
            })),
        )]);
        let mut view = PanelView::new();
        assert!(buffer(&mut view, &descriptor, 100, 24).contains("1000 value nodes"));
        assert!(key(&mut view, &descriptor, KeyCode::Enter).is_none());
        let empty = prompt(vec![]);
        assert!(buffer(&mut view, &empty, 100, 24).contains("No fields declared"));
        assert!(
            matches!(key(&mut view,&empty,KeyCode::Enter),Some(PanelPromptResponse::Submitted(values)) if values.fields.is_empty())
        );
        assert!(buffer(&mut view, &empty, 100, 24).contains("Submitted."));
        let no_slots = PanelDescriptor {
            body: Some(Body::LlmPrompt(LlmPromptPanel {
                user_template: "Literal {{missing}}".into(),
                ..Default::default()
            })),
            ..Default::default()
        };
        assert!(buffer(&mut view, &no_slots, 80, 24).contains("Literal {{missing}}"));
        assert!(
            matches!(key(&mut view,&no_slots,KeyCode::Enter),Some(PanelPromptResponse::Preview { rendered_user, slots, ..}) if rendered_user == "Literal {{missing}}" && slots.fields.is_empty())
        );
    }
}

#[test]
fn selected_row_action_requests_use_wire_bindings_without_changing_raw_values() {
    use meridian_uiview::proto::{field_binding::Source, FieldBinding, NestedBinding};
    use serde_json::json;
    struct Rows;
    impl RpcInvoker for Rows {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            Ok(
                json!({"claims": [{"id": 0, "member": "Ada", "enabled": false,
                "amount": "0012.50", "metadata": {"count": 0}}, {"member": "Grace"}],
                "services": [{"id": 0, "member": "Ada", "enabled": false,
                "amount": "0012.50", "metadata": {"count": 0}}, {"member": "Grace"}]}),
            )
        }
    }
    let binding = |name: &str, source| FieldBinding {
        request_field: name.into(),
        source: Some(source),
    };
    let call = RpcCall {
        service: "demo.Actions".into(),
        method: "Run".into(),
        bindings: vec![
            binding("tenant", Source::Literal("demo".into())),
            binding("enabled", Source::RowField("enabled".into())),
            binding("amount", Source::RowField("amount".into())),
            binding("missing", Source::RowField("absent".into())),
            binding(
                "details",
                Source::Nested(NestedBinding {
                    fields: vec![
                        binding("count", Source::RowField("metadata.count".into())),
                        binding("scope", Source::SelectionKey("scope".into())),
                    ],
                }),
            ),
        ],
    };
    let bytes = call.encode_to_vec();
    let call = RpcCall::decode(bytes.as_slice()).unwrap();
    let mut context = Context {
        selected_row: Some(json!({"id": "stale"})),
        ..Default::default()
    };
    context.selections.insert("scope".into(), json!(false));
    for fixture in ["table.binpb", "resource_cards.binpb"] {
        let descriptor =
            PanelDescriptor::decode(read_canonical_fixture(fixture).as_slice()).unwrap();
        let mut view = PanelView::new();
        assert_eq!(view.selected_row_request(&call, &context, true), None);
        let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
        terminal
            .draw(|frame| view.render(frame, frame.area(), &descriptor, &context, &Rows))
            .unwrap();
        if view.selected_row().is_none() {
            view.select_next();
        }
        let before = view.selected_row().unwrap().clone();
        assert_eq!(
            view.selected_row_request(&call, &context, true),
            Some(json!({
                "tenant": "demo", "enabled": false, "amount": "0012.50", "details": {"count": 0, "scope": false}
            }))
        );
        let unbound = RpcCall {
            bindings: vec![],
            ..call.clone()
        };
        assert_eq!(
            view.selected_row_request(&unbound, &context, true),
            Some(json!({"id": 0}))
        );
        assert_eq!(
            view.selected_row_request(&unbound, &context, false),
            Some(json!({}))
        );
        assert_eq!(view.selected_row(), Some(&before));
        view.select_next();
        assert_eq!(
            view.selected_row_request(&unbound, &context, true),
            Some(json!({}))
        );
        assert_eq!(context.selected_row, Some(json!({"id": "stale"})));
        assert_eq!(call.encode_to_vec(), bytes);
    }
}

struct TableData;

impl RpcInvoker for TableData {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        assert_eq!((service, method), ("demo.Claims", "List"));
        Ok(serde_json::json!({"claims": [
            {"member": "Ada", "amount": "0012.50", "enabled": true, "website": "https://example.com/ada"},
            {"member": "Grace", "amount": "0007.00", "enabled": false, "website": "javascript:alert(1)"}
        ]}))
    }
}

impl RpcInvoker for GalleryData {
    fn invoke(
        &self,
        _service: &str,
        _method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "items": [
                {"name": "GitHub", "description": "Source control", "status": "Connected", "href": "https://github.com", "action": "Manage"},
                {"name": "PagerDuty", "description": "Incident response", "status": "Connected", "href": "https://pagerduty.com", "action": "Manage"}
            ]
        }))
    }
}

struct RecordData;

impl RpcInvoker for RecordData {
    fn invoke(
        &self,
        _service: &str,
        _method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "name": "Build 42",
            "owner": "Platform",
            "phase": "Running",
            "metadata": {"region": "us-east"}
        }))
    }
}

struct FormData;

impl RpcInvoker for FormData {
    fn invoke(
        &self,
        _service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        if method == "Prefill" {
            Ok(serde_json::json!({"name": "worker", "replicas": 2}))
        } else {
            Err(RpcError::UnknownMethod {
                service: "demo.Deploy".into(),
                method: method.into(),
            })
        }
    }
}

struct ResourceCardsData;

impl RpcInvoker for ResourceCardsData {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        assert_eq!((service, method), ("demo.Services", "List"));
        Ok(serde_json::json!({
            "services": [
                {"name": "GitHub", "description": "Source control"},
                {"name": "PagerDuty", "description": "Incident response"}
            ]
        }))
    }
}

struct ChartData;

impl RpcInvoker for ChartData {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        assert_eq!((service, method), ("demo.Requests", "List"));
        Ok(serde_json::json!({
            "points": [
                {"day": "Mon", "requests": 120},
                {"day": "Tue", "requests": 175}
            ]
        }))
    }
}

fn draw(descriptor: &PanelDescriptor, w: u16, h: u16) -> String {
    draw_with(descriptor, w, h, &Refuse)
}

fn draw_with<I: RpcInvoker>(descriptor: &PanelDescriptor, w: u16, h: u16, invoker: &I) -> String {
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
    term.draw(|f| view.render(f, f.area(), descriptor, &ctx, invoker))
        .unwrap();
    term.backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat()
}

fn populated_chart_descriptor() -> PanelDescriptor {
    let mut descriptor =
        PanelDescriptor::decode(read_canonical_fixture("chart.binpb").as_slice()).unwrap();
    let Some(Body::Chart(panel)) = descriptor.body.as_mut() else {
        panic!("expected chart fixture")
    };
    let chart = panel.chart.as_mut().expect("chart spec");
    chart.populate = Some(RpcCall {
        service: "demo.Requests".into(),
        method: "List".into(),
        ..Default::default()
    });
    chart.rows_field = "points".into();
    descriptor
}

const CANONICAL_FIXTURES: &[(&str, &str)] = &[
    ("table", "table.binpb"),
    ("lro", "lro.binpb"),
    ("adhoc", "adhoc.binpb"),
    ("prompt", "prompt.binpb"),
    ("llm_prompt", "llm_prompt.binpb"),
    ("gallery", "gallery.binpb"),
    ("form", "form.binpb"),
    ("detail_header", "detail_header.binpb"),
    ("record_card", "record_card.binpb"),
    ("resource_cards", "resource_cards.binpb"),
    ("chart", "chart.binpb"),
    ("steps", "steps.binpb"),
    ("media", "media.binpb"),
    ("stream", "stream.binpb"),
    ("choice", "choice.binpb"),
    ("snippet", "snippet.binpb"),
    ("action", "action.binpb"),
    ("connect_flow", "connect_flow.binpb"),
    ("copy_value", "copy_value.binpb"),
    ("catalog", "catalog.binpb"),
    ("stat", "stat.binpb"),
    ("terminal", "terminal.binpb"),
    ("grammar", "grammar.binpb"),
    ("(unset)", "empty.binpb"),
];

fn read_canonical_fixture(filename: &str) -> Vec<u8> {
    let mut candidates = vec![PathBuf::from("schemas/conformance/binpb").join(filename)];
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        candidates.push(
            PathBuf::from(manifest_dir)
                .join("../../../../schemas/conformance/binpb")
                .join(filename),
        );
    }
    candidates
        .into_iter()
        .find_map(|path| std::fs::read(&path).ok())
        .unwrap_or_else(|| {
            panic!(
                "canonical fixture {filename} is missing; run schemas/tools/write_conformance_binpb.mjs"
            )
        })
}

fn body_name(descriptor: &PanelDescriptor) -> &'static str {
    match descriptor.body.as_ref() {
        Some(Body::Table(_)) => "table",
        Some(Body::Lro(_)) => "lro",
        Some(Body::Adhoc(_)) => "adhoc",
        Some(Body::Prompt(_)) => "prompt",
        Some(Body::LlmPrompt(_)) => "llm_prompt",
        Some(Body::Gallery(_)) => "gallery",
        Some(Body::Form(_)) => "form",
        Some(Body::DetailHeader(_)) => "detail_header",
        Some(Body::RecordCard(_)) => "record_card",
        Some(Body::ResourceCards(_)) => "resource_cards",
        Some(Body::Chart(_)) => "chart",
        Some(Body::Steps(_)) => "steps",
        Some(Body::Media(_)) => "media",
        Some(Body::Stream(_)) => "stream",
        Some(Body::Choice(_)) => "choice",
        Some(Body::Snippet(_)) => "snippet",
        Some(Body::Action(_)) => "action",
        Some(Body::ConnectFlow(_)) => "connect_flow",
        Some(Body::CopyValue(_)) => "copy_value",
        Some(Body::Catalog(_)) => "catalog",
        Some(Body::Stat(_)) => "stat",
        Some(Body::Terminal(_)) => "terminal",
        Some(Body::Grammar(_)) => "grammar",
        None => "(unset)",
    }
}

fn stat_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "fleet-health".into(),
        title: "Fleet health".into(),
        body: Some(Body::Stat(StatPanel {
            label: "Nodes ready".into(),
            value: 118.0,
            previous: Some(124.0),
            higher_is_better: Some(true),
            caption: "vs. last sync".into(),
            series: vec![124.0, 123.0, 121.0, 118.0],
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn gallery_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "integrations".into(),
        title: "Integrations".into(),
        body: Some(Body::Gallery(GalleryPanel {
            populate: Some(RpcCall {
                service: "demo.Catalog".into(),
                method: "List".into(),
                ..Default::default()
            }),
            rows_field: "items".into(),
            card: Some(CardSpec {
                title_field: "name".into(),
                subtitle_field: "description".into(),
                status_field: "status".into(),
                href_field: "href".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn detail_header_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "build-header".into(),
        title: "Build".into(),
        body: Some(Body::DetailHeader(DetailHeaderPanel {
            title: "Build".into(),
            title_source_path: "name".into(),
            subtitle_source_path: "owner".into(),
            status_source_path: "phase".into(),
            descriptor_rows: vec![DescriptorRow {
                label: "Region".into(),
                source_path: "metadata.region".into(),
                ..Default::default()
            }],
            populate: Some(RpcCall {
                service: "demo.Builds".into(),
                method: "Get".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn record_card_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "build-card".into(),
        title: "Build details".into(),
        body: Some(Body::RecordCard(RecordCardPanel {
            item_noun: "build".into(),
            fields: vec![
                FormField {
                    field_id: "name".into(),
                    label: "Name".into(),
                    ..Default::default()
                },
                FormField {
                    field_id: "metadata.region".into(),
                    label: "Region".into(),
                    ..Default::default()
                },
            ],
            populate: Some(RpcCall {
                service: "demo.Builds".into(),
                method: "Get".into(),
                ..Default::default()
            }),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn form_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-form".into(),
        title: "Deployment".into(),
        body: Some(Body::Form(
            FormPanel {
                fields: vec![
                    FormField {
                        field_id: "name".into(),
                        label: "Name".into(),
                        request_field: "name".into(),
                        kind: Some(Kind::Text(TextInput {
                            default_value: "service".into(),
                            ..Default::default()
                        })),
                        ..Default::default()
                    },
                    FormField {
                        field_id: "replicas".into(),
                        label: "Replicas".into(),
                        request_field: "replicas".into(),
                        kind: Some(Kind::Integer(IntegerSpinner {
                            default_value: 1,
                            min: 1,
                            max: 10,
                            ..Default::default()
                        })),
                        ..Default::default()
                    },
                    FormField {
                        field_id: "enabled".into(),
                        label: "Enabled".into(),
                        request_field: "enabled".into(),
                        kind: Some(Kind::Boolean(BooleanToggle {
                            default_value: true,
                            ..Default::default()
                        })),
                        ..Default::default()
                    },
                    FormField {
                        field_id: "region".into(),
                        label: "Region".into(),
                        request_field: "region".into(),
                        kind: Some(Kind::EnumSelection(EnumSelection {
                            default_value: "east".into(),
                            options: vec![
                                EnumOption {
                                    value: "east".into(),
                                    label: "East".into(),
                                    ..Default::default()
                                },
                                EnumOption {
                                    value: "west".into(),
                                    label: "West".into(),
                                    ..Default::default()
                                },
                            ],
                            ..Default::default()
                        })),
                        ..Default::default()
                    },
                ],
                mode: FormMode::Edit as i32,
                submit: Some(RpcCall {
                    service: "demo.Deploy".into(),
                    method: "Apply".into(),
                    ..Default::default()
                }),
                item_noun: "deployment".into(),
                prefill: Some(RpcCall {
                    service: "demo.Deploy".into(),
                    method: "Prefill".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }
            .into(),
        )),
        ..Default::default()
    }
}

fn lro_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-run".into(),
        title: "Run deployment".into(),
        body: Some(Body::Lro(LroPanel {
            start: Some(RpcCall {
                service: "demo.Deploy".into(),
                method: "Start".into(),
                ..Default::default()
            }),
            metadata_type: "demo.DeployMetadata".into(),
            response_type: "demo.DeployResponse".into(),
            run_button_label: "Deploy".into(),
            inputs: vec![FormField {
                field_id: "replicas".into(),
                label: "Replicas".into(),
                request_field: "replicas".into(),
                kind: Some(Kind::Integer(IntegerSpinner {
                    default_value: 1,
                    min: 1,
                    max: 5,
                    ..Default::default()
                })),
                ..Default::default()
            }],
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn media_descriptor() -> PanelDescriptor {
    PanelDescriptor {
        panel_id: "deployment-recording".into(),
        title: "Deployment recording".into(),
        body: Some(Body::Media(MediaPanel {
            src_uri: "https://cdn.example.test/deploy.mp4".into(),
            alt: "A deployment progressing from build to ready.".into(),
            captions_uri: "https://cdn.example.test/deploy.vtt".into(),
            duration_ms: 125_000,
            caption: "Deployment walkthrough".into(),
            chapters: vec![MediaChapter {
                start_ms: 65_000,
                label: "Ready".into(),
            }],
            ..Default::default()
        })),
        ..Default::default()
    }
}

#[test]
fn wire_bytes_round_trip_into_drawn_cells() {
    // Encode and decode rather than rendering the struct directly: the binary is
    // handed BYTES, and a field that fails to survive the wire would otherwise
    // pass here and produce an empty panel in the real thing.
    let bytes = stat_descriptor().encode_to_vec();
    let decoded = PanelDescriptor::decode(bytes.as_slice()).expect("descriptor round-trips");
    assert_eq!(decoded, stat_descriptor());

    let out = draw(&decoded, 48, 8);
    assert!(
        out.contains("Fleet health"),
        "title missing from the drawn buffer:\n{out}"
    );
    assert!(out.contains("Nodes ready"), "stat label missing:\n{out}");
    assert!(out.contains("118"), "stat value missing:\n{out}");
}

#[test]
fn canonical_binpb_corpus_reaches_every_tui_dispatch_arm() {
    // These are the exact bytes emitted from schemas/conformance/fixtures.ts,
    // not Rust-authored equivalents. Decoding and drawing every one proves the
    // native renderer consumes the shared protobuf corpus and preserves its
    // documented placeholder/degradation cases.
    for (expected, filename) in CANONICAL_FIXTURES {
        let bytes = read_canonical_fixture(filename);
        let descriptor = PanelDescriptor::decode(bytes.as_slice())
            .unwrap_or_else(|error| panic!("{filename} is not a PanelDescriptor: {error}"));
        assert_eq!(
            body_name(&descriptor),
            *expected,
            "fixture {filename} decoded to the wrong body arm"
        );

        let output = draw(&descriptor, 96, 12);
        assert!(
            output.contains(&descriptor.title),
            "{filename} did not render its title {:?}:\n{output}",
            descriptor.title
        );
        if *expected == "(unset)" {
            assert!(
                output.contains("Unsupported or unset panel shape"),
                "empty/unknown body lost its visible degradation"
            );
        } else {
            assert!(
                !output.contains("(no body set)"),
                "{filename} fell through to the empty-body degradation"
            );
        }
    }
}

#[test]
fn unknown_future_oneof_arm_degrades_to_visible_fallback() {
    // Field 100 is deliberately outside the current PanelDescriptor body
    // range. prost preserves the known descriptor fields and drops the unknown
    // oneof value, as it must for forward compatibility.
    let mut bytes = PanelDescriptor {
        panel_id: "future-panel".into(),
        title: "Future panel".into(),
        body: None,
    }
    .encode_to_vec();
    bytes.extend_from_slice(&[0xa2, 0x06, 0x00]); // field 100, length-delimited, empty message
    let descriptor = PanelDescriptor::decode(bytes.as_slice()).unwrap();
    assert!(descriptor.body.is_none());

    let output = draw(&descriptor, 64, 8);
    assert!(output.contains("Future panel"), "title missing:\n{output}");
    assert!(
        output.contains("Unsupported or unset"),
        "unknown future arm was not visibly degraded:\n{output}"
    );
}

#[test]
fn canonical_long_copy_value_preserves_text_at_sufficient_width() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("copy_value.binpb").as_slice()).unwrap();
    let Some(Body::CopyValue(panel)) = &descriptor.body else {
        panic!("expected copy value")
    };
    let value = panel.value.as_ref().unwrap();
    assert!(value.value.len() > 160);
    let output = draw(&descriptor, 512, 16);
    assert!(output.contains(&descriptor.title));
    assert!(output.contains(&value.label));
    assert!(output.contains(&value.value));
    // Narrow terminals may clip or wrap. Their viewport must remain renderable;
    // full content preservation is asserted above, not inferred from clipping.
    assert!(!draw(&descriptor, 32, 8).is_empty());
}

#[test]
fn canonical_resource_cards_fixture_renders_populated_rows() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("resource_cards.binpb").as_slice())
            .expect("resource-card fixture decodes");
    let output = draw_with(&descriptor, 72, 16, &ResourceCardsData);
    assert!(output.contains("GitHub"));
    assert!(output.contains("Source control"));
    assert!(output.contains("PagerDuty"));
    assert!(output.contains("Incident response"));
    assert!(!output.contains("Failed to load resources"));
}

#[test]
fn canonical_gallery_fixture_renders_populated_rows() {
    let descriptor = PanelDescriptor::decode(read_canonical_fixture("gallery.binpb").as_slice())
        .expect("gallery fixture decodes");
    let output = draw_with(&descriptor, 72, 16, &GalleryData);
    assert!(output.contains("GitHub"));
    assert!(output.contains("Source control"));
    assert!(output.contains("PagerDuty"));
    assert!(output.contains("Incident response"));
    assert!(!output.contains("Failed to load gallery"));
}

#[test]
fn canonical_table_fixture_renders_populated_rows() {
    let descriptor = PanelDescriptor::decode(read_canonical_fixture("table.binpb").as_slice())
        .expect("table fixture decodes");
    let output = draw_with(&descriptor, 160, 20, &TableData);
    for text in ["Ada", "Grace", "0012.50", "0007.00", "Yes", "No"] {
        assert!(output.contains(text), "missing {text}: {output}");
    }
    assert!(!output.contains("no claims"));
}

#[test]
fn canonical_chart_fixture_renders_populated_rows() {
    let descriptor = populated_chart_descriptor();
    let output = draw_with(&descriptor, 160, 20, &ChartData);
    for text in [
        "Requests by day",
        "day  |  requests",
        "Mon  |  120",
        "Tue  |  175",
    ] {
        assert!(output.contains(text), "missing {text}: {output}");
    }
    assert!(!output.contains("invoker-aware"));
}

// Preserve row boundaries while discarding terminal padding. These text goldens
// cover content and ordering, not colors or interactive navigation.
fn terminal_lines(output: &str, width: usize) -> Vec<String> {
    output
        .chars()
        .collect::<Vec<_>>()
        .chunks(width)
        .map(|row| {
            row.iter()
                .collect::<String>()
                .trim_matches('│')
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|row| !row.starts_with(['┌', '└']))
        .filter(|row| !row.is_empty())
        .collect()
}

#[test]
fn canonical_populated_native_text_goldens() {
    for name in ["gallery", "table", "resource_cards", "steps", "chart"] {
        let descriptor = if name == "chart" {
            populated_chart_descriptor()
        } else {
            PanelDescriptor::decode(read_canonical_fixture(&format!("{name}.binpb")).as_slice())
                .unwrap()
        };
        let output = if name == "gallery" {
            draw_with(&descriptor, 160, 20, &GalleryData)
        } else if name == "resource_cards" {
            draw_with(&descriptor, 160, 20, &ResourceCardsData)
        } else if name == "chart" {
            draw_with(&descriptor, 160, 20, &ChartData)
        } else if name == "steps" {
            draw(&descriptor, 160, 20)
        } else {
            draw_with(&descriptor, 160, 20, &TableData)
        };
        let expected = if name == "gallery" {
            vec![
                "Assets",
                "▶ 1. GitHub [Connected] │ │ 2. PagerDuty [Connected]",
                "Source control │ │ Incident response",
                "[1] Manage https://github.com │ │ [2] Manage https://pagerduty.com",
            ]
        } else if name == "resource_cards" {
            vec![
                "Services",
                "▶ 1. GitHub",
                "Source control",
                "2. PagerDuty",
                "Incident response",
            ]
        } else if name == "steps" {
            vec![
                "Create a sponsor",
                "Add an employer and confirm a colleague can see it.",
                "1. Open the Sponsors page [Admin]",
                "The list of every employer your organization administers.",
                "The sponsors list",
                "↵ ↗ Open Sponsors /sponsors — Continue in the sponsor list",
                "2. Add a new sponsor [Admin]",
                "Name it, then set Status to Active and Kind to Customer.",
                "3. Confirm a colleague sees it [Manager]",
                "Everyone in your organization shares one sponsor list.",
                "The sponsor is now visible to your whole team.",
            ]
        } else if name == "table" {
            // URLs remain noninteractive scalar text in the native table.
            vec![
                "Claims",
                "2",
                "Member Amount Enabled Website",
                "Ada 0012.50 Yes https://example.com/ada",
                "Grace 0007.00 No javascript:alert(1)",
            ]
        } else {
            vec![
                "Requests",
                "Requests by day",
                "requests by day",
                "day | requests",
                "Mon | 120",
                "Tue | 175",
            ]
        };
        assert_eq!(terminal_lines(&output, 160), expected, "{name}");
    }
}

#[test]
fn canonical_chart_transport_failure_text_golden() {
    let descriptor = populated_chart_descriptor();
    assert_eq!(
        terminal_lines(&draw(&descriptor, 160, 20), 160),
        vec![
            "Requests",
            "Requests by day",
            "requests by day",
            "Failed to load chart: transport: demo.Requests/List: no transport",
        ]
    );
}

#[test]
fn canonical_stream_snapshot_retention_is_bounded() {
    let mut descriptor =
        PanelDescriptor::decode(read_canonical_fixture("stream.binpb").as_slice()).unwrap();
    // Retaining a tail must drop older entries from the front. Re-encode the
    // edited canonical descriptor so the assertion covers the wire value that a
    // producer authors, not only a Rust field assignment.
    let Some(Body::Stream(panel)) = descriptor.body.as_mut() else {
        panic!("expected stream fixture")
    };
    panel.max_lines = 3;
    let mut descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let Some(Body::Stream(panel)) = descriptor.body.as_ref() else {
        unreachable!()
    };
    let mut view = PanelView::new();
    view.set_stream_lines(
        panel,
        (0..5).map(|index| format!("explicit-{index}")).collect(),
    );
    let mut terminal = Terminal::new(TestBackend::new(80, 8)).unwrap();
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    let output: String = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        !output.contains("explicit-1"),
        "old stream line was retained: {output}"
    );
    assert!(
        output.contains("explicit-2"),
        "tail start missing: {output}"
    );
    assert!(
        output.contains("explicit-4"),
        "newest stream line missing: {output}"
    );

    // Zero means a renderer-owned default, not unlimited retention. Feed one
    // more line than the shared native/browser default and prove the oldest one
    // is gone while the first retained line is visible at the top of the pane.
    let Some(Body::Stream(panel)) = descriptor.body.as_mut() else {
        unreachable!()
    };
    panel.max_lines = 0;
    let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let Some(Body::Stream(panel)) = descriptor.body.as_ref() else {
        unreachable!()
    };
    let mut view = PanelView::new();
    view.set_stream_lines(
        panel,
        (0..=2_000)
            .map(|index| format!("default-{index:04}"))
            .collect(),
    );
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    let output: String = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        !output.contains("default-0000"),
        "default retention is unbounded: {output}"
    );
    assert!(
        output.contains("default-1997"),
        "default tail start missing: {output}"
    );
}

#[test]
fn stream_view_detaches_from_follow_when_reader_scrolls_up() {
    use meridian_tui::{StreamError, StreamInvoker, StreamSession};
    use meridian_uiview::proto::StreamFrame;
    use std::sync::mpsc;

    struct LiveStream(std::sync::Mutex<Option<mpsc::Receiver<StreamFrame>>>);
    impl StreamInvoker for LiveStream {
        fn subscribe(
            &self,
            _: &meridian_uiview::proto::RpcCall,
            _: serde_json::Value,
        ) -> Result<StreamSession, StreamError> {
            let receiver = self.0.lock().unwrap().take().unwrap();
            Ok(StreamSession::new(receiver, || {}))
        }
    }
    let frame = |text: String| {
        meridian_uiview::stream_frame_from_json(serde_json::json!({
            "event": { "message": text }
        }))
    };
    let (sender, receiver) = mpsc::channel();
    for index in 0..8 {
        sender.send(frame(format!("line-{index}"))).unwrap();
    }
    let stream = LiveStream(std::sync::Mutex::new(Some(receiver)));
    let mut descriptor =
        PanelDescriptor::decode(read_canonical_fixture("stream.binpb").as_slice()).unwrap();
    if let Some(Body::Stream(panel)) = descriptor.body.as_mut() {
        panel.line_field = "event.message".into();
    }
    let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let mut view = PanelView::new();
    view.poll_stream(&descriptor, &Context::default(), &stream);
    assert_eq!(view.stream_lines().len(), 8);
    assert!(view.stream_is_following());

    let mut terminal = Terminal::new(TestBackend::new(80, 8)).unwrap();
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    view.scroll_stream(-2);
    assert!(
        !view.stream_is_following(),
        "scrolling up must detach follow mode"
    );

    sender.send(frame("line-8".into())).unwrap();
    view.poll_stream(&descriptor, &Context::default(), &stream);
    assert!(
        !view.stream_is_following(),
        "new frames must not yank a reader back to the tail"
    );
    assert_eq!(
        view.stream_lines().last().map(String::as_str),
        Some("line-8")
    );
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    let output: String = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        output.contains("line-2"),
        "reader's prior viewport should remain visible: {output}"
    );
    assert!(
        output.contains("line-5"),
        "viewport should remain anchored: {output}"
    );
    assert!(
        !output.contains("line-8"),
        "new tail should remain outside detached viewport: {output}"
    );
}

#[test]
fn stream_view_applies_descriptor_payload_limits_before_rendering() {
    use meridian_tui::{StreamError, StreamInvoker, StreamSession};
    use meridian_uiview::proto::StreamFrame;
    use std::sync::mpsc;

    struct LiveStream(std::sync::Mutex<Option<mpsc::Receiver<StreamFrame>>>);
    impl StreamInvoker for LiveStream {
        fn subscribe(
            &self,
            _: &meridian_uiview::proto::RpcCall,
            _: serde_json::Value,
        ) -> Result<StreamSession, StreamError> {
            Ok(StreamSession::new(
                self.0.lock().unwrap().take().unwrap(),
                || {},
            ))
        }
    }

    let (sender, receiver) = mpsc::channel();
    sender
        .send(meridian_uiview::stream_frame_from_json(serde_json::json!({
            "event": { "message": "must not render" }
        })))
        .unwrap();
    let stream = LiveStream(std::sync::Mutex::new(Some(receiver)));
    let mut descriptor =
        PanelDescriptor::decode(read_canonical_fixture("stream.binpb").as_slice()).unwrap();
    if let Some(Body::Stream(panel)) = descriptor.body.as_mut() {
        panel.line_field = "event.message".into();
        panel.max_bytes = 1;
        panel.max_rate = 1;
    }
    let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let mut view = PanelView::new();
    view.poll_stream(&descriptor, &Context::default(), &stream);

    assert!(
        view.stream_lines().is_empty(),
        "descriptor byte limit must reject the frame before rendering"
    );
}

#[test]
fn stream_manual_mode_starts_at_top_and_does_not_auto_scroll() {
    use meridian_tui::{StreamError, StreamInvoker, StreamSession};
    use meridian_uiview::proto::StreamFrame;
    use std::sync::mpsc;

    struct LiveStream(std::sync::Mutex<Option<mpsc::Receiver<StreamFrame>>>);
    impl StreamInvoker for LiveStream {
        fn subscribe(
            &self,
            _: &meridian_uiview::proto::RpcCall,
            _: serde_json::Value,
        ) -> Result<StreamSession, StreamError> {
            Ok(StreamSession::new(
                self.0.lock().unwrap().take().unwrap(),
                || {},
            ))
        }
    }
    let frame = |text: String| {
        meridian_uiview::stream_frame_from_json(serde_json::json!({
            "event": { "message": text }
        }))
    };
    let (sender, receiver) = mpsc::channel();
    for index in 0..8 {
        sender.send(frame(format!("manual-{index}"))).unwrap();
    }
    let stream = LiveStream(std::sync::Mutex::new(Some(receiver)));
    let mut descriptor =
        PanelDescriptor::decode(read_canonical_fixture("stream.binpb").as_slice()).unwrap();
    if let Some(Body::Stream(panel)) = descriptor.body.as_mut() {
        panel.line_field = "event.message".into();
        panel.follow_mode = meridian_uiview::proto::FollowMode::Manual as i32;
    }
    let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let mut view = PanelView::new();
    view.poll_stream(&descriptor, &Context::default(), &stream);
    assert!(!view.stream_is_following());
    let mut terminal = Terminal::new(TestBackend::new(80, 8)).unwrap();
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();

    sender.send(frame("manual-8".into())).unwrap();
    view.poll_stream(&descriptor, &Context::default(), &stream);
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    let output: String = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        output.contains("manual-0"),
        "manual mode must retain its starting position: {output}"
    );
    assert!(
        !output.contains("manual-8"),
        "manual mode must not auto-follow: {output}"
    );
}

struct EmptyData;
impl RpcInvoker for EmptyData {
    fn invoke(
        &self,
        _: &str,
        _: &str,
        _: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Ok(serde_json::json!({
            "items": [], "claims": [], "services": [], "points": []
        }))
    }
}

#[test]
fn canonical_native_empty_and_absent_populate_states() {
    for name in ["gallery", "table", "resource_cards", "chart"] {
        let mut descriptor = if name == "chart" {
            populated_chart_descriptor()
        } else {
            PanelDescriptor::decode(read_canonical_fixture(&format!("{name}.binpb")).as_slice())
                .unwrap()
        };
        let empty = if name == "gallery" {
            vec!["Assets", "no assets"]
        } else if name == "resource_cards" {
            vec!["Services", "No services"]
        } else if name == "chart" {
            vec![
                "Requests",
                "Requests by day",
                "requests by day",
                "No chart data.",
            ]
        } else {
            vec!["Claims", "0", "Member Amount Enabled Website"]
        };
        assert_eq!(
            terminal_lines(&draw_with(&descriptor, 160, 20, &EmptyData), 160),
            empty,
            "{name} empty"
        );
        match descriptor.body.as_mut().unwrap() {
            Body::Gallery(panel) => panel.populate = None,
            Body::Table(panel) => panel.populate = None,
            Body::ResourceCards(panel) => panel.populate = None,
            Body::Chart(panel) => panel.chart.as_mut().unwrap().populate = None,
            _ => unreachable!(),
        }
        let absent = if name == "gallery" {
            vec!["Assets", "Gallery panel has no populate RPC."]
        } else if name == "resource_cards" {
            vec!["Services", "Resource-card panel has no populate RPC."]
        } else if name == "chart" {
            vec![
                "Requests",
                "Requests by day",
                "requests by day",
                "Chart data is available to an invoker-aware host.",
            ]
        } else {
            vec!["Claims", "0", "Member Amount Enabled Website"]
        };
        assert_eq!(
            terminal_lines(&draw(&descriptor, 160, 20), 160),
            absent,
            "{name} absent"
        );
    }
}

#[test]
fn canonical_resource_cards_transport_failure_text_golden() {
    let descriptor =
        PanelDescriptor::decode(read_canonical_fixture("resource_cards.binpb").as_slice())
            .expect("resource-card fixture decodes");
    assert_eq!(
        terminal_lines(&draw(&descriptor, 160, 20), 160),
        vec![
            "Services",
            "Failed to load resources: transport: demo.Services/List: no transport",
        ]
    );
}

#[test]
fn a_declining_stat_marked_higher_is_better_reads_as_bad() {
    // 118 against a previous 124 with higher_is_better: the delta must render,
    // and render as a DECREASE. This is the one piece of semantics a terminal can
    // get wrong silently — a sign flip still draws a plausible-looking panel.
    let out = draw(&stat_descriptor(), 48, 8);
    assert!(
        out.contains('↓') || out.contains('-') || out.contains('▾'),
        "no decrease marker for 124 -> 118:\n{out}"
    );
}

#[test]
fn gallery_populate_flows_into_the_tui_card_grid() {
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(64, 10)).unwrap();
    term.draw(|f| view.render(f, f.area(), &gallery_descriptor(), &ctx, &GalleryData))
        .unwrap();
    let out = term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(out.contains("GitHub"), "gallery title missing:\n{out}");
    assert!(out.contains("Connected"), "gallery status missing:\n{out}");
    assert!(
        out.contains("https://github.com"),
        "gallery href missing:\n{out}"
    );
}

#[test]
fn pixel_metrics_degrade_without_changing_terminal_content_or_styles() {
    use meridian_tui::{Mode, Theme};
    use theme_proto::meridian::theme::v1::Metrics;
    for width in [64, 100] {
        let draw = |theme: Theme| {
            let decoded = Theme::decode(theme.encode_to_vec().as_slice()).unwrap();
            let mut view = PanelView::with_palette(Palette::from_theme(&decoded, Mode::Light));
            let mut terminal = Terminal::new(TestBackend::new(width, 10)).unwrap();
            terminal
                .draw(|frame| {
                    view.render(
                        frame,
                        frame.area(),
                        &gallery_descriptor(),
                        &Context::default(),
                        &GalleryData,
                    )
                })
                .unwrap();
            terminal.backend().buffer().clone()
        };
        let baseline = draw(Theme::default());
        let text = baseline
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<Vec<_>>()
            .concat();
        assert!(
            text.contains("GitHub"),
            "baseline must render actual content"
        );
        for density in [0.5, 2.0] {
            assert_eq!(
                draw(Theme {
                    metrics: Some(Metrics {
                        radius_px: 64,
                        unit_px: 64,
                        spacing_scale_px: vec![0, 32, 64, 1024],
                        density_scale: Some(density),
                        stroke_px: Some(0),
                    }),
                    ..Default::default()
                }),
                baseline,
                "pixel metrics must preserve every terminal cell/style"
            );
        }
    }
}

#[test]
fn declared_record_links_survive_wire_decode_and_render_as_noninteractive_metadata() {
    use meridian_uiview::proto::{
        value_display::Options, PrincipalOptions, TableColumn, TablePanel, ValueDisplay, ValueLink,
        ValueType,
    };
    use std::cell::Cell;
    struct Data(Cell<usize>);
    impl RpcInvoker for Data {
        fn invoke(
            &self,
            _: &str,
            _: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            self.0.set(self.0.get() + 1);
            let record = serde_json::json!({"owner": "Name <name@example.com>"});
            Ok(serde_json::json!({"owner": record["owner"], "items": [record]}))
        }
    }
    for (link, linked) in [
        (None, true),
        (
            Some(ValueLink {
                target_kind: "identity.user".into(),
            }),
            true,
        ),
        (Some(ValueLink::default()), false),
    ] {
        let display = ValueDisplay {
            r#type: ValueType::Principal as i32,
            options: Some(Options::Principal(PrincipalOptions {
                target_kind: "identity.user".into(),
                link_to_record: true,
                ..Default::default()
            })),
            link,
        };
        let populate = Some(RpcCall {
            service: "demo.Users".into(),
            method: "Get".into(),
            ..Default::default()
        });
        let bodies = [
            Body::DetailHeader(DetailHeaderPanel {
                populate: populate.clone(),
                descriptor_rows: vec![DescriptorRow {
                    label: "Owner".into(),
                    source_path: "owner".into(),
                    display: Some(display.clone()),
                }],
                ..Default::default()
            }),
            Body::RecordCard(RecordCardPanel {
                populate: populate.clone(),
                fields: vec![FormField {
                    field_id: "owner".into(),
                    label: "Owner".into(),
                    display: Some(display.clone()),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            Body::Table(TablePanel {
                populate,
                rows_field: "items".into(),
                columns: vec![TableColumn {
                    header: "Owner".into(),
                    field_path: "owner".into(),
                    value_display: Some(display),
                    ..Default::default()
                }],
                ..Default::default()
            }),
        ];
        for body in bodies {
            let descriptor = PanelDescriptor {
                panel_id: "linked".into(),
                body: Some(body),
                ..Default::default()
            };
            let decoded = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
            let data = Data(Cell::new(0));
            let mut view = PanelView::default();
            let mut terminal = Terminal::new(TestBackend::new(110, 12)).unwrap();
            terminal
                .draw(|f| view.render(f, f.area(), &decoded, &Context::default(), &data))
                .unwrap();
            let text = terminal
                .backend()
                .buffer()
                .content()
                .iter()
                .map(|c| c.symbol())
                .collect::<String>();
            assert!(text.contains("Name"), "{text}");
            assert_eq!(text.contains("[record:"), linked, "{text}");
            if linked {
                assert!(
                    text.contains("[record: \"identity.user\" id=\"Name <name@example.com>\"]"),
                    "{text}"
                );
            }
            assert_eq!(data.0.get(), 1, "link decoration must not invoke an RPC");
        }
    }
}

#[test]
fn detail_panels_populate_and_render_the_record_dispatch_path() {
    let ctx = Context::default();
    let mut header = PanelView::with_palette(Palette::default());
    let mut header_term = Terminal::new(TestBackend::new(64, 9)).unwrap();
    header_term
        .draw(|f| header.render(f, f.area(), &detail_header_descriptor(), &ctx, &RecordData))
        .unwrap();
    let header_out = header_term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(header_out.contains("Build 42"));
    assert!(header_out.contains("[Running]"));
    assert!(header_out.contains("Region: us-east"));

    let mut card = PanelView::with_palette(Palette::default());
    let mut card_term = Terminal::new(TestBackend::new(64, 8)).unwrap();
    card_term
        .draw(|f| card.render(f, f.area(), &record_card_descriptor(), &ctx, &RecordData))
        .unwrap();
    let card_out = card_term
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|c| c.symbol())
        .collect::<Vec<_>>()
        .concat();
    assert!(card_out.contains("Name: Build 42"));
    assert!(card_out.contains("Region: us-east"));
}

#[test]
fn form_display_wire_text_goldens_preserve_editable_values() {
    use meridian_uiview::proto::{EnumOption, EnumSelection, ValueDisplay, ValueTone, ValueType};
    use serde_json::json;

    let text_field = |id: &str, value: &str, display: Option<ValueDisplay>| FormField {
        field_id: id.into(),
        label: id.into(),
        request_field: id.into(),
        kind: Some(Kind::Text(TextInput {
            default_value: value.into(),
            ..Default::default()
        })),
        display,
        ..Default::default()
    };
    let date = ValueDisplay {
        r#type: ValueType::Date as i32,
        ..Default::default()
    };
    for mode in [FormMode::Readonly, FormMode::Edit] {
        let descriptor = PanelDescriptor {
            panel_id: "form-display-evidence".into(),
            body: Some(Body::Form(
                FormPanel {
                    mode: mode as i32,
                    item_noun: "record".into(),
                    fields: vec![
                        text_field("Due", "2026-03-29", Some(date.clone())),
                        text_field("Legacy", "2026-03-29", None),
                        text_field("Unspecified", "2026-03-29", Some(ValueDisplay::default())),
                        text_field("Invalid", "not-a-date", Some(date.clone())),
                        text_field(
                            "Unknown",
                            "0012.50",
                            Some(ValueDisplay {
                                r#type: 9999,
                                ..Default::default()
                            }),
                        ),
                        FormField {
                            field_id: "State".into(),
                            label: "State".into(),
                            request_field: "State".into(),
                            kind: Some(Kind::EnumSelection(EnumSelection {
                                default_value: "approved".into(),
                                allowed_values: vec!["ignored".into()],
                                options: vec![
                                    EnumOption {
                                        value: "approved".into(),
                                        label: "Approved".into(),
                                        tone: ValueTone::Success as i32,
                                    },
                                    EnumOption {
                                        value: "needs_review".into(),
                                        label: "Needs review".into(),
                                        tone: ValueTone::Danger as i32,
                                    },
                                    EnumOption {
                                        value: "other".into(),
                                        tone: 9999,
                                        ..Default::default()
                                    },
                                ],
                                ..Default::default()
                            })),
                            ..Default::default()
                        },
                    ],
                    submit: Some(RpcCall {
                        service: "demo.Records".into(),
                        method: "Save".into(),
                        ..Default::default()
                    }),
                    ..Default::default()
                }
                .into(),
            )),
            ..Default::default()
        };
        let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
        let Some(Body::Form(form)) = descriptor.body.as_ref() else {
            unreachable!()
        };
        let palette = Palette::default();
        let mut view = PanelView::with_palette(palette);
        let ctx = Context::default();
        let mut terminal = Terminal::new(TestBackend::new(100, 16)).unwrap();
        let render = |view: &mut PanelView, terminal: &mut Terminal<TestBackend>| {
            terminal
                .draw(|f| view.render(f, f.area(), &descriptor, &ctx, &Refuse))
                .unwrap();
            let output: String = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|c| c.symbol())
                .collect();
            terminal_lines(&output, 100)
        };
        let mut expected = vec![
            if mode == FormMode::Edit {
                "Edit record"
            } else {
                "Read-only record"
            }
            .to_string(),
            if mode == FormMode::Edit {
                "↑/↓ select · ←/→ numeric · F2 JSON · Enter submit"
            } else {
                "read-only form"
            }
            .to_string(),
            "▶ Due: Mar 29, 2026".into(),
            "Legacy: 2026-03-29".into(),
            "Unspecified: Mar 29, 2026".into(),
            "Invalid: not-a-date".into(),
            "Unknown: 0012.50".into(),
            "State: Approved".into(),
        ];
        assert_eq!(render(&mut view, &mut terminal), expected);
        // Inspect palette roles separately: normalized text cannot establish tone.
        let label_color = |terminal: &Terminal<TestBackend>, label: &str| {
            let buffer = terminal.backend().buffer();
            let offset = buffer
                .content
                .windows(label.chars().count())
                .position(|cells| cells.iter().map(|c| c.symbol()).collect::<String>() == label)
                .expect("enum label must be rendered");
            buffer.content[offset].fg
        };
        assert_eq!(label_color(&terminal, "Approved"), palette.success);
        if mode != FormMode::Edit {
            assert!(view.handle_form_key(form, &ctx, KeyCode::Enter).is_none());
            continue;
        }
        let mut raw = json!({"Due":"2026-03-29", "Legacy":"2026-03-29",
            "Unspecified":"2026-03-29", "Invalid":"not-a-date", "Unknown":"0012.50", "State":"approved"});
        let submission = view.handle_form_key(form, &ctx, KeyCode::Enter).unwrap();
        assert_eq!(
            (submission.service.as_str(), submission.method.as_str()),
            ("demo.Records", "Save")
        );
        assert_eq!(submission.request, raw);

        // Editing acts on the date token, not its displayed label.
        view.handle_form_key(form, &ctx, KeyCode::Backspace);
        view.handle_form_key(form, &ctx, KeyCode::Char('8'));
        raw["Due"] = json!("2026-03-28");
        expected[2] = "▶ Due: Mar 28, 2026".into();
        assert_eq!(render(&mut view, &mut terminal), expected);
        for _ in 0..5 {
            view.handle_form_key(form, &ctx, KeyCode::Down);
        }
        expected[2] = "Due: Mar 28, 2026".into();
        for (token, label, color) in [
            ("needs_review", "Needs review", palette.danger),
            ("other", "other", palette.code_fg),
        ] {
            view.handle_form_key(form, &ctx, KeyCode::Right);
            expected[7] = format!("▶ State: {label}");
            assert_eq!(render(&mut view, &mut terminal), expected);
            assert_eq!(label_color(&terminal, label), color);
            raw["State"] = json!(token);
            assert_eq!(
                view.handle_form_key(form, &ctx, KeyCode::Enter)
                    .unwrap()
                    .request,
                raw
            );
        }
    }
}

#[test]
fn native_enum_labels_use_every_semantic_theme_color_after_wire_decode() {
    use meridian_uiview::proto::ValueTone;
    use ratatui::style::{Color, Modifier};
    let cases = [
        (ValueTone::Neutral, "Neutral", 1),
        (ValueTone::Info, "Info", 2),
        (ValueTone::Success, "Success", 3),
        (ValueTone::Warning, "Warning", 4),
        (ValueTone::Danger, "Danger", 5),
        (ValueTone::Accent, "Accent", 6),
    ];
    let descriptor = PanelDescriptor {
        body: Some(Body::Form(
            FormPanel {
                mode: FormMode::Readonly as i32,
                fields: cases
                    .iter()
                    .map(|(tone, name, _)| FormField {
                        field_id: name.to_string(),
                        label: name.to_string(),
                        kind: Some(Kind::EnumSelection(EnumSelection {
                            default_value: "raw".into(),
                            options: vec![EnumOption {
                                value: "raw".into(),
                                label: format!("{name} value"),
                                tone: *tone as i32,
                            }],
                            ..Default::default()
                        })),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            }
            .into(),
        )),
        ..Default::default()
    };
    let descriptor = PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
    let mut proto = meridian_tui::Theme::default().light.unwrap_or_default();
    proto.fg = "#010101".into();
    proto.info = "#020202".into();
    proto.success = "#030303".into();
    proto.warning = "#040404".into();
    proto.danger = "#050505".into();
    proto.accent = "#060606".into();
    let palette = Palette::from_proto_palette(&proto);
    let mut view = PanelView::with_palette(palette);
    let mut terminal = Terminal::new(TestBackend::new(80, 20)).unwrap();
    terminal
        .draw(|frame| {
            view.render(
                frame,
                frame.area(),
                &descriptor,
                &Context::default(),
                &Refuse,
            )
        })
        .unwrap();
    let buffer = terminal.backend().buffer();
    for (_, name, channel) in cases {
        let label = format!("{name} value");
        let cells = buffer
            .content
            .windows(label.len())
            .find(|cells| cells.iter().map(|cell| cell.symbol()).collect::<String>() == label)
            .expect("declared enum label must be visible");
        for cell in cells {
            assert_eq!(cell.fg, Color::Rgb(channel, channel, channel), "{name}");
            assert!(
                !cell.modifier.contains(Modifier::BOLD),
                "tone must not invent emphasis: {name}"
            );
        }
    }
}

#[test]
fn form_prefill_renders_and_submit_contains_edited_values() {
    let descriptor = form_descriptor();
    let form = match descriptor.body.as_ref() {
        Some(Body::Form(form)) => form,
        _ => panic!("expected form descriptor"),
    };
    let ctx = Context::default();
    let mut view = PanelView::with_palette(Palette::default());
    let mut term = Terminal::new(TestBackend::new(64, 12)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &FormData))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(
        output.contains("Edit deployment"),
        "form mode missing:\n{output}"
    );
    assert!(
        output.contains("Name: worker"),
        "prefill missing:\n{output}"
    );
    assert!(
        output.contains("Replicas: 2"),
        "integer prefill missing:\n{output}"
    );
    assert!(
        output.contains("Enabled: true"),
        "boolean control missing:\n{output}"
    );
    assert!(
        output.contains("Region: East"),
        "enum selection missing:\n{output}"
    );

    view.handle_form_key(form, &ctx, KeyCode::Char('x'));
    view.handle_form_key(form, &ctx, KeyCode::Down);
    view.handle_form_key(form, &ctx, KeyCode::Down);
    view.handle_form_key(form, &ctx, KeyCode::Char(' '));
    view.handle_form_key(form, &ctx, KeyCode::Down);
    view.handle_form_key(form, &ctx, KeyCode::Right);
    let submission = view
        .handle_form_key(form, &ctx, KeyCode::Enter)
        .expect("editable form should submit");
    assert_eq!(submission.service, "demo.Deploy");
    assert_eq!(submission.method, "Apply");
    assert_eq!(submission.request["name"], "workerx");
    assert_eq!(submission.request["replicas"], 2);
    assert_eq!(submission.request["enabled"], false);
    assert_eq!(submission.request["region"], "west");
}

#[test]
fn lro_renders_inputs_and_emits_start_request() {
    let descriptor = lro_descriptor();
    let panel = match descriptor.body.as_ref() {
        Some(Body::Lro(panel)) => panel,
        _ => panic!("expected lro descriptor"),
    };
    let ctx = Context::default();
    let mut view = PanelView::with_palette(Palette::default());
    let mut term = Terminal::new(TestBackend::new(64, 10)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &Refuse))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(output.contains("Deploy"), "run label missing:\n{output}");
    assert!(
        output.contains("Replicas: 1"),
        "input default missing:\n{output}"
    );

    view.handle_lro_key(panel, &ctx, KeyCode::Up);
    let submission = view
        .handle_lro_key(panel, &ctx, KeyCode::Enter)
        .expect("LRO with a start RPC should emit a request");
    assert_eq!(submission.service, "demo.Deploy");
    assert_eq!(submission.method, "Start");
    assert_eq!(submission.request["replicas"], 1);
}

#[test]
fn media_uses_the_terminal_accessible_degradation() {
    let descriptor = media_descriptor();
    let mut view = PanelView::with_palette(Palette::default());
    let ctx = Context::default();
    let mut term = Terminal::new(TestBackend::new(80, 12)).unwrap();
    term.draw(|f| view.render(f, f.area(), &descriptor, &ctx, &Refuse))
        .unwrap();
    let output: String = term
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    assert!(output.contains("A deployment progressing from build to ready."));
    assert!(output.contains("02:05"));
    assert!(output.contains("deploy.vtt"));
    assert!(output.contains("Chapter: 01:05 — Ready"));
    assert!(output.contains("deploy.mp4"));
}

mod lro_progress {
    use super::*;
    use meridian_uiview::proto::{
        field_binding::Source, ContextSource, FieldBinding, TableColumn, TablePanel, ValueDisplay,
        ValueType,
    };
    use prost_types::{value::Kind as JsonKind, ListValue, Struct, Value};

    struct NoCalls;
    impl RpcInvoker for NoCalls {
        fn invoke(
            &self,
            service: &str,
            method: &str,
            _: serde_json::Value,
        ) -> Result<serde_json::Value, RpcError> {
            panic!("LRO rendering must not execute {service}/{method}")
        }
    }

    fn wire_object(json: serde_json::Value) -> Struct {
        fn value(json: serde_json::Value) -> Value {
            Value {
                kind: Some(match json {
                    serde_json::Value::Null => JsonKind::NullValue(0),
                    serde_json::Value::Bool(v) => JsonKind::BoolValue(v),
                    serde_json::Value::Number(v) => JsonKind::NumberValue(v.as_f64().unwrap()),
                    serde_json::Value::String(v) => JsonKind::StringValue(v),
                    serde_json::Value::Array(v) => JsonKind::ListValue(ListValue {
                        values: v.into_iter().map(value).collect(),
                    }),
                    serde_json::Value::Object(v) => JsonKind::StructValue(Struct {
                        fields: v.into_iter().map(|(k, v)| (k, value(v))).collect(),
                    }),
                }),
            }
        }
        let Some(JsonKind::StructValue(source)) = value(json).kind else {
            panic!("object required")
        };
        Struct::decode(source.encode_to_vec().as_slice()).unwrap()
    }

    fn descriptor() -> PanelDescriptor {
        let mut descriptor = lro_descriptor();
        let Some(Body::Lro(panel)) = &mut descriptor.body else {
            unreachable!()
        };
        panel.finalize = Some(RpcCall {
            service: "Forbidden".into(),
            method: "Finalize".into(),
            ..Default::default()
        });
        panel.result = Some(TablePanel {
            populate: Some(RpcCall {
                service: "Forbidden".into(),
                method: "Populate".into(),
                ..Default::default()
            }),
            rows_field: "rows".into(),
            item_noun: "flags".into(),
            columns: vec![TableColumn {
                header: "Enabled".into(),
                field_path: "value".into(),
                value_display: Some(ValueDisplay {
                    r#type: ValueType::Boolean as i32,
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        });
        PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap()
    }

    fn panel(descriptor: &PanelDescriptor) -> &LroPanel {
        let Some(Body::Lro(panel)) = &descriptor.body else {
            unreachable!()
        };
        panel
    }

    fn draw(
        view: &mut PanelView,
        descriptor: &PanelDescriptor,
        context: &Context,
        width: u16,
    ) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, 16)).unwrap();
        terminal
            .draw(|frame| view.render(frame, frame.area(), descriptor, context, &NoCalls))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    #[test]
    fn protobuf_progress_and_finalized_results_render_without_transport_calls() {
        let descriptor = descriptor();
        let context = Context::default();
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let run = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Submitting"));
        let metadata =
            wire_object(serde_json::json!({"state":"RUNNING", "status_message":"2 of 4 complete"}));
        assert!(view.update_lro_progress(&run.run_id, "operations/deploy-1", &metadata));
        let text = draw(&mut view, &descriptor, &context, 80);
        assert!(text.contains("Running: operations/deploy-1"));
        assert!(text.contains("[RUNNING] 2 of 4 complete"));
        assert!(view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .is_none());
        assert!(view.complete_lro(
            &run.run_id,
            &wire_object(serde_json::json!({"rows":[{"value":false},{"value":true}]}))
        ));
        let text = draw(&mut view, &descriptor, &context, 80);
        for expected in ["Completed", "2 flags", "Enabled", "No", "Yes"] {
            assert!(text.contains(expected), "{expected} missing: {text}");
        }
        assert_eq!(view.selected_row().unwrap()["value"], false);
        view.select_next();
        assert_eq!(view.selected_row().unwrap()["value"], true);
        assert!(!view.complete_lro(&run.run_id, &Struct::default()));
        assert!(!view.fail_lro(&run.run_id, "late error"));
    }

    #[test]
    fn failures_retry_cancellation_and_cross_view_tokens_are_isolated() {
        let descriptor = descriptor();
        let context = Context::default();
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let first = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(view.fail_lro(&first.run_id, "poll failed"));
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Failed: poll failed"));
        let second = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert_ne!(first.run_id, second.run_id);
        assert!(!view.complete_lro(&first.run_id, &Struct::default()));
        assert!(view.update_lro_progress(&second.run_id, "operations/new", &Struct::default()));
        assert!(!view.update_lro_progress(&second.run_id, "operations/wrong", &Struct::default()));
        let mut other = PanelView::new();
        let other_run = other
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(!view.fail_lro(&other_run.run_id, "wrong view"));
        assert!(view.cancel_lro(&second.run_id));
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Canceled"));
        assert!(!view.update_lro_progress(&second.run_id, "operations/new", &Struct::default()));
        view.handle_lro_key(panel(&descriptor), &context, KeyCode::Esc);
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Replicas: 1"));
    }

    #[test]
    fn resize_preserves_progress_but_replacement_and_invalidation_reject_callbacks() {
        let mut descriptor = descriptor();
        let context = Context::default();
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let first = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(view.update_lro_progress(&first.run_id, "operations/one", &Struct::default()));
        assert!(draw(&mut view, &descriptor, &context, 40).contains("operations/one"));
        descriptor.panel_id = "replacement-same-body".into();
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Replicas: 1"));
        assert!(!view.fail_lro(&first.run_id, "stale"));
        let second = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        view.invalidate();
        assert!(!view.complete_lro(&second.run_id, &Struct::default()));
        draw(&mut view, &descriptor, &context, 80);
        let third = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        draw(&mut view, &PanelDescriptor::default(), &context, 80);
        assert!(!view.cancel_lro(&third.run_id));
    }

    #[test]
    fn changed_request_context_drops_the_previous_operation() {
        let mut descriptor = descriptor();
        let Some(Body::Lro(lro)) = &mut descriptor.body else {
            unreachable!()
        };
        lro.start.as_mut().unwrap().bindings.push(FieldBinding {
            request_field: "resource".into(),
            source: Some(Source::Context(ContextSource::CurrentResourcePath as i32)),
            ..Default::default()
        });
        lro.start.as_mut().unwrap().bindings.push(FieldBinding {
            request_field: "replicas".into(),
            source: Some(Source::FormField("replicas".into())),
            ..Default::default()
        });
        let mut context = Context {
            current_resource_path: Some("resource/one".into()),
            ..Default::default()
        };
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let run = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert_eq!(run.request["resource"], "resource/one");
        assert_eq!(run.request["replicas"], 1);
        // This input is owned by the LRO form, not the host context map.
        context
            .form_values
            .insert("replicas".into(), serde_json::json!(777));
        draw(&mut view, &descriptor, &context, 80);
        assert!(
            view.update_lro_progress(&run.run_id, "operations/current", &Struct::default()),
            "host form values must not invalidate an internally owned form input"
        );
        context.current_resource_path = Some("resource/two".into());
        draw(&mut view, &descriptor, &context, 80);
        assert!(!view.fail_lro(&run.run_id, "old resource"));
    }

    #[test]
    fn malformed_and_over_budget_protobuf_updates_leave_the_previous_state_intact() {
        let descriptor = descriptor();
        let context = Context::default();
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let run = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(view.update_lro_progress(
            &run.run_id,
            "operations/valid",
            &wire_object(serde_json::json!({"status_message":"Last good state"}))
        ));
        let mut invalid = Struct {
            fields: [(
                "bad".into(),
                Value {
                    kind: Some(JsonKind::NumberValue(f64::NAN)),
                },
            )]
            .into(),
        };
        assert!(!view.update_lro_progress(&run.run_id, "operations/valid", &invalid));
        assert!(!view.complete_lro(&run.run_id, &invalid));
        invalid = wire_object(serde_json::json!({"large":"x".repeat(1024*1024+1)}));
        assert!(!view.update_lro_progress(&run.run_id, "operations/valid", &invalid));
        let mut nested = Value {
            kind: Some(JsonKind::NullValue(0)),
        };
        for _ in 0..70 {
            nested = Value {
                kind: Some(JsonKind::ListValue(ListValue {
                    values: vec![nested],
                })),
            };
        }
        invalid = Struct {
            fields: [("deep".into(), nested)].into(),
        };
        assert!(!view.update_lro_progress(&run.run_id, "operations/valid", &invalid));
        invalid = wire_object(serde_json::json!({"many":vec![false;10_001]}));
        assert!(!view.update_lro_progress(&run.run_id, "operations/valid", &invalid));
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Last good state"));
        assert!(view.complete_lro(&run.run_id, &Struct::default()));
    }

    #[test]
    fn amplified_lro_result_is_rejected_without_replacing_last_good_progress() {
        let mut descriptor = descriptor();
        if let Some(Body::Lro(panel)) = descriptor.body.as_mut() {
            let table = panel.result.as_mut().unwrap();
            table.columns = vec![table.columns[0].clone(); 8];
        }
        let context = Context::default();
        let mut view = PanelView::new();
        draw(&mut view, &descriptor, &context, 80);
        let run = view
            .handle_lro_key(panel(&descriptor), &context, KeyCode::Enter)
            .unwrap();
        assert!(view.update_lro_progress(
            &run.run_id,
            "operations/valid",
            &wire_object(serde_json::json!({"status_message":"Last good state"}))
        ));
        let before = draw(&mut view, &descriptor, &context, 80);
        let result = wire_object(serde_json::json!({"rows":[{"value":"x".repeat(400_000)}]}));
        assert!(!view.complete_lro(&run.run_id, &result));
        assert_eq!(draw(&mut view, &descriptor, &context, 80), before);
        assert!(view.fail_lro(&run.run_id, "Result rejected by host"));
        assert!(draw(&mut view, &descriptor, &context, 80).contains("Result rejected by host"));
    }
}

#[test]
fn an_empty_descriptor_draws_rather_than_panicking() {
    // main.rs will happily decode a zero-byte file into a default
    // PanelDescriptor — an empty message is valid protobuf. It must not panic on
    // the way to telling the user there is nothing here.
    let out = draw(&PanelDescriptor::default(), 32, 4);
    assert!(!out.trim().is_empty() || out.len() == 32 * 4);
}
#[cfg(test)]
mod ambient_records {
    use meridian_tui::crossterm::event::KeyCode;
    use meridian_tui::{PanelView, RpcError, RpcInvoker};
    use meridian_uiview::{
        proto::{
            field_binding::Source, form_field::Kind, panel_descriptor::Body, BooleanToggle,
            DetailHeaderPanel, FieldBinding, FormField, FormPanel, IntegerSpinner, PanelDescriptor,
            RecordCardPanel, RpcCall, TableColumn, TablePanel, TextInput,
        },
        Context,
    };
    use prost::Message;
    use ratatui::{backend::TestBackend, Terminal};
    use serde_json::{json, Value};
    use std::{cell::RefCell, sync::Arc};

    #[derive(Default)]
    struct Host {
        calls: RefCell<Vec<(String, String, Value)>>,
    }
    impl RpcInvoker for Host {
        fn invoke(&self, service: &str, method: &str, request: Value) -> Result<Value, RpcError> {
            self.calls
                .borrow_mut()
                .push((service.into(), method.into(), request));
            Ok(json!({"title": "Fetched record"}))
        }
    }
    fn row(title: &str) -> Arc<Value> {
        Arc::new(
            json!({"id": "first", "title": title, "count": 0, "enabled": false, "members": [{"name": "Child record"}]}),
        )
    }
    fn fields() -> Vec<FormField> {
        vec![
            FormField {
                field_id: "title".into(),
                label: "Title".into(),
                kind: Some(Kind::Text(TextInput {
                    default_value: "default".into(),
                    ..Default::default()
                })),
                ..Default::default()
            },
            FormField {
                field_id: "count".into(),
                label: "Count".into(),
                kind: Some(Kind::Integer(IntegerSpinner {
                    default_value: 7,
                    ..Default::default()
                })),
                ..Default::default()
            },
            FormField {
                field_id: "enabled".into(),
                label: "Enabled".into(),
                kind: Some(Kind::Boolean(BooleanToggle {
                    default_value: true,
                })),
                ..Default::default()
            },
        ]
    }
    fn call() -> RpcCall {
        RpcCall {
            service: "fixture.Records".into(),
            method: "Save".into(),
            bindings: vec![FieldBinding {
                request_field: "recordId".into(),
                source: Some(Source::RowField("id".into())),
            }],
        }
    }
    fn form() -> PanelDescriptor {
        PanelDescriptor {
            body: Some(Body::Form(
                FormPanel {
                    fields: fields(),
                    mode: 2,
                    submit: Some(call()),
                    ..Default::default()
                }
                .into(),
            )),
            ..Default::default()
        }
    }
    fn draw(view: &mut PanelView, descriptor: &PanelDescriptor, host: &Host) -> String {
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
        terminal
            .draw(|frame| view.render(frame, frame.area(), descriptor, &Context::default(), host))
            .unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    #[test]
    fn wire_decoded_no_populate_panels_use_the_ambient_record_without_rpc() {
        let descriptors = [
            PanelDescriptor {
                body: Some(Body::DetailHeader(DetailHeaderPanel {
                    title_source_path: "title".into(),
                    ..Default::default()
                })),
                ..Default::default()
            },
            PanelDescriptor {
                body: Some(Body::RecordCard(RecordCardPanel {
                    fields: fields(),
                    ..Default::default()
                })),
                ..Default::default()
            },
            form(),
            PanelDescriptor {
                body: Some(Body::Table(TablePanel {
                    rows_field: "members".into(),
                    columns: vec![TableColumn {
                        header: "Member".into(),
                        field_path: "name".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                })),
                ..Default::default()
            },
        ];
        let host = Host::default();
        for descriptor in descriptors {
            let descriptor =
                PanelDescriptor::decode(descriptor.encode_to_vec().as_slice()).unwrap();
            let table = matches!(&descriptor.body, Some(Body::Table(_)));
            let mut view = PanelView::new();
            view.set_record(Some(row("001.20"))).unwrap();
            let text = draw(&mut view, &descriptor, &host);
            assert!(
                text.contains(if table { "Child record" } else { "001.20" }),
                "{text}"
            );
        }
        assert!(host.calls.borrow().is_empty());
    }

    #[test]
    fn form_submissions_borrow_the_record_and_preserve_raw_values_and_edits() {
        let descriptor = form();
        let Some(Body::Form(panel)) = &descriptor.body else {
            panic!()
        };
        let host = Host::default();
        let record = row("001.20");
        let mut view = PanelView::new();
        view.set_record(Some(record.clone())).unwrap();
        draw(&mut view, &descriptor, &host);
        view.handle_form_key(panel, &Context::default(), KeyCode::Char('x'));
        view.set_record(Some(record.clone())).unwrap();
        draw(&mut view, &descriptor, &host);
        let submitted = view
            .handle_form_key(panel, &Context::default(), KeyCode::Enter)
            .unwrap();
        assert_eq!(
            submitted.request,
            json!({"recordId": "first", "title": "001.20x", "count": 0, "enabled": false})
        );
        assert_eq!(record["title"], "001.20");
        view.set_record(Some(row("Second"))).unwrap();
        assert!(draw(&mut view, &descriptor, &host).contains("Second"));
        assert_eq!(
            view.handle_form_key(panel, &Context::default(), KeyCode::Enter)
                .unwrap()
                .request["title"],
            "Second"
        );
        view.set_record(None).unwrap();
        assert!(draw(&mut view, &descriptor, &host).contains("default"));
        assert!(host.calls.borrow().is_empty());
    }

    #[test]
    fn explicit_populate_wins_and_uses_the_bounded_ambient_row_binding() {
        let mut populate = call();
        populate.method = "Get".into();
        let descriptor = PanelDescriptor {
            body: Some(Body::DetailHeader(DetailHeaderPanel {
                title_source_path: "title".into(),
                populate: Some(populate),
                ..Default::default()
            })),
            ..Default::default()
        };
        let host = Host::default();
        let mut view = PanelView::new();
        view.set_record(Some(row("Ambient placeholder"))).unwrap();
        assert!(draw(&mut view, &descriptor, &host).contains("Fetched record"));
        assert_eq!(
            &*host.calls.borrow(),
            &[(
                "fixture.Records".into(),
                "Get".into(),
                json!({"recordId": "first"})
            )]
        );
    }

    #[test]
    fn invalid_ambient_records_are_rejected_before_replacing_the_previous_row() {
        let host = Host::default();
        let mut view = PanelView::new();
        let descriptor = form();
        view.set_record(Some(row("Original"))).unwrap();
        for value in [
            json!([1]),
            json!("not an object"),
            json!({"huge": "x".repeat(5 * 1024 * 1024)}),
        ] {
            assert!(view.set_record(Some(Arc::new(value))).is_err());
            assert!(draw(&mut view, &descriptor, &host).contains("Original"));
        }
        assert!(host.calls.borrow().is_empty());
    }

    #[test]
    fn replacing_ambient_records_closes_the_old_stream_and_invalidates_lro_tokens() {
        use meridian_tui::{StreamError, StreamInvoker, StreamSession};
        use meridian_uiview::proto::{LroPanel, StreamFrame, StreamPanel};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc,
        };
        struct Streams {
            closed: Arc<AtomicUsize>,
            requests: RefCell<Vec<Value>>,
            senders: RefCell<Vec<mpsc::Sender<StreamFrame>>>,
        }
        impl StreamInvoker for Streams {
            fn subscribe(
                &self,
                _call: &RpcCall,
                request: Value,
            ) -> Result<StreamSession, StreamError> {
                self.requests.borrow_mut().push(request);
                let (tx, rx) = mpsc::channel();
                self.senders.borrow_mut().push(tx);
                let closed = self.closed.clone();
                Ok(StreamSession::new(rx, move || {
                    closed.fetch_add(1, Ordering::SeqCst);
                }))
            }
        }
        let host = Host::default();
        let streams = Streams {
            closed: Arc::new(AtomicUsize::new(0)),
            requests: RefCell::new(vec![]),
            senders: RefCell::new(vec![]),
        };
        let descriptor = PanelDescriptor {
            body: Some(Body::Stream(StreamPanel {
                subscribe: Some(call()),
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut view = PanelView::new();
        view.set_record(Some(row("First"))).unwrap();
        view.poll_stream(&descriptor, &Context::default(), &streams);
        assert_eq!(streams.requests.borrow()[0], json!({"recordId": "first"}));
        assert_eq!(streams.closed.load(Ordering::SeqCst), 0);
        view.set_record(Some(Arc::new(json!({"id": "second", "title": "Second"}))))
            .unwrap();
        assert_eq!(streams.closed.load(Ordering::SeqCst), 1);
        view.poll_stream(&descriptor, &Context::default(), &streams);
        assert_eq!(streams.requests.borrow()[1], json!({"recordId": "second"}));
        assert_eq!(streams.closed.load(Ordering::SeqCst), 1);
        let descriptor = PanelDescriptor {
            body: Some(Body::Lro(LroPanel {
                start: Some(call()),
                ..Default::default()
            })),
            ..Default::default()
        };
        draw(&mut view, &descriptor, &host);
        let Some(Body::Lro(panel)) = &descriptor.body else {
            panic!()
        };
        let submission = view
            .handle_lro_key(panel, &Context::default(), KeyCode::Enter)
            .unwrap();
        assert_eq!(submission.request, json!({"recordId": "second"}));
        view.set_record(None).unwrap();
        assert_eq!(streams.closed.load(Ordering::SeqCst), 2);
        assert!(!view.complete_lro(&submission.run_id, &Default::default()));
        assert!(host.calls.borrow().is_empty());
    }
}
