#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::{
    prost::Message,
    proto::{panel_descriptor::Body, PanelDescriptor},
    render_gallery, render_table,
};

fuzz_target!(|bytes: &[u8]| {
    let Ok(descriptor) = PanelDescriptor::decode(bytes) else {
        return;
    };

    // Decoding is the primary contract. Also exercise core consumers for the
    // arms this crate interprets so valid-but-hostile nested values are covered.
    match descriptor.body {
        Some(Body::Table(table)) => {
            let _ = render_table(&serde_json::Value::Null, &table);
        }
        Some(Body::Gallery(gallery)) => {
            let _ = render_gallery(&serde_json::Value::Null, &gallery);
        }
        _ => {}
    }
});
