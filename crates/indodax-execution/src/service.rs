use crate::ExecutionBackend;
use indodax_core::{ExecutionRequest, ExecutionResult, IndodaxError, RiskDecision};

/// Execution service: the only caller of backends.
/// Callers must supply an approved `RiskDecision`; this service re-checks.
pub struct ExecutionService<B> {
    backend: B,
}

impl<B: ExecutionBackend> ExecutionService<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub async fn execute(
        &self,
        request: ExecutionRequest,
        risk: &RiskDecision,
    ) -> Result<ExecutionResult, IndodaxError> {
        if !risk.is_allow() {
            return Err(IndodaxError::RiskRejection(risk.message.clone()));
        }
        self.backend.submit(request).await
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.name()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::Utc;
    use indodax_core::{Capability, ExecutionMode, Order, OrderId, OrderSide, OrderState};
    use indodax_core::{OrderType, Quantity, Symbol};
    use std::str::FromStr;

    struct OkBackend;

    #[async_trait]
    impl ExecutionBackend for OkBackend {
        fn name(&self) -> &'static str {
            "ok"
        }

        async fn submit(&self, request: ExecutionRequest) -> Result<ExecutionResult, IndodaxError> {
            Ok(ExecutionResult {
                order_id: request.order.id.clone(),
                symbol: request.order.symbol.clone(),
                accepted: true,
                exchange_order_id: None,
                message: "accepted".into(),
                executed_at: Utc::now(),
            })
        }

        async fn cancel(
            &self,
            _order_id: &OrderId,
            _symbol: Option<&indodax_core::Symbol>,
        ) -> Result<bool, IndodaxError> {
            Ok(true)
        }
    }

    #[tokio::test]
    async fn rejects_without_risk_approval() {
        let service = ExecutionService::new(OkBackend);
        let order = Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: None,
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state: OrderState::Approved,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let request = ExecutionRequest {
            order,
            mode: ExecutionMode::Paper,
            capability: Capability::PaperTrade,
            correlation_id: "c1".into(),
            requested_at: Utc::now(),
        };
        let denied = RiskDecision::deny(indodax_core::RiskReason::KillSwitch, "stopped");
        assert!(service.execute(request, &denied).await.is_err());
    }
}
