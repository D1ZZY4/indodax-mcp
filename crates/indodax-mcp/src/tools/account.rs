use crate::server::V2Server;
use crate::McpResponse;
use indodax_account::AccountService;
use indodax_api::rest::IndodaxRest;
use rmcp::model::{CallToolResult, Tool};
use std::collections::HashMap;

/// Read-only account tools. Require credentials upstream.
pub struct AccountTools<'a> {
    service: AccountService<'a>,
}

impl<'a> AccountTools<'a> {
    pub fn new(rest: &'a IndodaxRest) -> Self {
        Self { service: AccountService::new(rest) }
    }

    pub async fn info(&self) -> McpResponse<serde_json::Value> {
        match self.service.info().await {
            Ok(info) => McpResponse::ok(serde_json::to_value(&info).unwrap_or_default()),
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }

    pub async fn open_orders(&self, pair: Option<&str>) -> McpResponse<serde_json::Value> {
        match self.service.open_orders_raw(pair).await {
            Ok(data) => McpResponse::ok(data),
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "account_info",
            "Read-only, needs credentials. Get account identity plus all balances. Fails with an authentication error when no API key is configured. Never exposes secret values.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "account_balances",
            "Read-only, needs credentials. Get non-zero balances only. Use for quick portfolio checks instead of the full account payload.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "account_open_orders",
            "Read-only, needs credentials. List open orders, optionally filtered by pair. Args: pair optional.",
            serde_json::json!({"pair": {"type": "string", "description": "Filter, e.g. btc_idr"}}),
            &[],
        ),
        V2Server::tool(
            "account_order_history",
            "Read-only, needs credentials. Order history for one symbol over the last day. Args: symbol default btc_idr, limit default 100. Minimum effective limit is 10.",
            serde_json::json!({
                "symbol": {"type": "string", "description": "Symbol, e.g. btc_idr"},
                "limit": {"type": "number", "description": "Max records, default 100"},
            }),
            &[],
        ),
        V2Server::tool(
            "account_trade_history",
            "Read-only, needs credentials. Executed fills for one symbol over the last day with price, quantity, and fees. Args: symbol default btc_idr, limit default 100.",
            serde_json::json!({
                "symbol": {"type": "string", "description": "Symbol, e.g. btc_idr"},
                "limit": {"type": "number", "description": "Max records, default 100"},
            }),
            &[],
        ),
        V2Server::tool(
            "account_transactions",
            "Read-only, needs credentials. Deposit and withdrawal history. Args: start and end as YYYY-MM-DD, window at most 7 days. Fails validation otherwise.",
            serde_json::json!({
                "start": {"type": "string", "description": "Start date YYYY-MM-DD"},
                "end": {"type": "string", "description": "End date YYYY-MM-DD"},
            }),
            &["start", "end"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    let rest = match server.authed_rest() {
        Ok(rest) => rest,
        Err(failure) => return Some(failure),
    };
    let service = AccountService::new(&rest);
    match name {
        "account_info" => Some(match service.info().await {
            Ok(info) => V2Server::ok(serde_json::to_value(&info).unwrap_or_default()),
            Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
        }),
        "account_balances" => Some(match service.info().await {
            Ok(info) => {
                let nonzero: Vec<_> = info
                    .portfolio
                    .balances
                    .iter()
                    .filter(|(_, balance)| !balance.total().is_zero())
                    .collect();
                V2Server::ok(serde_json::to_value(&nonzero).unwrap_or_default())
            }
            Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
        }),
        "account_open_orders" => {
            let pair = V2Server::get_str(args, "pair");
            Some(match service.open_orders_raw(pair.as_deref()).await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "account_order_history" => Some(history(&rest, args, "order").await),
        "account_trade_history" => Some(history(&rest, args, "trade").await),
        "account_transactions" => {
            let start = V2Server::get_str(args, "start").unwrap_or_default();
            let end = V2Server::get_str(args, "end").unwrap_or_default();
            Some(match service.trans_history(&start, &end).await {
                Ok(data) => V2Server::ok(data),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        _ => None,
    }
}

async fn history(
    rest: &indodax_api::rest::IndodaxRest,
    args: &serde_json::Map<String, serde_json::Value>,
    kind: &str,
) -> CallToolResult {
    let symbol = V2Server::get_str(args, "symbol").unwrap_or_else(|| "btc_idr".into());
    let symbol = match V2Server::parse_symbol(&symbol) {
        Ok(symbol) => symbol.as_compact(),
        Err(failure) => return failure,
    };
    let limit = V2Server::get_num(args, "limit").unwrap_or(100.0).max(10.0) as u64;
    let now = indodax_core::now_millis();
    let mut params = HashMap::new();
    params.insert("symbol".into(), symbol);
    params.insert("limit".into(), limit.to_string());
    params.insert("startTime".into(), (now - 86_400_000).to_string());
    params.insert("endTime".into(), now.to_string());
    let path = if kind == "order" { "/api/v2/order/histories" } else { "/api/v2/myTrades" };
    match rest.private_get_v2::<serde_json::Value>(path, &params).await {
        Ok(data) => V2Server::ok(data),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_construct() {
        let rest = IndodaxRest::public_client(7).unwrap();
        let _ = AccountTools::new(&rest);
    }
}
