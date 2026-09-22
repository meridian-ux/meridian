use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::Instant;

use crate::proto::{RpcCall, StreamFrame};
use crate::{PayloadBudget, PayloadLimitExceeded};
use serde_json::Value;

/// Decode the schema-defined JSON frame payload for `line_field` resolution.
pub fn stream_frame_data(frame: &StreamFrame) -> Option<Value> {
    serde_json::from_slice(&frame.data_json).ok()
}

/// Encode a host-decoded JSON event in the schema-defined frame envelope.
pub fn stream_frame_from_json(data: Value) -> StreamFrame {
    StreamFrame {
        data_json: serde_json::to_vec(&data).expect("JSON values always serialize"),
    }
}

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
    budget: PayloadBudget,
    started_at: Instant,
    terminal_error: Option<StreamError>,
}

impl StreamSession {
    pub fn new(receiver: Receiver<StreamFrame>, close: impl FnOnce() + Send + 'static) -> Self {
        Self::with_limits(receiver, 0, 0, close)
    }

    pub fn with_limits(
        receiver: Receiver<StreamFrame>,
        max_bytes: u32,
        max_rate: u32,
        close: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            receiver,
            close: Some(Box::new(close)),
            budget: PayloadBudget::new(u64::from(max_bytes), u64::from(max_rate)),
            started_at: Instant::now(),
            terminal_error: None,
        }
    }

    /// Replace the default policy with descriptor-authored tighter limits.
    pub fn apply_limits(&mut self, max_bytes: u32, max_rate: u32) {
        self.budget = PayloadBudget::new(u64::from(max_bytes), u64::from(max_rate));
        self.started_at = Instant::now();
    }

    /// Tighten the shared-core defaults with the limits authored by one
    /// StreamPanel. Zero means use the shared defaults; greater values cannot
    /// raise those defaults. The returned session owns the budget.
    /// Drain all currently queued frames without blocking the renderer.
    pub fn try_recv(&mut self) -> Result<Option<StreamFrame>, StreamError> {
        if let Some(error) = self.terminal_error.as_ref() {
            return Err(error.clone());
        }
        match self.receiver.try_recv() {
            Ok(frame) => {
                if let Err(error) = self
                    .budget
                    .admit(frame.data_json.len(), self.started_at.elapsed())
                {
                    let error = StreamError::LimitExceeded(error);
                    self.terminal_error = Some(error.clone());
                    if let Some(close) = self.close.take() {
                        close();
                    }
                    return Err(error);
                }
                Ok(Some(frame))
            }
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

#[derive(Clone, Debug, thiserror::Error)]
pub enum StreamError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("stream closed")]
    Closed,
    #[error(transparent)]
    LimitExceeded(PayloadLimitExceeded),
    #[error("{0}")]
    Other(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;

    #[test]
    fn session_closes_before_returning_over_limit_frame() {
        let (tx, rx) = mpsc::channel();
        let closed = std::sync::Arc::new(AtomicBool::new(false));
        let on_close = closed.clone();
        let mut session = StreamSession::with_limits(rx, 2, 10, move || {
            on_close.store(true, Ordering::SeqCst);
        });
        tx.send(StreamFrame {
            data_json: b"{}".to_vec(),
        })
        .unwrap();
        tx.send(StreamFrame {
            data_json: b"x".to_vec(),
        })
        .unwrap();
        assert!(session.try_recv().unwrap().is_some());
        assert!(matches!(
            session.try_recv(),
            Err(StreamError::LimitExceeded(
                PayloadLimitExceeded::SessionBytes
            ))
        ));
        assert!(closed.load(Ordering::SeqCst));
        assert!(matches!(
            session.try_recv(),
            Err(StreamError::LimitExceeded(
                PayloadLimitExceeded::SessionBytes
            ))
        ));
    }
}
