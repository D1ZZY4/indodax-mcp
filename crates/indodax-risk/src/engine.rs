use crate::{RiskLimits, RiskPolicy};
use chrono::{DateTime, Utc};
use indodax_core::{Capability, ExecutionMode, Order, RiskDecision, RiskReason};

/// Context supplied to the deterministic risk check.
#[derive(Debug, Clone)]
pub struct RiskContext {
    pub mode: ExecutionMode,
    pub capability: Capability,
    pub market_age_secs: Option<i64>,
    pub account_age_secs: Option<i64>,
    pub daily_pnl_idr: Option<rust_decimal::Decimal>,
    pub duplicate: bool,
    pub reconciliation_halted: bool,
    pub now: DateTime<Utc>,
}

impl RiskContext {
    pub fn fresh_paper(capability: Capability) -> Self {
        Self {
            mode: ExecutionMode::Paper,
            capability,
            market_age_secs: Some(5),
            account_age_secs: Some(5),
            daily_pnl_idr: Some(rust_decimal::Decimal::ZERO),
            duplicate: false,
            reconciliation_halted: false,
            now: Utc::now(),
        }
    }
}

/// Pure risk evaluation. No I/O, no randomness.
#[derive(Debug, Clone)]
pub struct RiskEngine {
    limits: RiskLimits,
    policy: RiskPolicy,
}

impl RiskEngine {
    pub fn new(limits: RiskLimits, policy: RiskPolicy) -> Self {
        Self { limits, policy }
    }

    pub fn evaluate(&self, order: &Order, context: &RiskContext) -> RiskDecision {
        if self.policy.kill_switch {
            return RiskDecision::halt(RiskReason::KillSwitch, "kill switch engaged");
        }
        if self.policy.circuit_breaker {
            return RiskDecision::halt(RiskReason::CircuitBreaker, "circuit breaker open");
        }
        if context.reconciliation_halted {
            return RiskDecision::halt(
                RiskReason::ReconciliationFailure,
                "reconciliation halted trading",
            );
        }
        if !self.policy.allows_mode(context.mode) {
            return RiskDecision::deny(RiskReason::LiveModeDenied, "execution mode not allowed");
        }
        if !self.policy.allows(context.capability) {
            return RiskDecision::deny(RiskReason::CapabilityDenied, "capability denied");
        }
        if context.duplicate {
            return RiskDecision::deny(RiskReason::DuplicateOrder, "duplicate order detected");
        }
        if let Some(age) = context.market_age_secs {
            if age > self.limits.market_stale_after_secs {
                return RiskDecision::deny(RiskReason::StaleMarketData, "market data is stale");
            }
        }
        if let Some(age) = context.account_age_secs {
            if age > self.limits.account_stale_after_secs {
                return RiskDecision::deny(RiskReason::StaleAccountState, "account data is stale");
            }
        }
        if let Some(order_notional) = order.notional() {
            if order_notional.value() > self.limits.max_order_notional_idr {
                return RiskDecision::deny(RiskReason::MaxOrderSize, "order exceeds max size");
            }
        } else if order.order_type == indodax_core::OrderType::Market {
            return RiskDecision::deny(RiskReason::InvalidOrder, "market order needs checks");
        }
        if let Some(pnl) = context.daily_pnl_idr {
            if pnl < -self.limits.max_daily_loss_idr {
                return RiskDecision::deny(RiskReason::DailyLossLimit, "daily loss limit hit");
            }
        }
        RiskDecision::allow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_core::{OrderId, OrderSide, OrderState, OrderType, Price, Quantity, Symbol};
    use std::str::FromStr;

    fn order() -> Order {
        Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Price::from_f64(1000.0),
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state: OrderState::Proposed,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn allows_fresh_paper_order() {
        let engine = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
        let decision = engine.evaluate(&order(), &RiskContext::fresh_paper(Capability::PaperTrade));
        assert!(decision.is_allow());
    }

    #[test]
    fn kill_switch_halts() {
        let policy = RiskPolicy { kill_switch: true, ..RiskPolicy::paper_only() };
        let engine = RiskEngine::new(RiskLimits::default(), policy);
        let decision = engine.evaluate(&order(), &RiskContext::fresh_paper(Capability::PaperTrade));
        assert_eq!(decision.outcome, indodax_core::RiskOutcome::Halt);
    }

    #[test]
    fn withdrawal_capability_denied() {
        let engine = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
        let mut context = RiskContext::fresh_paper(Capability::FundingWithdraw);
        context.mode = ExecutionMode::Paper;
        let decision = engine.evaluate(&order(), &context);
        assert!(!decision.is_allow());
    }
}
