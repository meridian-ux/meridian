use meridian_uiview::proto::{GalleryPanel, PanelDescriptor, RpcCall, TablePanel};
use prost::Message;

#[test]
fn truncated_length_delimited_fields_return_decode_errors() {
    // field 1, wire type 2, claims five bytes but carries only one
    let bytes = [0x0a, 0x05, b'x'];
    assert!(PanelDescriptor::decode(bytes.as_slice()).is_err());
    assert!(TablePanel::decode(bytes.as_slice()).is_err());
    assert!(GalleryPanel::decode(bytes.as_slice()).is_err());
    assert!(RpcCall::decode(bytes.as_slice()).is_err());
}

#[test]
fn invalid_wire_types_are_rejected_without_panicking() {
    // field 1 with the reserved wire type 6
    let bytes = [0x0e];
    assert!(PanelDescriptor::decode(bytes.as_slice()).is_err());
    assert!(TablePanel::decode(bytes.as_slice()).is_err());
    assert!(GalleryPanel::decode(bytes.as_slice()).is_err());
    assert!(RpcCall::decode(bytes.as_slice()).is_err());
}

#[test]
fn unknown_fields_are_ignored_without_becoming_known_panel_arms() {
    // Unknown field 100, varint value 7.
    let bytes = [0xa0, 0x06, 0x07];
    let descriptor = PanelDescriptor::decode(bytes.as_slice()).unwrap();
    assert!(descriptor.body.is_none());
    assert!(descriptor.encode_to_vec().is_empty());
}
