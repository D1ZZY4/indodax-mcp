use chrono::{DateTime, Utc};
use indodax_core::{Capability, ExecutionMode, OrderSide, OrderType, Symbol};
use serde::{Deserialize, Serialize};

/// Who the agent claims to be. No LLM SDK lives here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub agent_id: String,
    pub session_id: String,
    pub display_name: Option<String>,
}

/// Agent-expressed intent. This is a proposal, never an execution order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeIntent {
    pub agent: AgentIdentity,
    pub symbol: Symbol,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: Option<f64>,
    pub quantity_or_idr: f64,
    pub quantity_is_idr: bool,
    pub mode: ExecutionMode,
    pub capability: Capability,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

impl TradeIntent {
    pub fn is_live(&self) -> bool {
        self.mode == ExecutionMode::Live
    }

    pub fn requires_trading_capability(&self) -> Capability {
        match self.side {
            OrderSide::Buy | OrderSide::Sell => Capability::TradePlace,
        }
    }
}

/// Validated proposal ready for risk review.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeProposal {
    pub intent: TradeIntent,
    pub correlation_id: String,
    pub validated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn intent_marks_live() {
        let intent = TradeIntent {
            agent: AgentIdentity {
                agent_id: "a1".into(),
                session_id: "s1".into(),
                display_name: None,
            },
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Some(100.0),
            quantity_or_idr: 1000.0,
            quantity_is_idr: true,
            mode: ExecutionMode::Live,
            capability: Capability::TradePlace,
            reason: "test".into(),
            created_at: Utc::now(),
        };
        assert!(intent.is_live());
        assert_eq!(intent.requires_trading_capability(), Capability::TradePlace);
    }
}
