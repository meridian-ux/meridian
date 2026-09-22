#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::proto::PanelDescriptor;
use prost::Message;

fuzz_target!(|data: &[u8]| {
    if let Ok(descriptor) = PanelDescriptor::decode(data) {
        let _ = descriptor.encode_to_vec();
    }
});
