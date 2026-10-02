use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::{sleep, Instant};

#[derive(Debug)]
struct State {
    tokens: u64,
    last_refill: Instant,
}

/// Token-bucket limiter. Preserves v1 proactive 429 avoidance.
#[derive(Debug)]
pub struct RateLimiter {
    capacity: u64,
    refill_per_sec: u64,
    state: Mutex<State>,
}

impl RateLimiter {
    pub fn new(requests_per_sec: u64) -> Self {
        let rps = requests_per_sec.max(1);
        Self {
            capacity: rps,
            refill_per_sec: rps,
            state: Mutex::new(State { tokens: rps, last_refill: Instant::now() }),
        }
    }

    pub fn from_env_or(default_rps: u64) -> Self {
        let rps = std::env::var("INDODAX_RATE_LIMIT")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(default_rps);
        Self::new(rps)
    }

    pub async fn acquire(&self) {
        loop {
            let mut state = self.state.lock().await;
            let elapsed = state.last_refill.elapsed();
            if elapsed >= Duration::from_secs(1) {
                let seconds = elapsed.as_secs().min(60);
                let add = self.refill_per_sec.saturating_mul(seconds);
                state.tokens = state.tokens.saturating_add(add).min(self.capacity);
                state.last_refill += Duration::from_secs(seconds);
            }
            if state.tokens > 0 {
                state.tokens -= 1;
                return;
            }
            let wait = Duration::from_millis(1000 - elapsed.as_millis().min(990) as u64)
                .max(Duration::from_millis(10));
            drop(state);
            sleep(wait).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn consumes_tokens() {
        let limiter = RateLimiter::new(5);
        limiter.acquire().await;
        let state = limiter.state.lock().await;
        assert_eq!(state.tokens, 4);
    }

    #[tokio::test]
    async fn refills_after_second() {
        let limiter = RateLimiter::new(2);
        limiter.acquire().await;
        limiter.acquire().await;
        {
            let mut state = limiter.state.lock().await;
            state.last_refill = Instant::now() - Duration::from_secs(2);
        }
        limiter.acquire().await;
        let state = limiter.state.lock().await;
        assert!(state.tokens <= 1);
    }
}
