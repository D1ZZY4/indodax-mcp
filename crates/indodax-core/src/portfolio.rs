use crate::{Asset, Money};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One asset balance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Balance {
    pub asset: Asset,
    pub available: Money,
    pub locked: Money,
}

impl Balance {
    pub fn total(&self) -> Money {
        Money::new(self.available.value() + self.locked.value())
    }
}

/// Position in one asset, tracked against an initial reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub asset: Asset,
    pub current: Money,
    pub initial: Money,
}

impl Position {
    pub fn pnl(&self) -> Money {
        Money::new(self.current.value() - self.initial.value())
    }
}

/// Portfolio snapshot across balances.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Portfolio {
    pub balances: BTreeMap<String, Balance>,
}

impl Portfolio {
    pub fn balance(&self, asset: &Asset) -> Money {
        self.balances.get(asset.code()).map(Balance::total).unwrap_or_else(Money::zero)
    }

    pub fn set_available(&mut self, asset: Asset, available: Money) {
        self.balances
            .entry(asset.code().to_string())
            .and_modify(|entry| entry.available = available)
            .or_insert(Balance { asset, available, locked: Money::zero() });
    }

    pub fn positions_against(&self, initial: &Portfolio) -> Vec<Position> {
        let mut out = Vec::new();
        for (code, balance) in &self.balances {
            let current = balance.total();
            let start = initial.balances.get(code).map(Balance::total).unwrap_or_else(Money::zero);
            if !current.is_zero() || !start.is_zero() {
                if let Some(asset) = Asset::new(code) {
                    out.push(Position { asset, current, initial: start });
                }
            }
        }
        out
    }
}

pub fn decimal(value: f64) -> Decimal {
    Decimal::from_f64_retain(value).unwrap_or(Decimal::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn portfolio_pnl() {
        let mut current = Portfolio::default();
        let mut initial = Portfolio::default();
        let asset = Asset::from_str("btc").unwrap();
        current.set_available(asset.clone(), Money::from_f64(1.5).unwrap());
        initial.set_available(asset.clone(), Money::from_f64(1.0).unwrap());
        let positions = current.positions_against(&initial);
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].pnl().to_f64(), 0.5);
    }
}
