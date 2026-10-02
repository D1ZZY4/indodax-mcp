use serde::{Deserialize, Serialize};

/// Machine-readable risk outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskOutcome {
    Allow,
    Deny,
    RequireReview,
    Halt,
}

/// Explicit denial reason. Never a free-form string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskReason {
    MaxOrderSize,
    MaxPositionExposure,
    DailyLossLimit,
    DrawdownLimit,
    CooldownActive,
    DuplicateOrder,
    StaleMarketData,
    StaleAccountState,
    CircuitBreaker,
    KillSwitch,
    ReconciliationFailure,
    CapabilityDenied,
    LiveModeDenied,
    InvalidOrder,
}

/// Structured risk verdict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiskDecision {
    pub outcome: RiskOutcome,
    pub reasons: Vec<RiskReason>,
    pub message: String,
}

impl RiskDecision {
    pub fn allow() -> Self {
        Self { outcome: RiskOutcome::Allow, reasons: Vec::new(), message: "allowed".to_string() }
    }

    pub fn deny(reason: RiskReason, message: impl Into<String>) -> Self {
        Self { outcome: RiskOutcome::Deny, reasons: vec![reason], message: message.into() }
    }

    pub fn halt(reason: RiskReason, message: impl Into<String>) -> Self {
        Self { outcome: RiskOutcome::Halt, reasons: vec![reason], message: message.into() }
    }

    pub fn is_allow(&self) -> bool {
        self.outcome == RiskOutcome::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_has_no_reasons() {
        assert!(RiskDecision::allow().is_allow());
    }

    #[test]
    fn deny_carries_reason() {
        let decision = RiskDecision::deny(RiskReason::KillSwitch, "killed");
        assert_eq!(decision.outcome, RiskOutcome::Deny);
        assert!(decision.reasons.contains(&RiskReason::KillSwitch));
    }
}
