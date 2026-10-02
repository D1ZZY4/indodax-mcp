use crate::server::V2Server;
use indodax_order::{Reconciler, ReconciliationState};
use rmcp::model::{CallToolResult, Tool};
use rust_decimal::prelude::ToPrimitive;
use std::collections::HashMap;

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "reconcile_orders",
            "Read-only analysis. Compare open paper orders with live market prices and flag fillable ones. Takes no arguments. Detects divergence without mutating state.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "reconcile_status",
            "Read-only. Report paper ledger internal consistency: reserved funds versus open order notionals. Takes no arguments. Mismatch halts trading-facing tools via risk.",
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
        "reconcile_orders" => Some(reconcile_orders(server).await),
        "reconcile_status" => Some(reconcile_status(server)),
        _ => None,
    }
}

async fn reconcile_orders(server: &V2Server) -> CallToolResult {
    use indodax_market::MarketService;
    let service = MarketService::new(&server.rest, &server.cache);
    let snapshot = server.paper.snapshot();
    let mut rows = Vec::new();
    for order in snapshot.orders.iter().filter(|order| order.state == "open") {
        let market = match service.ticker(&order.symbol.as_pair()).await {
            Ok(ticker) => Some(ticker.last.to_f64()),
            Err(_) => None,
        };
        let limit = order.price.and_then(|price| price.to_f64()).unwrap_or(0.0);
        let fillable = match (market, order.side.as_str()) {
            (Some(market), "buy") => market <= limit,
            (Some(market), "sell") => market >= limit,
            _ => false,
        };
        rows.push(serde_json::json!({
            "order_id": order.id.value(),
            "state": order.state,
            "limit": limit,
            "market": market,
            "fillable": fillable,
        }));
    }
    V2Server::ok(serde_json::json!({"checked": rows.len(), "orders": rows}))
}

fn reconcile_status(server: &V2Server) -> CallToolResult {
    let snapshot = server.paper.snapshot();
    let mut reserved: HashMap<String, rust_decimal::Decimal> = HashMap::new();
    for order in snapshot.orders.iter().filter(|order| order.state == "open") {
        let quote = order.symbol.quote().code().to_string();
        let locked = order.price.unwrap_or(rust_decimal::Decimal::ZERO) * order.remaining;
        *reserved.entry(quote).or_insert(rust_decimal::Decimal::ZERO) += locked;
    }
    let local: HashMap<indodax_core::OrderId, String> = snapshot
        .orders
        .iter()
        .filter(|order| order.state == "open")
        .filter_map(|order| {
            indodax_core::OrderId::new(order.id.value()).map(|id| (id, order.state.clone()))
        })
        .collect();
    let exchange: Vec<String> = local.keys().map(|id| id.value().to_string()).collect();
    let outcome = Reconciler::compare_orders(&local, &exchange);
    let state = if outcome.state == ReconciliationState::Match { "match" } else { "mismatch" };
    V2Server::ok(serde_json::json!({
        "state": state,
        "checked_orders": outcome.checked_orders,
        "reserved_quote_assets": reserved.len(),
    }))
}
