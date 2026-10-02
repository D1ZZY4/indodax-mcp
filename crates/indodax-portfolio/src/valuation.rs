use indodax_core::{Money, Portfolio};
use rust_decimal::Decimal;
use std::collections::HashMap;

/// Portfolio valuation against a price map (`btc_idr` -> IDR price).
pub struct PortfolioService;

impl PortfolioService {
    pub fn equity_idr(portfolio: &Portfolio, prices_idr: &HashMap<String, f64>) -> Money {
        let mut total = Decimal::ZERO;
        for (code, balance) in &portfolio.balances {
            let amount = balance.total().value();
            if code == "idr" {
                total += amount;
            } else if let Some(price) = prices_idr.get(code).copied() {
                let price = Decimal::from_f64_retain(price).unwrap_or(Decimal::ZERO);
                total += amount * price;
            } else {
                let pair = format!("{code}_idr");
                if let Some(price) = prices_idr.get(&pair).copied() {
                    let price = Decimal::from_f64_retain(price).unwrap_or(Decimal::ZERO);
                    total += amount * price;
                }
            }
        }
        Money::new(total)
    }

    pub fn snapshot(portfolio: &Portfolio) -> serde_json::Value {
        serde_json::json!({
            "balances": portfolio.balances,
            "captured_at": chrono::Utc::now(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_core::Asset;
    use std::str::FromStr;

    #[test]
    fn values_btc_in_idr() {
        let mut portfolio = Portfolio::default();
        let asset = Asset::from_str("btc").unwrap();
        portfolio.set_available(asset, Money::from_f64(1.0).unwrap());
        let mut prices = HashMap::new();
        prices.insert("btc_idr".into(), 100.0);
        assert_eq!(PortfolioService::equity_idr(&portfolio, &prices).to_f64(), 100.0);
    }
}
