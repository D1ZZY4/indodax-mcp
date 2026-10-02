use chrono::Utc;
use indodax_agent::{TradeIntent, TradeProposal};
use indodax_audit::{AuditEntry, AuditKind, AuditTrail};
use indodax_core::{
    Capability, ExecutionMode, ExecutionRequest, IndodaxError, Order, OrderId, OrderState,
    OrderType, Price, Quantity, RiskDecision,
};
use indodax_order::OrderMachine;
use indodax_risk::{RiskContext, RiskEngine};
use std::sync::atomic::{AtomicU64, Ordering};

/// Trading service: intent -> validate -> risk -> executable order.
/// This layer never touches the network itself.
pub struct TradingService<'a> {
    risk: &'a RiskEngine,
    audit: &'a AuditTrail,
    counter: AtomicU64,
}

impl<'a> TradingService<'a> {
    pub fn new(risk: &'a RiskEngine, audit: &'a AuditTrail) -> Self {
        Self::with_start(risk, audit, 1)
    }

    pub fn with_start(risk: &'a RiskEngine, audit: &'a AuditTrail, start: u64) -> Self {
        Self { risk, audit, counter: AtomicU64::new(start) }
    }

    pub fn propose(&self, intent: TradeIntent) -> Result<TradeProposal, IndodaxError> {
        if intent.quantity_or_idr <= 0.0 || !intent.quantity_or_idr.is_finite() {
            return Err(IndodaxError::Validation("amount must be positive".into()));
        }
        if intent.order_type == OrderType::Limit && intent.price.is_none() {
            return Err(IndodaxError::Validation("limit order needs price".into()));
        }
        let correlation_id = format!("corr-{}", self.counter.fetch_add(1, Ordering::Relaxed));
        self.audit.record(AuditEntry {
            event_id: format!("evt-{correlation_id}"),
            timestamp: Utc::now(),
            correlation_id: correlation_id.clone(),
            session_id: Some(intent.agent.session_id.clone()),
            agent_id: Some(intent.agent.agent_id.clone()),
            symbol: Some(intent.symbol.as_pair()),
            kind: AuditKind::AgentIntentCreated,
            decision: None,
            result: None,
            reason: Some(intent.reason.clone()),
        });
        Ok(TradeProposal { intent, correlation_id, validated_at: Utc::now() })
    }

    pub fn to_order(&self, proposal: &TradeProposal) -> Result<Order, IndodaxError> {
        let intent = &proposal.intent;
        let price = intent.price.and_then(Price::from_f64);
        let quantity = if intent.quantity_is_idr {
            let price_value = intent
                .price
                .ok_or_else(|| IndodaxError::Validation("idr buy needs price".into()))?;
            Quantity::from_f64(intent.quantity_or_idr / price_value)
        } else {
            Quantity::from_f64(intent.quantity_or_idr)
        }
        .ok_or_else(|| IndodaxError::Validation("invalid quantity".into()))?;
        Ok(Order {
            id: OrderId::new(format!("order-{}", proposal.correlation_id))
                .ok_or_else(|| IndodaxError::System("order id failed".into()))?,
            symbol: intent.symbol.clone(),
            side: intent.side,
            order_type: intent.order_type,
            price,
            stop_price: None,
            quantity,
            remaining: quantity,
            state: OrderState::Proposed,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    pub fn review(
        &self,
        order: &mut Order,
        context: &RiskContext,
    ) -> Result<RiskDecision, IndodaxError> {
        OrderMachine::transition(order, OrderState::Validating)
            .map_err(|error| IndodaxError::Validation(error.to_string()))?;
        OrderMachine::transition(order, OrderState::RiskCheck)
            .map_err(|error| IndodaxError::Validation(error.to_string()))?;
        let decision = self.risk.evaluate(order, context);
        self.audit.record(AuditEntry {
            event_id: format!("evt-{}", indodax_core::now_millis()),
            timestamp: Utc::now(),
            correlation_id: order.id.value().to_string(),
            session_id: None,
            agent_id: None,
            symbol: Some(order.symbol.as_pair()),
            kind: if decision.is_allow() {
                AuditKind::RiskApproved
            } else {
                AuditKind::RiskRejected
            },
            decision: Some(format!("{:?}", decision.outcome)),
            result: None,
            reason: Some(decision.message.clone()),
        });
        if decision.is_allow() {
            OrderMachine::transition(order, OrderState::Approved)
                .map_err(|error| IndodaxError::Validation(error.to_string()))?;
            OrderMachine::transition(order, OrderState::Submitting)
                .map_err(|error| IndodaxError::Validation(error.to_string()))?;
        } else {
            OrderMachine::transition(order, OrderState::Rejected)
                .map_err(|error| IndodaxError::Validation(error.to_string()))?;
        }
        Ok(decision)
    }

    pub fn execution_request(
        &self,
        order: &Order,
        mode: ExecutionMode,
        capability: Capability,
        correlation_id: String,
    ) -> ExecutionRequest {
        ExecutionRequest {
            order: order.clone(),
            mode,
            capability,
            correlation_id,
            requested_at: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_agent::AgentIdentity;
    use indodax_core::{Capability, ExecutionMode, OrderSide, Symbol};
    use indodax_risk::{RiskLimits, RiskPolicy};
    use std::str::FromStr;

    #[test]
    fn full_propose_review_flow() {
        let risk = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
        let audit = AuditTrail::new();
        let service = TradingService::new(&risk, &audit);
        let intent = TradeIntent {
            agent: AgentIdentity {
                agent_id: "a".into(),
                session_id: "s".into(),
                display_name: None,
            },
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Some(1000.0),
            quantity_or_idr: 1.0,
            quantity_is_idr: false,
            mode: ExecutionMode::Paper,
            capability: Capability::PaperTrade,
            reason: "test".into(),
            created_at: Utc::now(),
        };
        let proposal = service.propose(intent).unwrap();
        let mut order = service.to_order(&proposal).unwrap();
        let context = RiskContext::fresh_paper(Capability::PaperTrade);
        let decision = service.review(&mut order, &context).unwrap();
        assert!(decision.is_allow());
        assert_eq!(order.state, OrderState::Submitting);
    }
}
