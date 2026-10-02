use crate::ExecutionBackend;
use async_trait::async_trait;
use indodax_api::rest::IndodaxRest;
use indodax_core::{ExecutionRequest, ExecutionResult, IndodaxError, OrderId};
use std::collections::HashMap;

/// Live backend. Reachable only via `ExecutionService` with risk approval.
/// No strategy logic lives here.
pub struct LiveBackend<'a> {
    rest: &'a IndodaxRest,
}

impl<'a> LiveBackend<'a> {
    pub fn new(rest: &'a IndodaxRest) -> Self {
        Self { rest }
    }
}

#[async_trait]
impl ExecutionBackend for LiveBackend<'_> {
    fn name(&self) -> &'static str {
        "live"
    }

    async fn submit(&self, request: ExecutionRequest) -> Result<ExecutionResult, IndodaxError> {
        let side = format!("{:?}", request.order.side).to_uppercase();
        let order_type = match request.order.order_type {
            indodax_core::OrderType::Market => "MARKET",
            indodax_core::OrderType::StopLimit => "STOP_LIMIT",
            indodax_core::OrderType::Limit => "LIMIT",
        };
        let mut params = HashMap::new();
        params.insert("symbol".into(), request.order.symbol.as_compact().to_uppercase());
        params.insert("side".into(), side);
        params.insert("type".into(), order_type.into());
        params.insert("quantity".into(), request.order.quantity.to_f64().to_string());
        if let Some(price) = request.order.price {
            params.insert("price".into(), price.to_f64().to_string());
        }
        if let Some(stop) = request.order.stop_price {
            params.insert("stopPrice".into(), stop.to_f64().to_string());
        }
        let raw: serde_json::Value = self.rest.private_post_v2("/api/v2/order", &params).await?;
        Ok(ExecutionResult {
            order_id: request.order.id.clone(),
            symbol: request.order.symbol.clone(),
            accepted: true,
            exchange_order_id: raw
                .get("orderId")
                .and_then(|value| value.as_str().map(str::to_string))
                .or_else(|| {
                    raw.get("orderId").and_then(|value| value.as_u64()).map(|id| id.to_string())
                }),
            message: "submitted to exchange".into(),
            executed_at: chrono::Utc::now(),
        })
    }

    async fn cancel(
        &self,
        order_id: &OrderId,
        symbol: Option<&indodax_core::Symbol>,
    ) -> Result<bool, IndodaxError> {
        let symbol = symbol
            .ok_or_else(|| IndodaxError::Validation("live cancel needs the order symbol".into()))?;
        let mut params = HashMap::new();
        params.insert("symbol".into(), symbol.as_compact().to_uppercase());
        params.insert("orderId".into(), order_id.value().to_string());
        let _raw: serde_json::Value = self.rest.private_delete_v2("/api/v2/order", &params).await?;
        Ok(true)
    }
}
