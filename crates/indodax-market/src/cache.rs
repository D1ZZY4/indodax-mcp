use crate::types::MarketSnapshot;
use std::collections::HashMap;
use std::sync::RwLock;

/// In-memory snapshot cache with explicit staleness.
#[derive(Debug, Default)]
pub struct MarketCache {
    inner: RwLock<HashMap<String, MarketSnapshot>>,
}

impl MarketCache {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    pub fn insert(&self, snapshot: MarketSnapshot) {
        if let Ok(mut guard) = self.inner.write() {
            guard.insert(snapshot.symbol.as_pair(), snapshot);
        }
    }

    pub fn get(&self, pair: &str) -> Option<MarketSnapshot> {
        self.inner.read().ok()?.get(pair).cloned()
    }

    pub fn len(&self) -> usize {
        self.inner.read().map(|guard| guard.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Ticker;
    use chrono::Utc;
    use indodax_core::{Price, Symbol};
    use std::str::FromStr;

    #[test]
    fn insert_and_get() {
        let cache = MarketCache::new();
        assert!(cache.is_empty());
        let symbol = Symbol::from_str("btc_idr").unwrap();
        let snapshot = MarketSnapshot {
            symbol: symbol.clone(),
            ticker: Ticker {
                symbol,
                last: Price::from_f64(100.0).unwrap(),
                high: None,
                low: None,
                buy: None,
                sell: None,
                base_volume: None,
                quote_volume: None,
                fetched_at: Utc::now(),
            },
            fetched_at: Utc::now(),
            stale_after_secs: 30,
        };
        cache.insert(snapshot);
        assert_eq!(cache.len(), 1);
        assert!(cache.get("btc_idr").is_some());
    }
}
