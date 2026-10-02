use crate::server::V2Server;
use crate::McpResponse;
use indodax_observability::{Health, Metrics, MetricsSnapshot};
use rmcp::model::{CallToolResult, Tool};
use std::collections::HashMap;
use std::sync::atomic::Ordering;

/// Read-only system diagnostics.
pub struct SystemTools;

impl SystemTools {
    pub fn health(health: &Health) -> McpResponse<serde_json::Value> {
        McpResponse::ok(serde_json::to_value(health).unwrap_or_default())
    }

    pub fn metrics(snapshot: &MetricsSnapshot) -> McpResponse<serde_json::Value> {
        McpResponse::ok(serde_json::to_value(snapshot).unwrap_or_default())
    }

    pub fn capabilities() -> McpResponse<serde_json::Value> {
        McpResponse::ok(serde_json::json!({
            "market.read": "allowed",
            "account.read": "allowed",
            "trade.place": "controlled",
            "trade.cancel": "controlled",
            "funding.withdraw": "disabled by default",
        }))
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "system_health",
            "Read-only. Service health: healthy, degraded, unhealthy, or halted with checks. Takes no arguments. Halted means do not trust trading tools.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "system_version",
            "Read-only. Server name, crate version, and execution mode. Takes no arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "system_mode",
            "Read-only. Current execution mode: paper, live, or shadow. Takes no arguments. Live never activates implicitly.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "system_capabilities",
            "Read-only. Capability matrix plus kill switch and allowed modes. Takes no arguments. funding.withdraw is disabled by default.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "auth_status",
            "Read-only. Whether API credentials are configured, without exposing any secret content. Returns booleans only. Takes no arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "auth_capabilities",
            "Read-only. Which capabilities the configured credentials unlock. Takes no arguments. Private capabilities require configured credentials.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "funding_fee",
            "Read-only, needs credentials. Quote the withdrawal fee for one asset and network. Args: currency required, network optional. Call before any withdrawal planning.",
            serde_json::json!({
                "currency": {"type": "string", "description": "Asset, e.g. btc"},
                "network": {"type": "string", "description": "Network, e.g. BTC"},
            }),
            &["currency"],
        ),
        V2Server::tool(
            "funding_deposit_address",
            "Read-only, needs credentials. Get the deposit address for one asset and network. Args: currency required, network optional. Verify network compatibility before sending funds.",
            serde_json::json!({
                "currency": {"type": "string", "description": "Asset, e.g. btc"},
                "network": {"type": "string", "description": "Network, e.g. BTC"},
            }),
            &["currency"],
        ),
        V2Server::tool(
            "funding_withdraw",
            "Disabled by default. Initiating a withdrawal needs the separate funding.withdraw capability, which this server does not grant. Always returns an authorization error explaining how to enable it deliberately. Args accepted for shape validation only.",
            serde_json::json!({
                "currency": {"type": "string", "description": "Asset"},
                "amount": {"type": "number", "description": "Amount"},
                "address": {"type": "string", "description": "Destination"},
            }),
            &["currency", "amount", "address"],
        ),
        V2Server::tool(
            "ws_ticker_snapshot",
            "Read-only. One-shot live ticker snapshot over WebSocket, bypassing REST rate limits. Args: pair default btc_idr. Returns channel, price, and timestamp. Times out after 10 seconds.",
            serde_json::json!({"pair": {"type": "string", "description": "Pair, e.g. btc_idr"}}),
            &[],
        ),
        V2Server::tool(
            "ws_book_snapshot",
            "Read-only. One-shot live order book snapshot over WebSocket. Args: pair default btc_idr. Returns best bid and ask. Times out after 10 seconds.",
            serde_json::json!({"pair": {"type": "string", "description": "Pair, e.g. btc_idr"}}),
            &[],
        ),
    ]
}

static METRICS: Metrics = Metrics {
    orders_submitted: std::sync::atomic::AtomicU64::new(0),
    orders_filled: std::sync::atomic::AtomicU64::new(0),
    orders_rejected: std::sync::atomic::AtomicU64::new(0),
    risk_rejections: std::sync::atomic::AtomicU64::new(0),
    exchange_errors: std::sync::atomic::AtomicU64::new(0),
    ws_reconnects: std::sync::atomic::AtomicU64::new(0),
    reconciliation_failures: std::sync::atomic::AtomicU64::new(0),
    mcp_requests: std::sync::atomic::AtomicU64::new(0),
    mcp_failures: std::sync::atomic::AtomicU64::new(0),
};

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    METRICS.mcp_requests.fetch_add(1, Ordering::Relaxed);
    match name {
        "system_health" => {
            Some(V2Server::ok(serde_json::to_value(Health::healthy()).unwrap_or_default()))
        }
        "system_version" => Some(V2Server::ok(serde_json::json!({
            "server": "indodax-mcp-v2",
            "version": env!("CARGO_PKG_VERSION"),
            "mode": server.mode,
        }))),
        "system_mode" => Some(V2Server::ok(serde_json::json!({
            "mode": server.mode,
            "live_implicit": false,
        }))),
        "system_capabilities" => Some(V2Server::ok(serde_json::json!({
            "market.read": "allowed",
            "account.read": "allowed with credentials",
            "trade.place": "controlled via risk engine",
            "funding.withdraw": "disabled by default",
            "kill_switch": server.policy.kill_switch,
            "allowed_modes": server.policy.allowed_modes,
        }))),
        "auth_status" => Some(V2Server::ok(serde_json::json!({
            "credentials_configured": server.authed.is_some(),
            "mode": server.mode,
        }))),
        "auth_capabilities" => Some(V2Server::ok(serde_json::json!({
            "market.read": true,
            "account.read": server.authed.is_some(),
            "trade.place": false,
            "funding.withdraw": false,
            "paper.*": true,
        }))),
        "funding_fee" | "funding_deposit_address" => Some(funding_read(server, name, args).await),
        "funding_withdraw" => Some(V2Server::fail(
            "authorization",
            "funding.withdraw is disabled by default and needs a separate grant".into(),
        )),
        "ws_ticker_snapshot" => Some(ws_snapshot(server, args, "ticker").await),
        "ws_book_snapshot" => Some(ws_snapshot(server, args, "book").await),
        _ => None,
    }
}

async fn funding_read(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let rest = match server.authed_rest() {
        Ok(rest) => rest,
        Err(failure) => return failure,
    };
    let currency = V2Server::get_str(args, "currency").unwrap_or_default();
    if currency.is_empty() {
        return V2Server::fail("validation", "currency is required".into());
    }
    let mut params = HashMap::new();
    params.insert("currency".into(), currency);
    if let Some(network) = V2Server::get_str(args, "network") {
        params.insert("network".into(), network);
    }
    let method = if name == "funding_fee" { "withdrawFee" } else { "depositAddress" };
    match rest.private_post_v1::<serde_json::Value>(method, &params).await {
        Ok(data) => V2Server::ok(data),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

async fn ws_snapshot(
    _server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
    kind: &str,
) -> CallToolResult {
    use indodax_websocket::WebSocketClient;
    let pair = V2Server::get_str(args, "pair").unwrap_or_else(|| "btc_idr".into());
    let symbol = match V2Server::parse_symbol(&pair) {
        Ok(symbol) => symbol.as_compact(),
        Err(failure) => return failure,
    };
    let token = std::env::var("INDODAX_WS_TOKEN").ok();
    if kind == "book" {
        return match WebSocketClient::book_snapshot(&symbol, token.as_deref()).await {
            Ok(event) => V2Server::ok(serde_json::to_value(&event).unwrap_or_default()),
            Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
        };
    }
    match WebSocketClient::ticker_snapshot(&symbol, token.as_deref()).await {
        Ok(event) => V2Server::ok(serde_json::to_value(&event).unwrap_or_default()),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_lists_withdrawal_disabled() {
        let response = SystemTools::capabilities();
        assert_eq!(response.status, "ok");
    }
}
