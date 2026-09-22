#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::proto::GalleryPanel;
use prost::Message;

fuzz_target!(|data: &[u8]| {
    let _ = GalleryPanel::decode(data);
});
