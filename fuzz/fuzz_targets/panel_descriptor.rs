#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::{
    prost::Message,
    proto::{
        panel_descriptor::Body, ComputedStat, FormattedValue, GalleryPanel, PanelDescriptor,
        RpcCall, TablePanel, ValueDisplay, ViewDescriptor,
    },
    render_gallery_bounded as render_gallery, render_table_bounded as render_table, Context,
    RequestBuilder, SubmissionKind,
};

fuzz_target!(|bytes: &[u8]| {
    // Exercise the real native ABI with valid borrowed buffers, not forged
    // foreign pointers. Keep errors/ownership observable to the sanitizer.
    for (declaration, value) in [(bytes, &[][..]), (&[][..], bytes)] {
        let mut output = std::ptr::null_mut();
        let mut length = 0;
        // SAFETY: inputs are live slices and outputs are separate stack slots.
        let status = unsafe {
            meridian_uiview::native_api::meridian_core_format_value(
                declaration.as_ptr(),
                declaration.len(),
                value.as_ptr(),
                value.len(),
                1,
                1_774_742_400_000.0,
                &mut output,
                &mut length,
            )
        };
        if status == 0 {
            assert!(!output.is_null());
            assert!(length <= 4 * 1024 * 1024);
            // SAFETY: a successful ABI call owns exactly this output region.
            let result = unsafe { std::slice::from_raw_parts(output, length) };
            assert!(FormattedValue::decode(result).is_ok());
            // SAFETY: return the exact pointer/length once to its allocator.
            unsafe {
                meridian_uiview::native_api::meridian_core_buffer_free(output, length);
            }
        } else {
            assert!((1..=3).contains(&status), "unexpected formatter status");
            assert!(output.is_null());
            assert_eq!(length, 0);
        }
    }
    for (panel, response, has_response) in [(bytes, &[][..], 0), (&[][..], bytes, 1)] {
        let mut output = std::ptr::null_mut();
        let mut length = 0;
        // SAFETY: live borrowed slices, separate writable output slots.
        let status = unsafe {
            meridian_uiview::native_api::meridian_core_compute_stat(
                panel.as_ptr(),
                panel.len(),
                has_response,
                response.as_ptr(),
                response.len(),
                &mut output,
                &mut length,
            )
        };
        if status == 0 {
            assert!(!output.is_null());
            assert!(length <= 4 * 1024 * 1024);
            // SAFETY: successful ABI output remains live until its exact free.
            assert!(
                ComputedStat::decode(unsafe { std::slice::from_raw_parts(output, length) }).is_ok()
            );
            unsafe {
                meridian_uiview::native_api::meridian_core_buffer_free(output, length);
            }
        } else {
            assert!((1..=3).contains(&status), "unexpected stat status");
            assert!(output.is_null());
            assert_eq!(length, 0);
        }
    }
    for (call, context) in [(bytes, &[][..]), (&[][..], bytes)] {
        let mut output = std::ptr::null_mut();
        let mut length = 0;
        // SAFETY: borrowed live slices and nonoverlapping stack output slots.
        let status = unsafe {
            meridian_uiview::native_api::meridian_core_build_request(
                call.as_ptr(),
                call.len(),
                context.as_ptr(),
                context.len(),
                &mut output,
                &mut length,
            )
        };
        if status == 0 {
            assert!(!output.is_null());
            assert!(length > 0 && length <= 4 * 1024 * 1024);
            // SAFETY: free exactly the successful owned result, once.
            unsafe {
                meridian_uiview::native_api::meridian_core_buffer_free(output, length);
            }
        } else {
            assert!((1..=3).contains(&status), "unexpected request status");
            assert!(output.is_null());
            assert_eq!(length, 0);
        }
    }
    let valid_filter = meridian_uiview::proto::RowFilter {
        field_path: "value".into(),
        equals: "true".into(),
    }
    .encode_to_vec();
    for (filter, row) in [(bytes, &[][..]), (valid_filter.as_slice(), bytes)] {
        let mut matched = 99;
        // SAFETY: live borrowed protobuf slices and a separate writable byte.
        let status = unsafe {
            meridian_uiview::native_api::meridian_core_matches_row_filter(
                filter.as_ptr(),
                filter.len(),
                row.as_ptr(),
                row.len(),
                &mut matched,
            )
        };
        if status == 0 {
            assert!(matched <= 1);
        } else {
            assert!((1..=3).contains(&status), "unexpected predicate status");
            assert_eq!(matched, 0);
        }
    }
    let mut matched = 99;
    // SAFETY: live slice regions, separate writable output byte.
    let status = unsafe {
        meridian_uiview::native_api::meridian_core_matches_form_pattern(
            bytes.as_ptr(),
            bytes.len(),
            bytes.as_ptr(),
            bytes.len(),
            &mut matched,
        )
    };
    if status == 0 {
        assert!(matched <= 1);
    } else {
        assert!((2..=4).contains(&status), "unexpected regex status");
        assert_eq!(matched, 0);
    }
    let response =
        serde_json::json!({"rows": [{"value": "2026-03-29", "name": "Ada", "count": 1}]});
    if let Ok(descriptor) = PanelDescriptor::decode(bytes) {
        let _ = descriptor.encode_to_vec();
        match descriptor.body {
            Some(Body::Table(table)) => {
                let _ = render_table(&response, &table);
            }
            Some(Body::Gallery(gallery)) => {
                let _ = render_gallery(&response, &gallery);
            }
            Some(Body::Form(form)) => {
                if let Some(meridian_uiview::proto::affordance::Invoke::Rpc(call)) = form
                    .submit_affordance
                    .as_ref()
                    .and_then(|action| action.invoke.as_ref())
                {
                    let _ = RequestBuilder::build_submission(
                        call,
                        &Context::default(),
                        &form.fields,
                        &serde_json::json!({}),
                        SubmissionKind::Form,
                    );
                }
            }
            Some(Body::Lro(panel)) => {
                if let Some(call) = panel.start {
                    let _ = RequestBuilder::build_submission(
                        &call,
                        &Context::default(),
                        &panel.inputs,
                        &serde_json::json!({}),
                        SubmissionKind::Lro,
                    );
                }
            }
            _ => {}
        }
    }
    // Decode whole authored views too: this consumer recursively walks nested
    // slots and forms, unlike the individual panel/request decoder entrypoints.
    if let Ok(view) = ViewDescriptor::decode(bytes) {
        if let Ok(text) = meridian_uiview::static_view_text(&view) {
            assert!(text.len() <= 1024 * 1024);
            assert!(text.chars().filter(|character| *character == '\n').count() <= 4096);
            assert!(!text
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\t')));
        }
    }
    // Typed corpus seeds reach the same consumers as the binary WASM exports.
    if let Ok(table) = TablePanel::decode(bytes) {
        let _ = render_table(&response, &table);
    }
    if let Ok(gallery) = GalleryPanel::decode(bytes) {
        let _ = render_gallery(&response, &gallery);
    }
    if let Ok(call) = RpcCall::decode(bytes) {
        let _ = RequestBuilder::build_for_boundary(&call, &Context::default());
    }
    if let Ok(display) = ValueDisplay::decode(bytes) {
        for value in [
            serde_json::json!("2026-03-29"),
            serde_json::json!(1.125),
            serde_json::json!(null),
        ] {
            let _ = meridian_uiview::format_display_value_with_context(
                &value,
                &display,
                Some(1_774_742_400_000.0),
            );
        }
    }
});
