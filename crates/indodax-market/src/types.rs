use chrono::{DateTime, Utc};
use indodax_core::{Price, Quantity, Symbol};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: Symbol,
    pub last: Price,
    pub high: Option<Price>,
    pub low: Option<Price>,
    pub buy: Option<Price>,
    pub sell: Option<Price>,
    pub base_volume: Option<Quantity>,
    pub quote_volume: Option<Quantity>,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderBookLevel {
    pub price: Price,
    pub quantity: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: Symbol,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candle {
    pub symbol: Symbol,
    pub open: Price,
    pub high: Price,
    pub low: Price,
    pub close: Price,
    pub volume: Quantity,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketSnapshot {
    pub symbol: Symbol,
    pub ticker: Ticker,
    pub fetched_at: DateTime<Utc>,
    pub stale_after_secs: u64,
}

impl MarketSnapshot {
    pub fn is_stale(&self, now: DateTime<Utc>) -> bool {
        (now - self.fetched_at).num_seconds() > self.stale_after_secs as i64
    }
}
