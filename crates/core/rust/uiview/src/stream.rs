use std::sync::mpsc::{Receiver, TryRecvError};

use crate::proto::{RpcCall, StreamFrame};
use serde_json::Value;

/// Host-provided peer to `RpcInvoker` for a server-streaming RPC.
///
/// The receiver is runtime-only; frames crossing a process or transport boundary
/// use the generated `StreamFrame` proto. A session owns the subscription and
/// its close callback, so dropping a panel can release host transport resources.
pub trait StreamInvoker {
    fn subscribe(&self, call: &RpcCall, request: Value) -> Result<StreamSession, StreamError>;
}

/// Nonblocking stream receiver and its cancellation hook.
pub struct StreamSession {
    receiver: Receiver<StreamFrame>,
    close: Option<Box<dyn FnOnce() + Send>>,
}

impl StreamSession {
    pub fn new(receiver: Receiver<StreamFrame>, close: impl FnOnce() + Send + 'static) -> Self {
        Self {
            receiver,
            close: Some(Box::new(close)),
        }
    }

    /// Drain all currently queued frames without blocking the renderer.
    pub fn try_recv(&self) -> Result<Option<StreamFrame>, StreamError> {
        match self.receiver.try_recv() {
            Ok(frame) => Ok(Some(frame)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(StreamError::Closed),
        }
    }
}

impl Drop for StreamSession {
    fn drop(&mut self) {
        if let Some(close) = self.close.take() {
            close();
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StreamError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("stream closed")]
    Closed,
    #[error("{0}")]
    Other(String),
}
