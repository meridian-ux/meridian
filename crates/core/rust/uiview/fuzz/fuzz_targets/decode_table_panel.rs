#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::proto::TablePanel;
use prost::Message;

fuzz_target!(|data: &[u8]| {
    let _ = TablePanel::decode(data);
});
