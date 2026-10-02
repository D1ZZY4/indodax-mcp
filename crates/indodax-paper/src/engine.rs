use crate::PaperState;
use async_trait::async_trait;
use chrono::Utc;
use indodax_core::{ExecutionRequest, ExecutionResult, IndodaxError, OrderId, OrderSide};
use indodax_execution::ExecutionBackend;
use rust_decimal::Decimal;
use std::sync::RwLock;

const TAKER_FEE: &str = "0.0026";

/// Paper backend: simulates matching without touching the exchange.
pub struct PaperBackend {
    pub(crate) state: RwLock<PaperState>,
}

impl PaperBackend {
    pub fn new(state: PaperState) -> Self {
        Self { state: RwLock::new(state) }
    }

    pub fn snapshot(&self) -> PaperState {
        self.state.read().map(|guard| guard.clone()).unwrap_or_default()
    }

    pub(crate) fn fee_rate() -> Decimal {
        TAKER_FEE.parse().unwrap_or(Decimal::ZERO)
    }
}

#[async_trait]
impl ExecutionBackend for PaperBackend {
    fn name(&self) -> &'static str {
        "paper"
    }

    async fn submit(&self, request: ExecutionRequest) -> Result<ExecutionResult, IndodaxError> {
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        let price = request
            .order
            .price
            .ok_or_else(|| IndodaxError::Validation("paper needs limit price".into()))?;
        let quantity = request.order.quantity.value();
        let notional = price.value() * quantity;
        let base = request.order.symbol.base().code().to_string();
        let quote = request.order.symbol.quote().code().to_string();

        match request.order.side {
            OrderSide::Buy => {
                let available = guard.balances.get(&quote).copied().unwrap_or(Decimal::ZERO);
                if available < notional {
                    return Err(IndodaxError::StateConflict("insufficient paper quote".into()));
                }
                guard.balances.insert(quote.clone(), available - notional);
            }
            OrderSide::Sell => {
                let available = guard.balances.get(&base).copied().unwrap_or(Decimal::ZERO);
                if available < quantity {
                    return Err(IndodaxError::StateConflict("insufficient paper base".into()));
                }
                guard.balances.insert(base.clone(), available - quantity);
            }
        }

        let id = format!("paper-{}", guard.next_order_id);
        guard.next_order_id += 1;
        guard.trade_count += 1;
        guard.orders.push(crate::state::PaperOrderRecord {
            id: OrderId::new(&id).unwrap(),
            symbol: request.order.symbol.clone(),
            side: format!("{:?}", request.order.side).to_lowercase(),
            price: Some(price.value()),
            quantity,
            remaining: quantity,
            state: "open".into(),
            created_at: Utc::now(),
            filled_price: None,
            fee_paid: Decimal::ZERO,
        });

        Ok(ExecutionResult {
            order_id: request.order.id.clone(),
            symbol: request.order.symbol.clone(),
            accepted: true,
            exchange_order_id: Some(id),
            message: "paper open".into(),
            executed_at: Utc::now(),
        })
    }

    async fn cancel(
        &self,
        order_id: &OrderId,
        _symbol: Option<&indodax_core::Symbol>,
    ) -> Result<bool, IndodaxError> {
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        let position = guard.orders.iter().position(|order| &order.id == order_id);
        let Some(index) = position else {
            return Ok(false);
        };
        if guard.orders[index].state != "open" {
            return Ok(false);
        }
        let record = guard.orders[index].clone();
        let base = record.symbol.base().code().to_string();
        let quote = record.symbol.quote().code().to_string();
        let refund = record.price.unwrap_or(Decimal::ZERO) * record.remaining;
        if record.side == "buy" {
            *guard.balances.entry(quote.clone()).or_insert(Decimal::ZERO) += refund;
        } else {
            *guard.balances.entry(base.clone()).or_insert(Decimal::ZERO) += record.remaining;
        }
        guard.orders[index].state = "cancelled".into();
        guard.orders[index].remaining = Decimal::ZERO;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_core::{Capability, ExecutionMode, Order, OrderState, OrderType};
    use indodax_core::{Price, Quantity, Symbol};
    use std::str::FromStr;

    #[tokio::test]
    async fn paper_buy_opens_with_reserved_quote() {
        let backend = PaperBackend::new(PaperState::with_defaults());
        let order = Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Price::from_f64(1000.0),
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state: OrderState::Approved,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let result = backend
            .submit(ExecutionRequest {
                order,
                mode: ExecutionMode::Paper,
                capability: Capability::PaperTrade,
                correlation_id: "c1".into(),
                requested_at: Utc::now(),
            })
            .await
            .unwrap();
        assert!(result.accepted);
        let snapshot = backend.snapshot();
        assert_eq!(snapshot.open_orders().len(), 1);
        assert_eq!(snapshot.balance("idr").to_f64(), 100_000_000.0 - 1000.0);
    }

    #[tokio::test]
    async fn paper_cancel_refunds_reserved_quote() {
        let backend = PaperBackend::new(PaperState::with_defaults());
        let order = Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Price::from_f64(1000.0),
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state: OrderState::Approved,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let result = backend
            .submit(ExecutionRequest {
                order,
                mode: ExecutionMode::Paper,
                capability: Capability::PaperTrade,
                correlation_id: "c1".into(),
                requested_at: Utc::now(),
            })
            .await
            .unwrap();
        let paper_id = OrderId::new(result.exchange_order_id.unwrap()).unwrap();
        assert!(backend.cancel(&paper_id, None).await.unwrap());
        assert_eq!(backend.snapshot().balance("idr").to_f64(), 100_000_000.0);
    }
}
