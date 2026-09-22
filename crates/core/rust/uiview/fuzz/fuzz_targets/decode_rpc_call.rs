#![no_main]

use libfuzzer_sys::fuzz_target;
use meridian_uiview::proto::RpcCall;
use prost::Message;

fuzz_target!(|data: &[u8]| {
    let _ = RpcCall::decode(data);
});
