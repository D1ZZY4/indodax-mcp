use indodax_core::{IndodaxError, Order, OrderState};

#[derive(Debug, thiserror::Error)]
#[error("invalid transition from {from:?} to {to:?}")]
pub struct TransitionError {
    pub from: OrderState,
    pub to: OrderState,
}

/// Explicit state machine so illegal jumps fail loudly.
pub struct OrderMachine;

impl OrderMachine {
    pub fn transition(order: &mut Order, to: OrderState) -> Result<(), TransitionError> {
        if Self::allowed(order.state, to) {
            order.state = to;
            order.updated_at = chrono::Utc::now();
            Ok(())
        } else {
            Err(TransitionError { from: order.state, to })
        }
    }

    fn allowed(from: OrderState, to: OrderState) -> bool {
        use OrderState as State;
        matches!(
            (from, to),
            (State::Proposed, State::Validating)
                | (State::Validating, State::RiskCheck)
                | (State::Validating, State::Rejected)
                | (State::RiskCheck, State::Approved)
                | (State::RiskCheck, State::Rejected)
                | (State::Approved, State::Submitting)
                | (State::Submitting, State::Open)
                | (State::Submitting, State::SubmitFailed)
                | (State::Submitting, State::Unknown)
                | (State::Unknown, State::Open)
                | (State::Unknown, State::Filled)
                | (State::Unknown, State::SubmitFailed)
                | (State::Open, State::PartiallyFilled)
                | (State::Open, State::Filled)
                | (State::Open, State::CancelRequested)
                | (State::PartiallyFilled, State::Filled)
                | (State::PartiallyFilled, State::CancelRequested)
                | (State::CancelRequested, State::Cancelled)
                | (State::CancelRequested, State::Filled)
                | (State::Open, State::Expired)
        )
    }

    pub fn submit_failed(order: &mut Order, error: &IndodaxError) {
        // Unknown outcome (e.g. timeout) must not masquerade as failure.
        let target = if matches!(error, IndodaxError::Timeout(_) | IndodaxError::Network(_)) {
            OrderState::Unknown
        } else {
            OrderState::SubmitFailed
        };
        let _ = Self::transition(order, target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_core::{OrderId, OrderSide, OrderType, Quantity, Symbol};
    use std::str::FromStr;

    fn order() -> Order {
        Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: None,
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state: OrderState::Proposed,
            client_order_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn happy_path_transitions() {
        let mut order = order();
        for next in [
            OrderState::Validating,
            OrderState::RiskCheck,
            OrderState::Approved,
            OrderState::Submitting,
            OrderState::Open,
            OrderState::Filled,
        ] {
            OrderMachine::transition(&mut order, next).unwrap();
        }
        assert_eq!(order.state, OrderState::Filled);
    }

    #[test]
    fn illegal_jump_fails() {
        let mut order = order();
        assert!(OrderMachine::transition(&mut order, OrderState::Filled).is_err());
    }

    #[test]
    fn timeout_becomes_unknown() {
        let mut order = order();
        order.state = OrderState::Submitting;
        OrderMachine::submit_failed(&mut order, &IndodaxError::Timeout("t".into()));
        assert_eq!(order.state, OrderState::Unknown);
    }
}
