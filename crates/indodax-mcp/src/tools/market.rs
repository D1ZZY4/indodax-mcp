use crate::server::V2Server;
use crate::McpResponse;
use indodax_api::rest::IndodaxRest;
use indodax_core::{ErrorCategory, IndodaxError};
use indodax_market::MarketService;
use rmcp::model::{CallToolResult, Tool};

/// Read-only market tools. No auth, no mutation.
pub struct MarketTools<'a> {
    service: MarketService<'a>,
}

impl<'a> MarketTools<'a> {
    pub fn new(rest: &'a IndodaxRest, cache: &'a indodax_market::MarketCache) -> Self {
        Self { service: MarketService::new(rest, cache) }
    }

    pub async fn server_time(&self) -> McpResponse<serde_json::Value> {
        match self.service.server_time().await {
            Ok(data) => McpResponse::ok(data),
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }

    pub async fn ticker(&self, pair: &str) -> McpResponse<serde_json::Value> {
        if pair.trim().is_empty() {
            return McpResponse::fail(ErrorCategory::Validation, "pair is required".into());
        }
        match self.service.ticker(pair).await {
            Ok(ticker) => McpResponse::ok(serde_json::to_value(&ticker).unwrap_or_default()),
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }

    pub async fn pairs(&self) -> McpResponse<serde_json::Value> {
        match self.service.pairs().await {
            Ok(data) => McpResponse::ok(data),
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }

    pub async fn describe() -> Vec<ToolDoc> {
        vec![
            ToolDoc::read_only(
                "market_server_time",
                "Get Indodax server time. Read-only. No arguments. Use for clock sync.",
            ),
            ToolDoc::read_only(
                "market_ticker",
                "Get last price and 24h stats for one pair. Read-only. Args: pair (e.g. btc_idr).",
            ),
            ToolDoc::read_only("market_pairs", "List all trading pairs. Read-only. No arguments."),
        ]
    }
}

#[derive(Debug, Clone)]
pub struct ToolDoc {
    pub name: &'static str,
    pub description: &'static str,
    pub read_only: bool,
}

impl ToolDoc {
    pub fn read_only(name: &'static str, description: &'static str) -> Self {
        Self { name, description, read_only: true }
    }
}

pub fn map_error(error: IndodaxError) -> McpResponse<serde_json::Value> {
    McpResponse::fail(error.category(), error.to_string())
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "market_server_time",
            "Read-only. Get the Indodax exchange server time. Takes no arguments. Use it to check clock skew before signing private requests. Returns timezone and server_time in milliseconds. Fails only on network or exchange errors.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "market_ticker",
            "Read-only. Get the live last price and 24h statistics for exactly one trading pair. Use when you need a current price. Args: pair as base_quote lowercase, e.g. btc_idr. Accepts btc/idr and BTCIDR spellings. Returns last, high, low, buy, sell with a fetch timestamp. Fails validation on unknown pairs.",
            serde_json::json!({"pair": {"type": "string", "description": "Trading pair, e.g. btc_idr"}}),
            &[],
        ),
        V2Server::tool(
            "market_ticker_all",
            "Read-only. Get tickers for every Indodax pair in one call. Use for scans and breadth checks, not for single-pair prices. Takes no arguments. Returns the full raw tickers object, which is large.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "market_pairs",
            "Read-only. List every Indodax trading pair. Takes no arguments. Use to discover valid pair spellings before calling pair-scoped tools.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "market_orderbook",
            "Read-only. Get bid and ask depth for one pair. Args: pair, optional levels from 1 to 100 defaulting to 20. Returns raw buy and sell arrays. Use to judge spread and liquidity.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Trading pair, e.g. btc_idr"},
                "levels": {"type": "number", "description": "Depth levels 1 to 100, default 20"},
            }),
            &[],
        ),
        V2Server::tool(
            "market_trades",
            "Read-only. Get recent public trades for one pair. Args: pair. Returns trade id, time, price, amount, and side. Use to observe tape activity.",
            serde_json::json!({"pair": {"type": "string", "description": "Trading pair, e.g. btc_idr"}}),
            &[],
        ),
        V2Server::tool(
            "market_candles",
            "Read-only. Get OHLCV candles for one pair over a time range. Args: symbol, timeframe in minutes default 60, from and to as unix seconds defaulting to the last 24h. Returns TradingView history arrays. Use for chart and backtest inputs.",
            serde_json::json!({
                "symbol": {"type": "string", "description": "Pair compact or underscore, e.g. BTCIDR"},
                "timeframe": {"type": "string", "description": "Minutes per candle, default 60"},
                "from": {"type": "number", "description": "Range start unix seconds"},
                "to": {"type": "number", "description": "Range end unix seconds"},
            }),
            &[],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    let rest = &server.rest;
    let pair = V2Server::get_str(args, "pair").unwrap_or_else(|| "btc_idr".into());
    match name {
        "market_server_time" => {
            Some(match rest.public_get::<serde_json::Value>("/api/server_time").await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "market_ticker" => Some(server_ticker(server, &pair).await),
        "market_ticker_all" => {
            Some(match rest.public_get::<serde_json::Value>("/api/ticker_all").await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "market_pairs" => Some(match rest.public_get::<serde_json::Value>("/api/pairs").await {
            Ok(data) => V2Server::ok(data),
            Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
        }),
        "market_orderbook" => {
            let levels =
                V2Server::get_num(args, "levels").unwrap_or(20.0).clamp(1.0, 100.0) as usize;
            let symbol = match V2Server::parse_symbol(&pair) {
                Ok(symbol) => symbol,
                Err(failure) => return Some(failure),
            };
            let path = format!("/api/depth/{}", symbol.as_pair());
            Some(match rest.public_get::<serde_json::Value>(&path).await {
                Ok(data) => V2Server::ok(trim_depth(data, levels)),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "market_trades" => {
            let symbol = match V2Server::parse_symbol(&pair) {
                Ok(symbol) => symbol,
                Err(failure) => return Some(failure),
            };
            let path = format!("/api/trades/{}", symbol.as_compact());
            Some(match rest.public_get::<serde_json::Value>(&path).await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "market_candles" => Some(candles(server, args).await),
        _ => None,
    }
}

async fn server_ticker(server: &V2Server, pair: &str) -> CallToolResult {
    let service = MarketService::new(&server.rest, &server.cache);
    match service.ticker(pair).await {
        Ok(ticker) => V2Server::ok(serde_json::to_value(&ticker).unwrap_or_default()),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

async fn candles(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let raw_symbol = V2Server::get_str(args, "symbol").unwrap_or_else(|| "BTCIDR".into());
    let symbol = match V2Server::parse_symbol(&raw_symbol) {
        Ok(symbol) => symbol.as_compact().to_uppercase(),
        Err(failure) => return failure,
    };
    let timeframe = V2Server::get_str(args, "timeframe").unwrap_or_else(|| "60".into());
    let now = indodax_core::now_secs();
    let from = V2Server::get_num(args, "from").unwrap_or((now - 86400) as f64).to_string();
    let to = V2Server::get_num(args, "to").unwrap_or(now as f64).to_string();
    match server
        .rest
        .public_get_with_params(
            "/tradingview/history_v2",
            &[
                ("symbol", symbol.as_str()),
                ("tf", timeframe.as_str()),
                ("from", from.as_str()),
                ("to", to.as_str()),
            ],
        )
        .await
    {
        Ok(data) => V2Server::ok(data),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

fn trim_depth(mut data: serde_json::Value, levels: usize) -> serde_json::Value {
    for key in ["buy", "sell"] {
        if let Some(rows) = data.get_mut(key).and_then(|rows| rows.as_array_mut()) {
            rows.truncate(levels);
        }
    }
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_blank_pair() {
        let rest = IndodaxRest::public_client(7).unwrap();
        let cache = indodax_market::MarketCache::new();
        let tools = MarketTools::new(&rest, &cache);
        let response = tools.ticker("").await;
        assert_eq!(response.status, "error");
    }
}
