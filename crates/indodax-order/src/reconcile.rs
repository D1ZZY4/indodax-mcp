use indodax_core::{Money, OrderId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Reconciliation health between local state and exchange truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReconciliationState {
    Match,
    Mismatch,
    Unknown,
    Degraded,
    Halted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconciliationOutcome {
    pub state: ReconciliationState,
    pub checked_orders: usize,
    pub mismatched_orders: Vec<String>,
    pub message: String,
}

/// Compare local open-order ids against exchange open-order ids.
pub struct Reconciler;

impl Reconciler {
    pub fn compare_orders(
        local: &HashMap<OrderId, String>,
        exchange_ids: &[String],
    ) -> ReconciliationOutcome {
        let mut mismatched = Vec::new();
        for id in local.keys() {
            if !exchange_ids.iter().any(|exchange| exchange == id.value()) {
                mismatched.push(id.value().to_string());
            }
        }
        let checked_orders = local.len();
        if mismatched.is_empty() {
            ReconciliationOutcome {
                state: ReconciliationState::Match,
                checked_orders,
                mismatched_orders: Vec::new(),
                message: "local and exchange orders match".into(),
            }
        } else {
            ReconciliationOutcome {
                state: ReconciliationState::Mismatch,
                checked_orders,
                mismatched_orders: mismatched,
                message: "local orders missing on exchange".into(),
            }
        }
    }

    pub fn compare_balance(local: Money, exchange: Money, tolerance: Money) -> ReconciliationState {
        let diff = (local.value() - exchange.value()).abs();
        if diff <= tolerance.value() {
            ReconciliationState::Match
        } else {
            ReconciliationState::Mismatch
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_orders() {
        let mut local = HashMap::new();
        local.insert(OrderId::new("1").unwrap(), "open".into());
        let outcome = Reconciler::compare_orders(&local, &["1".to_string()]);
        assert_eq!(outcome.state, ReconciliationState::Match);
    }

    #[test]
    fn missing_exchange_order_mismatches() {
        let mut local = HashMap::new();
        local.insert(OrderId::new("9").unwrap(), "open".into());
        let outcome = Reconciler::compare_orders(&local, &[]);
        assert_eq!(outcome.state, ReconciliationState::Mismatch);
    }

    #[test]
    fn balance_tolerance() {
        let local = Money::from_f64(100.0).unwrap();
        let exchange = Money::from_f64(100.005).unwrap();
        let tolerance = Money::from_f64(0.01).unwrap();
        assert_eq!(
            Reconciler::compare_balance(local, exchange, tolerance),
            ReconciliationState::Match
        );
    }
}
