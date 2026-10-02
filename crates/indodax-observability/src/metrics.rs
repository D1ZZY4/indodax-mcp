use std::sync::atomic::{AtomicU64, Ordering};

/// Lightweight counters for operators. No external metrics backend.
#[derive(Debug, Default)]
pub struct Metrics {
    pub orders_submitted: AtomicU64,
    pub orders_filled: AtomicU64,
    pub orders_rejected: AtomicU64,
    pub risk_rejections: AtomicU64,
    pub exchange_errors: AtomicU64,
    pub ws_reconnects: AtomicU64,
    pub reconciliation_failures: AtomicU64,
    pub mcp_requests: AtomicU64,
    pub mcp_failures: AtomicU64,
}

impl Metrics {
    pub fn snapshot(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            orders_submitted: self.orders_submitted.load(Ordering::Relaxed),
            orders_filled: self.orders_filled.load(Ordering::Relaxed),
            orders_rejected: self.orders_rejected.load(Ordering::Relaxed),
            risk_rejections: self.risk_rejections.load(Ordering::Relaxed),
            exchange_errors: self.exchange_errors.load(Ordering::Relaxed),
            ws_reconnects: self.ws_reconnects.load(Ordering::Relaxed),
            reconciliation_failures: self.reconciliation_failures.load(Ordering::Relaxed),
            mcp_requests: self.mcp_requests.load(Ordering::Relaxed),
            mcp_failures: self.mcp_failures.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct MetricsSnapshot {
    pub orders_submitted: u64,
    pub orders_filled: u64,
    pub orders_rejected: u64,
    pub risk_rejections: u64,
    pub exchange_errors: u64,
    pub ws_reconnects: u64,
    pub reconciliation_failures: u64,
    pub mcp_requests: u64,
    pub mcp_failures: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_increment() {
        let metrics = Metrics::default();
        metrics.orders_submitted.fetch_add(1, Ordering::Relaxed);
        assert_eq!(metrics.snapshot().orders_submitted, 1);
    }
}
