#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::{
    prost::Message,
    proto::{
        panel_descriptor::Body, GalleryPanel, PanelDescriptor, RpcCall, TablePanel, ValueDisplay,
    },
    render_gallery, render_table, Context, RequestBuilder,
};

fuzz_target!(|bytes: &[u8]| {
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
            _ => {}
        }
    }
    // These are the same five binary message types accepted by the seven
    // WASM decoder exports. Typed corpus seeds reach their real consumers.
    if let Ok(table) = TablePanel::decode(bytes) {
        let _ = render_table(&response, &table);
    }
    if let Ok(gallery) = GalleryPanel::decode(bytes) {
        let _ = render_gallery(&response, &gallery);
    }
    if let Ok(call) = RpcCall::decode(bytes) {
        let _ = RequestBuilder::build(&call, &Context::default());
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
