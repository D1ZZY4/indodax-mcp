use crate::{Money, OrderId, Price, Quantity, Symbol};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Order side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Order pricing strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderType {
    Limit,
    Market,
    StopLimit,
}

/// Explicit lifecycle. Exchange acknowledgement and completion stay separate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderState {
    Proposed,
    Validating,
    RiskCheck,
    Rejected,
    Approved,
    Submitting,
    SubmitFailed,
    Open,
    PartiallyFilled,
    Filled,
    CancelRequested,
    Cancelled,
    Expired,
    Unknown,
}

impl OrderState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Rejected | Self::SubmitFailed | Self::Filled | Self::Cancelled | Self::Expired
        )
    }

    pub fn is_open(self) -> bool {
        matches!(self, Self::Open | Self::PartiallyFilled)
    }
}

/// Canonical order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    pub id: OrderId,
    pub symbol: Symbol,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: Option<Price>,
    pub stop_price: Option<Price>,
    pub quantity: Quantity,
    pub remaining: Quantity,
    pub state: OrderState,
    pub client_order_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Order {
    pub fn notional(&self) -> Option<Money> {
        let price = self.price?;
        Some(Money::new(price.value() * self.quantity.value()))
    }
}

/// One execution fill against an order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fill {
    pub order_id: OrderId,
    pub fill_price: Price,
    pub fill_quantity: Quantity,
    pub fee: Money,
    pub filled_at: DateTime<Utc>,
}

impl Fill {
    pub fn notional(&self) -> Money {
        Money::new(self.fill_price.value() * self.fill_quantity.value())
    }
}

pub fn decimal_to_f64(value: Decimal) -> f64 {
    use rust_decimal::prelude::ToPrimitive;
    value.to_f64().unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_order(state: OrderState) -> Order {
        Order {
            id: OrderId::new("o1").unwrap(),
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            order_type: OrderType::Limit,
            price: Price::from_f64(100.0),
            stop_price: None,
            quantity: Quantity::from_f64(1.0).unwrap(),
            remaining: Quantity::from_f64(1.0).unwrap(),
            state,
            client_order_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn terminal_states() {
        assert!(OrderState::Filled.is_terminal());
        assert!(!OrderState::Open.is_terminal());
        assert!(OrderState::Open.is_open());
    }

    #[test]
    fn notional_math() {
        let order = sample_order(OrderState::Open);
        assert_eq!(order.notional().unwrap().to_f64(), 100.0);
    }
}
