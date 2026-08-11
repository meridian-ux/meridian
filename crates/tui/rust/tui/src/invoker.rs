use serde_json::Value;

/// Transport bridge implemented by hosts. The TUI renderer hands the
/// invoker a JSON-shaped request (built by
/// `meridian_uiview::RequestBuilder`) and gets back a JSON-shaped
/// response. The host's implementation does the actual gRPC call —
/// typically tonic + a serde-aware codec, but mocked impls work
/// equally well for demos / tests.
pub trait RpcInvoker {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        request: Value,
    ) -> Result<Value, RpcError>;
}

#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("unknown method {service}/{method}")]
    UnknownMethod { service: String, method: String },
    #[error("{0}")]
    Other(String),
}
