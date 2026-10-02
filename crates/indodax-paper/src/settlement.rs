use crate::engine::PaperBackend;
use indodax_core::{IndodaxError, OrderId};
use rust_decimal::Decimal;

/// Settlement operations on open paper orders: fill, topup, reset.
impl PaperBackend {
    /// Fill an open order at the given price. Settles balances and fees.
    pub fn fill(&self, order_id: &OrderId, fill_price: Decimal) -> Result<Decimal, IndodaxError> {
        if fill_price <= Decimal::ZERO {
            return Err(IndodaxError::Validation("fill price must be positive".into()));
        }
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        let index = guard
            .orders
            .iter()
            .position(|order| &order.id == order_id)
            .ok_or_else(|| IndodaxError::StateConflict("paper order not found".into()))?;
        if guard.orders[index].state != "open" {
            return Err(IndodaxError::StateConflict("only open orders can be filled".into()));
        }
        let record = guard.orders[index].clone();
        let base = record.symbol.base().code().to_string();
        let quote = record.symbol.quote().code().to_string();
        let notional = fill_price * record.remaining;
        let fee = notional * PaperBackend::fee_rate();
        if record.side == "buy" {
            let quote_balance = guard.balances.get(&quote).copied().unwrap_or(Decimal::ZERO);
            if quote_balance < fee {
                return Err(IndodaxError::StateConflict("insufficient paper quote for fee".into()));
            }
            *guard.balances.entry(base).or_insert(Decimal::ZERO) += record.remaining;
            *guard.balances.entry(quote).or_insert(Decimal::ZERO) -= fee;
        } else if record.side == "sell" {
            *guard.balances.entry(quote).or_insert(Decimal::ZERO) += notional - fee;
        } else {
            return Err(IndodaxError::Validation("unknown paper order side".into()));
        }
        guard.orders[index].remaining = Decimal::ZERO;
        guard.orders[index].state = "filled".into();
        guard.orders[index].filled_price = Some(fill_price);
        guard.orders[index].fee_paid = fee;
        guard.total_fees += fee;
        Ok(fee)
    }

    /// Add funds to a paper asset. Used for topups and test setup.
    pub fn topup(&self, asset: &str, amount: Decimal) -> Result<Decimal, IndodaxError> {
        if amount <= Decimal::ZERO {
            return Err(IndodaxError::Validation("topup amount must be positive".into()));
        }
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        let entry = guard.balances.entry(asset.to_lowercase()).or_insert(Decimal::ZERO);
        *entry += amount;
        Ok(*entry)
    }

    /// Reset paper state to defaults.
    pub fn reset(&self) -> Result<(), IndodaxError> {
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        *guard = crate::PaperState::with_defaults();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PaperState;

    fn funded_backend() -> PaperBackend {
        PaperBackend::new(PaperState::with_defaults())
    }

    #[test]
    fn fill_buy_settles_base_and_fee() {
        let backend = funded_backend();
        backend.topup("btc", Decimal::ZERO).unwrap_err();
        let id = {
            let mut guard = backend.state.write().unwrap();
            guard.orders.push(crate::state::PaperOrderRecord {
                id: OrderId::new("paper-1").unwrap(),
                symbol: "btc_idr".parse().unwrap(),
                side: "buy".into(),
                price: Some(Decimal::new(1000, 0)),
                quantity: Decimal::ONE,
                remaining: Decimal::ONE,
                state: "open".into(),
                created_at: chrono::Utc::now(),
                filled_price: None,
                fee_paid: Decimal::ZERO,
            });
            OrderId::new("paper-1").unwrap()
        };
        // Reserve quote manually to mirror submit behavior.
        {
            let mut guard = backend.state.write().unwrap();
            *guard.balances.get_mut("idr").unwrap() -= Decimal::new(1000, 0);
        }
        let fee = backend.fill(&id, Decimal::new(1000, 0)).unwrap();
        assert!(fee > Decimal::ZERO);
        let snapshot = backend.snapshot();
        assert_eq!(snapshot.balance("btc").to_f64(), 2.0);
        assert_eq!(snapshot.open_orders().len(), 0);
    }

    #[test]
    fn fill_rejects_unknown_and_closed() {
        let backend = funded_backend();
        let missing = OrderId::new("paper-9").unwrap();
        assert!(backend.fill(&missing, Decimal::ONE).is_err());
        assert!(backend.fill(&missing, Decimal::ZERO).is_err());
    }

    #[test]
    fn topup_and_reset() {
        let backend = funded_backend();
        let balance = backend.topup("usdt", Decimal::new(500, 0)).unwrap();
        assert_eq!(balance, Decimal::new(500, 0));
        backend.reset().unwrap();
        assert!(!backend.snapshot().balances.contains_key("usdt"));
    }
}
