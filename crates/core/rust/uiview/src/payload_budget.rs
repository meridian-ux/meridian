use std::collections::VecDeque;
use std::time::Duration;

/// Default per-direction session budget when a descriptor leaves a limit at 0.
pub const DEFAULT_MAX_PAYLOAD_BYTES: u64 = 64 * 1024 * 1024;
/// Default maximum bytes admitted in any rolling one-second window.
pub const DEFAULT_MAX_PAYLOAD_RATE: u64 = 1024 * 1024;

const RATE_WINDOW: Duration = Duration::from_secs(1);
const RATE_BUCKET: Duration = Duration::from_millis(1);

#[cfg(any(target_arch = "wasm32", test))]
pub(crate) fn elapsed_from_monotonic_millis(started_at_ms: f64, now_ms: f64) -> Option<Duration> {
    if !started_at_ms.is_finite()
        || started_at_ms < 0.0
        || !now_ms.is_finite()
        || now_ms < started_at_ms
    {
        return None;
    }
    Duration::try_from_secs_f64((now_ms - started_at_ms) / 1000.0).ok()
}

/// Runtime-only guard for untrusted live payloads. `max_bytes` is the total
/// bytes admitted for one direction of one session; `max_rate` is the maximum
/// bytes admitted in any rolling one-second window. A zero limit selects the
/// shared-core default, so descriptors cannot disable protection with proto3's
/// default value.
pub struct PayloadBudget {
    max_bytes: u64,
    max_rate: u64,
    admitted_bytes: u64,
    recent: VecDeque<(Duration, u64)>,
    recent_bytes: u64,
    last_seen: Option<Duration>,
}

impl PayloadBudget {
    pub fn new(max_bytes: u64, max_rate: u64) -> Self {
        Self {
            // Descriptor values are policy hints from the producer; they can
            // make a session stricter but cannot switch off or raise the
            // renderer's hard defaults.
            max_bytes: if max_bytes == 0 {
                DEFAULT_MAX_PAYLOAD_BYTES
            } else {
                max_bytes.min(DEFAULT_MAX_PAYLOAD_BYTES)
            },
            max_rate: if max_rate == 0 {
                DEFAULT_MAX_PAYLOAD_RATE
            } else {
                max_rate.min(DEFAULT_MAX_PAYLOAD_RATE)
            },
            admitted_bytes: 0,
            recent: VecDeque::new(),
            recent_bytes: 0,
            last_seen: None,
        }
    }

    /// Admit one transport payload at a monotonic time relative to session
    /// creation. Call before decoding, formatting, or rendering the payload.
    pub fn admit(&mut self, bytes: usize, now: Duration) -> Result<(), PayloadLimitExceeded> {
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        if self.admitted_bytes.saturating_add(bytes) > self.max_bytes {
            return Err(PayloadLimitExceeded::SessionBytes);
        }
        if self.last_seen.is_some_and(|last| now < last) {
            return Err(PayloadLimitExceeded::InvalidClock);
        }
        self.last_seen = Some(now);
        if bytes == 0 {
            return Ok(());
        }

        let rate_expiry = RATE_WINDOW + RATE_BUCKET;
        while self
            .recent
            .front()
            .is_some_and(|(at, _)| now.saturating_sub(*at) >= rate_expiry)
        {
            let (_, expired) = self.recent.pop_front().expect("front was present");
            self.recent_bytes -= expired;
        }

        if self.recent_bytes.saturating_add(bytes) > self.max_rate {
            return Err(PayloadLimitExceeded::Rate);
        }

        self.admitted_bytes += bytes;
        self.recent_bytes += bytes;
        // Aggregate frames within each millisecond. A per-frame queue lets a
        // flood of tiny messages amplify a small byte budget into large state.
        // Expiring one bucket late is conservative: it can reject slightly
        // early, but never admits more than the rolling byte ceiling.
        let bucket_ms = u64::try_from(now.as_millis()).unwrap_or(u64::MAX);
        let bucket = Duration::from_millis(bucket_ms);
        if let Some((at, bucket_bytes)) = self.recent.back_mut().filter(|(at, _)| *at == bucket) {
            *bucket_bytes += bytes;
            debug_assert_eq!(*at, bucket);
        } else {
            self.recent.push_back((bucket, bytes));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PayloadLimitExceeded {
    #[error("payload session byte limit exceeded")]
    SessionBytes,
    #[error("payload rate limit exceeded")]
    Rate,
    #[error("payload budget received a non-monotonic clock")]
    InvalidClock,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monotonic_millisecond_conversion_rejects_invalid_or_unrepresentable_times() {
        assert_eq!(
            elapsed_from_monotonic_millis(10.0, 1010.0),
            Some(Duration::from_secs(1))
        );
        assert_eq!(elapsed_from_monotonic_millis(10.0, 9.0), None);
        assert_eq!(elapsed_from_monotonic_millis(0.0, f64::MAX), None);
    }

    #[test]
    fn enforces_total_bytes_including_exact_boundary() {
        let mut budget = PayloadBudget::new(5, 10);
        assert_eq!(budget.admit(3, Duration::ZERO), Ok(()));
        assert_eq!(budget.admit(2, Duration::ZERO), Ok(()));
        assert_eq!(
            budget.admit(1, Duration::from_secs(3)),
            Err(PayloadLimitExceeded::SessionBytes)
        );
    }

    #[test]
    fn enforces_a_rolling_one_second_byte_rate() {
        let mut budget = PayloadBudget::new(100, 5);
        assert_eq!(budget.admit(3, Duration::ZERO), Ok(()));
        assert_eq!(
            budget.admit(3, Duration::from_millis(999)),
            Err(PayloadLimitExceeded::Rate)
        );
        assert_eq!(budget.admit(3, Duration::from_millis(1_001)), Ok(()));
    }

    #[test]
    fn zero_uses_shared_defaults_instead_of_disabling_limits() {
        let mut budget = PayloadBudget::new(0, 0);
        assert_eq!(budget.max_bytes, DEFAULT_MAX_PAYLOAD_BYTES);
        assert_eq!(budget.max_rate, DEFAULT_MAX_PAYLOAD_RATE);
        assert_eq!(
            budget.admit(DEFAULT_MAX_PAYLOAD_RATE as usize, Duration::ZERO),
            Ok(())
        );
        assert_eq!(
            budget.admit(1, Duration::ZERO),
            Err(PayloadLimitExceeded::Rate)
        );
    }

    #[test]
    fn descriptors_can_tighten_but_not_raise_the_shared_defaults() {
        let budget = PayloadBudget::new(u64::MAX, u64::MAX);
        assert_eq!(budget.max_bytes, DEFAULT_MAX_PAYLOAD_BYTES);
        assert_eq!(budget.max_rate, DEFAULT_MAX_PAYLOAD_RATE);
    }

    #[test]
    fn rejected_rate_payload_does_not_consume_session_budget() {
        let mut budget = PayloadBudget::new(12, 4);
        assert_eq!(budget.admit(4, Duration::ZERO), Ok(()));
        assert_eq!(
            budget.admit(5, Duration::ZERO),
            Err(PayloadLimitExceeded::Rate)
        );
        assert_eq!(budget.admit(4, Duration::from_millis(1_001)), Ok(()));
    }

    #[test]
    fn rate_window_state_is_bounded_under_many_small_frames() {
        let mut budget = PayloadBudget::new(20_000, 20_000);
        for frame in 0..10_000 {
            assert_eq!(budget.admit(1, Duration::from_micros(frame * 100)), Ok(()));
        }
        assert!(budget.recent.len() <= 1_001);
        assert_eq!(budget.admitted_bytes, 10_000);
    }

    #[test]
    fn rejects_a_non_monotonic_clock() {
        let mut budget = PayloadBudget::new(100, 100);
        assert_eq!(budget.admit(1, Duration::from_secs(2)), Ok(()));
        assert_eq!(
            budget.admit(1, Duration::from_secs(1)),
            Err(PayloadLimitExceeded::InvalidClock)
        );
    }
}
