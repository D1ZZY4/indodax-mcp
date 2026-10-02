use crate::{Order, OrderId, Symbol};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Runtime execution mode. Live never activates implicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    #[default]
    Paper,
    Live,
    Shadow,
}

/// Capability required for an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    MarketRead,
    AccountRead,
    TradePlace,
    TradeCancel,
    FundingRead,
    FundingWithdraw,
    PaperTrade,
    RiskRead,
    AuditRead,
    SystemRead,
}

/// Execution request handed to the execution service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionRequest {
    pub order: Order,
    pub mode: ExecutionMode,
    pub capability: Capability,
    pub correlation_id: String,
    pub requested_at: DateTime<Utc>,
}

/// Execution outcome. `Accepted` is not a fill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub order_id: OrderId,
    pub symbol: Symbol,
    pub accepted: bool,
    pub exchange_order_id: Option<String>,
    pub message: String,
    pub executed_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_mode_is_paper() {
        assert_eq!(ExecutionMode::default(), ExecutionMode::Paper);
    }
}
