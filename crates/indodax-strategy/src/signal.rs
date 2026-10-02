use indodax_core::{OrderSide, Symbol};
use serde::{Deserialize, Serialize};

/// Strategy output. Never an executable order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub symbol: Symbol,
    pub side: OrderSide,
    pub strength: f64,
    pub reason: String,
}

/// Draft intent derived from a signal, still subject to risk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeIntentDraft {
    pub signal: Signal,
    pub suggested_price: Option<f64>,
    pub suggested_quantity: Option<f64>,
}

pub fn moving_average(prices: &[f64], window: usize) -> Option<f64> {
    if window == 0 || prices.len() < window {
        return None;
    }
    let sum: f64 = prices[prices.len() - window..].iter().sum();
    Some(sum / window as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn average_window() {
        assert_eq!(moving_average(&[1.0, 2.0, 3.0], 3), Some(2.0));
        assert_eq!(moving_average(&[1.0], 3), None);
    }

    #[test]
    fn signal_holds_symbol() {
        let signal = Signal {
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: OrderSide::Buy,
            strength: 0.8,
            reason: "ma cross".into(),
        };
        assert_eq!(signal.symbol.as_pair(), "btc_idr");
    }
}
