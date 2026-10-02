use chrono::{DateTime, Utc};
use indodax_core::{Money, OrderId, Price, Quantity, Symbol};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperOrderView {
    pub id: OrderId,
    pub symbol: Symbol,
    pub side: String,
    pub price: Option<Price>,
    pub quantity: Quantity,
    pub remaining: Quantity,
    pub state: String,
    pub created_at: DateTime<Utc>,
}

/// Deterministic paper state with decimal balances.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaperState {
    pub balances: BTreeMap<String, Decimal>,
    pub orders: Vec<PaperOrderRecord>,
    pub next_order_id: u64,
    pub trade_count: u64,
    pub total_fees: Decimal,
    pub initial_balances: BTreeMap<String, Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperOrderRecord {
    pub id: OrderId,
    pub symbol: Symbol,
    pub side: String,
    pub price: Option<Decimal>,
    pub quantity: Decimal,
    pub remaining: Decimal,
    pub state: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub filled_price: Option<Decimal>,
    #[serde(default)]
    pub fee_paid: Decimal,
}

impl PaperState {
    pub fn with_defaults() -> Self {
        let mut balances = BTreeMap::new();
        balances.insert("idr".into(), Decimal::new(100_000_000, 0));
        balances.insert("btc".into(), Decimal::ONE);
        Self {
            initial_balances: balances.clone(),
            balances,
            orders: Vec::new(),
            next_order_id: 1,
            trade_count: 0,
            total_fees: Decimal::ZERO,
        }
    }

    pub fn balance(&self, asset: &str) -> Money {
        Money::new(self.balances.get(asset).copied().unwrap_or(Decimal::ZERO))
    }

    pub fn open_orders(&self) -> Vec<&PaperOrderRecord> {
        self.orders.iter().filter(|order| order.state == "open").collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_hold_idr_and_btc() {
        let state = PaperState::with_defaults();
        assert_eq!(state.balance("idr").to_f64(), 100_000_000.0);
        assert!(state.open_orders().is_empty());
    }
}
