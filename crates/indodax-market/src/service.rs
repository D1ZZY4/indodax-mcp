use crate::{normalize_symbol, MarketCache, MarketSnapshot, Ticker};
use chrono::Utc;
use indodax_api::rest::IndodaxRest;
use indodax_api::PublicApi;
use indodax_core::{IndodaxError, Price, Symbol};

/// Market read service over the shared REST client.
pub struct MarketService<'a> {
    rest: &'a IndodaxRest,
    cache: &'a MarketCache,
}

impl<'a> MarketService<'a> {
    pub fn new(rest: &'a IndodaxRest, cache: &'a MarketCache) -> Self {
        Self { rest, cache }
    }

    pub async fn server_time(&self) -> Result<serde_json::Value, IndodaxError> {
        self.rest.public_get(PublicApi::SERVER_TIME).await
    }

    pub async fn pairs(&self) -> Result<serde_json::Value, IndodaxError> {
        self.rest.public_get(PublicApi::PAIRS).await
    }

    pub async fn ticker(&self, pair: &str) -> Result<Ticker, IndodaxError> {
        let symbol = normalize_symbol(pair)
            .ok_or_else(|| IndodaxError::Validation(format!("invalid pair: {pair}")))?;
        let path = PublicApi::ticker(&symbol.as_pair());
        let raw: serde_json::Value = self.rest.public_get(&path).await?;
        let ticker = parse_ticker(&symbol, &raw)?;
        self.cache.insert(MarketSnapshot {
            symbol: symbol.clone(),
            ticker: ticker.clone(),
            fetched_at: Utc::now(),
            stale_after_secs: 30,
        });
        Ok(ticker)
    }

    pub async fn order_book_raw(&self, pair: &str) -> Result<serde_json::Value, IndodaxError> {
        let symbol = normalize_symbol(pair)
            .ok_or_else(|| IndodaxError::Validation(format!("invalid pair: {pair}")))?;
        self.rest.public_get(&PublicApi::depth(&symbol.as_pair())).await
    }
}

fn parse_ticker(symbol: &Symbol, raw: &serde_json::Value) -> Result<Ticker, IndodaxError> {
    let node = raw.get("ticker").unwrap_or(raw);
    let last = read_price(node, "last")?;
    Ok(Ticker {
        symbol: symbol.clone(),
        last,
        high: read_price_opt(node, "high"),
        low: read_price_opt(node, "low"),
        buy: read_price_opt(node, "buy"),
        sell: read_price_opt(node, "sell"),
        base_volume: None,
        quote_volume: None,
        fetched_at: Utc::now(),
    })
}

fn read_price(node: &serde_json::Value, key: &str) -> Result<Price, IndodaxError> {
    read_price_opt(node, key).ok_or_else(|| IndodaxError::Exchange(format!("ticker missing {key}")))
}

fn read_price_opt(node: &serde_json::Value, key: &str) -> Option<Price> {
    let value = node.get(key)?;
    let number =
        value.as_str().and_then(|text| text.parse::<f64>().ok()).or_else(|| value.as_f64())?;
    Price::from_f64(number)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v1_ticker_shape() {
        let symbol = normalize_symbol("btc_idr").unwrap();
        let raw = serde_json::json!({"ticker": {"last": "100", "high": "110"}});
        let ticker = parse_ticker(&symbol, &raw).unwrap();
        assert_eq!(ticker.last.to_f64(), 100.0);
    }
}
