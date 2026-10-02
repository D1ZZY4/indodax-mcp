use crate::server::V2Server;
use indodax_core::OrderId;
use rmcp::model::{CallToolResult, Tool};
use rust_decimal::prelude::ToPrimitive;
use std::collections::HashMap;

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "order_get",
            "Read-only, needs credentials. Get one live order by numeric id and pair. Args: order_id required, pair required. Distinguishes open, filled, and cancelled states from the exchange payload.",
            serde_json::json!({
                "order_id": {"type": "number", "description": "Exchange order id"},
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
            }),
            &["order_id", "pair"],
        ),
        V2Server::tool(
            "paper_order_get",
            "Read-only. Get one paper order by id from local simulation state. Args: order_id required, e.g. paper-1.",
            serde_json::json!({"order_id": {"type": "string", "description": "Paper order id"}}),
            &["order_id"],
        ),
        V2Server::tool(
            "order_reconcile",
            "Read-only analysis. Compare one paper order against the live market price and report whether it is fillable now. Args: order_id required. Does not mutate anything.",
            serde_json::json!({"order_id": {"type": "string", "description": "Paper order id"}}),
            &["order_id"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "order_get" => {
            let rest = match server.authed_rest() {
                Ok(rest) => rest,
                Err(failure) => return Some(failure),
            };
            let id = match V2Server::get_num(args, "order_id") {
                Some(id) if id.fract() == 0.0 => id as u64,
                _ => {
                    return Some(V2Server::fail(
                        "validation",
                        "order_id must be a whole number".into(),
                    ))
                }
            };
            let pair = V2Server::get_str(args, "pair").unwrap_or_default();
            let pair = match V2Server::parse_symbol(&pair) {
                Ok(pair) => pair.as_pair(),
                Err(failure) => return Some(failure),
            };
            let mut params = HashMap::new();
            params.insert("order_id".into(), id.to_string());
            params.insert("pair".into(), pair);
            Some(match rest.private_post_v1::<serde_json::Value>("getOrder", &params).await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "paper_order_get" | "order_reconcile" => {
            let snapshot = server.paper.snapshot();
            let id = V2Server::get_str(args, "order_id").unwrap_or_default();
            let order_id = match OrderId::new(&id) {
                Some(order_id) => order_id,
                None => return Some(V2Server::fail("validation", "order_id is required".into())),
            };
            let order = snapshot.orders.iter().find(|order| order.id == order_id);
            match order {
                None => {
                    Some(V2Server::fail("state_conflict", format!("paper order {id} not found")))
                }
                Some(order) if name == "paper_order_get" => {
                    Some(V2Server::ok(serde_json::to_value(order).unwrap_or_default()))
                }
                Some(order) => Some(reconcile_against_market(server, order).await),
            }
        }
        _ => None,
    }
}

async fn reconcile_against_market(
    server: &V2Server,
    order: &indodax_paper::state::PaperOrderRecord,
) -> CallToolResult {
    use indodax_market::MarketService;
    if order.state != "open" {
        return V2Server::ok(serde_json::json!({
            "order_id": order.id.value(),
            "state": order.state,
            "fillable": false,
            "reason": "order is not open",
        }));
    }
    let service = MarketService::new(&server.rest, &server.cache);
    let market = match service.ticker(&order.symbol.as_pair()).await {
        Ok(ticker) => ticker.last.to_f64(),
        Err(error) => {
            return V2Server::fail(&error.category().to_string(), error.to_string());
        }
    };
    let limit = order.price.and_then(|price| price.to_f64()).unwrap_or(0.0);
    let fillable = match order.side.as_str() {
        "buy" => market <= limit,
        "sell" => market >= limit,
        _ => false,
    };
    V2Server::ok(serde_json::json!({
        "order_id": order.id.value(),
        "state": order.state,
        "limit": limit,
        "market": market,
        "fillable": fillable,
    }))
}
