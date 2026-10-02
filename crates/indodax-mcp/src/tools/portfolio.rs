use crate::server::V2Server;
use indodax_core::{Asset, Money, Portfolio};
use indodax_portfolio::PortfolioService;
use rmcp::model::{CallToolResult, Tool};
use rust_decimal::prelude::ToPrimitive;
use std::collections::HashMap;
use std::str::FromStr;

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "portfolio_get",
            "Read-only. Paper portfolio valuation in IDR using live market prices. Takes no arguments. Balances come from local simulation, prices from the live exchange. Never touches real money.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "portfolio_positions",
            "Read-only. Paper positions measured against initial balances, showing per-asset profit and loss. Takes no arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "portfolio_pnl",
            "Read-only. Total paper profit and loss in IDR at current live prices. Takes no arguments. Positive means profit since session start.",
            serde_json::json!({}),
            &[],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "portfolio_get" | "portfolio_positions" | "portfolio_pnl" => {
            Some(valuation(server, name).await)
        }
        _ => None,
    }
}

async fn valuation(server: &V2Server, name: &str) -> CallToolResult {
    let snapshot = server.paper.snapshot();
    let mut portfolio = Portfolio::default();
    for (code, amount) in &snapshot.balances {
        if let Ok(asset) = Asset::from_str(code) {
            if let Some(money) = amount.to_f64().and_then(Money::from_f64) {
                portfolio.set_available(asset, money);
            }
        }
    }
    let mut initial = Portfolio::default();
    for (code, amount) in &snapshot.initial_balances {
        if let Ok(asset) = Asset::from_str(code) {
            if let Some(money) = amount.to_f64().and_then(Money::from_f64) {
                initial.set_available(asset, money);
            }
        }
    }
    let prices = live_prices(server, &portfolio).await;
    let equity = PortfolioService::equity_idr(&portfolio, &prices);
    let positions = portfolio.positions_against(&initial);
    let total_pnl: f64 = positions.iter().map(|position| position.pnl().to_f64()).sum();
    match name {
        "portfolio_positions" => V2Server::ok(serde_json::to_value(&positions).unwrap_or_default()),
        "portfolio_pnl" => V2Server::ok(serde_json::json!({
            "equity_idr": equity.to_f64(),
            "total_pnl": total_pnl,
            "positions": positions.len(),
        })),
        _ => V2Server::ok(serde_json::json!({
            "balances": portfolio.balances,
            "equity_idr": equity.to_f64(),
            "total_pnl": total_pnl,
            "price_assets": prices.len(),
        })),
    }
}

async fn live_prices(server: &V2Server, portfolio: &Portfolio) -> HashMap<String, f64> {
    let mut prices = HashMap::new();
    for code in portfolio.balances.keys() {
        if code == "idr" {
            continue;
        }
        let path = format!("/api/ticker/{code}_idr");
        if let Ok(data) = server.rest.public_get::<serde_json::Value>(&path).await {
            let last = data
                .get("ticker")
                .and_then(|ticker| ticker.get("last"))
                .and_then(|last| {
                    last.as_str()
                        .and_then(|text| text.parse::<f64>().ok())
                        .or_else(|| last.as_f64())
                })
                .unwrap_or(0.0);
            if last > 0.0 {
                prices.insert(format!("{code}_idr"), last);
            }
        }
    }
    prices
}
