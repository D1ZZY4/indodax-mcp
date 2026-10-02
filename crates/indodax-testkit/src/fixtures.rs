use chrono::Utc;
use indodax_core::{Order, OrderId, OrderSide, OrderState, OrderType, Price, Quantity, Symbol};
use std::str::FromStr;

pub fn sample_symbol() -> Symbol {
    Symbol::from_str("btc_idr").expect("valid fixture symbol")
}

pub fn sample_order() -> Order {
    Order {
        id: OrderId::new("fixture-1").expect("valid fixture id"),
        symbol: sample_symbol(),
        side: OrderSide::Buy,
        order_type: OrderType::Limit,
        price: Price::from_f64(1000.0),
        stop_price: None,
        quantity: Quantity::from_f64(0.5).expect("valid fixture quantity"),
        remaining: Quantity::from_f64(0.5).expect("valid fixture quantity"),
        state: OrderState::Proposed,
        client_order_id: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_is_valid() {
        let order = sample_order();
        assert_eq!(order.symbol.as_pair(), "btc_idr");
        assert!(order.notional().is_some());
    }
}
