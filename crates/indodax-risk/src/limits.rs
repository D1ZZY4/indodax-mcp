use indodax_core::{Capability, ExecutionMode};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Deterministic limits. All money uses `Decimal`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_order_notional_idr: Decimal,
    pub max_position_notional_idr: Decimal,
    pub max_daily_loss_idr: Decimal,
    pub max_drawdown_pct: Decimal,
    pub market_stale_after_secs: i64,
    pub account_stale_after_secs: i64,
    pub order_cooldown_secs: i64,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_order_notional_idr: Decimal::new(10_000_000, 0),
            max_position_notional_idr: Decimal::new(100_000_000, 0),
            max_daily_loss_idr: Decimal::new(5_000_000, 0),
            max_drawdown_pct: Decimal::new(10, 0),
            market_stale_after_secs: 60,
            account_stale_after_secs: 120,
            order_cooldown_secs: 5,
        }
    }
}

/// Runtime risk toggles.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RiskPolicy {
    pub kill_switch: bool,
    pub circuit_breaker: bool,
    pub allowed_modes: Vec<ExecutionMode>,
    pub allowed_capabilities: Vec<Capability>,
}

impl RiskPolicy {
    pub fn paper_only() -> Self {
        Self {
            kill_switch: false,
            circuit_breaker: false,
            allowed_modes: vec![ExecutionMode::Paper],
            allowed_capabilities: vec![
                Capability::MarketRead,
                Capability::AccountRead,
                Capability::PaperTrade,
                Capability::RiskRead,
                Capability::AuditRead,
                Capability::SystemRead,
            ],
        }
    }

    pub fn allows(&self, capability: Capability) -> bool {
        self.allowed_capabilities.contains(&capability)
    }

    pub fn allows_mode(&self, mode: ExecutionMode) -> bool {
        self.allowed_modes.contains(&mode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_policy_denies_live_and_withdraw() {
        let policy = RiskPolicy::paper_only();
        assert!(!policy.allows_mode(ExecutionMode::Live));
        assert!(!policy.allows(Capability::FundingWithdraw));
        assert!(policy.allows(Capability::PaperTrade));
    }
}
