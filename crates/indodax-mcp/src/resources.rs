use crate::server::V2Server;
use rmcp::model::{
    ListResourcesResult, ReadResourceRequestParams, ReadResourceResult, ResourceContents,
};

fn entry(
    uri: &str,
    name: &str,
    description: &str,
) -> rmcp::model::Annotated<rmcp::model::RawResource> {
    let resource = rmcp::model::RawResource::new(uri.to_string(), name.to_string())
        .with_description(description.to_string());
    rmcp::model::Annotated::new(resource, None)
}

pub fn list() -> ListResourcesResult {
    ListResourcesResult::with_all_items(vec![
        entry(
            "config://current",
            "current-config",
            "Credential presence and execution mode. Booleans only, never secret content.",
        ),
        entry("pairs://list", "trading-pairs", "Live trading pair list from the exchange."),
        entry("market://ticker", "market-ticker", "Latest cached ticker snapshot per pair."),
        entry("paper://state", "paper-state", "Paper balances, open orders, and trade counts."),
        entry("risk://limits", "risk-limits", "Deterministic risk limits and policy."),
        entry("system://health", "system-health", "Service health and capability matrix."),
        entry("audit://recent", "recent-audit", "Latest audit entries without secrets."),
    ])
}

pub async fn read(
    server: &V2Server,
    request: ReadResourceRequestParams,
) -> Result<ReadResourceResult, rmcp::model::ErrorData> {
    let uri = request.uri.clone();
    let value = match uri.as_str() {
        "config://current" => serde_json::json!({
            "credentials_configured": server.authed.is_some(),
            "mode": server.mode,
            "funding_withdraw": server.allow_funding_withdraw,
        }),
        "pairs://list" => server
            .rest
            .public_get::<serde_json::Value>("/api/pairs")
            .await
            .unwrap_or_else(|error| serde_json::json!({"error": error.to_string()})),
        "market://ticker" => serde_json::json!({"cached": server.cache.len()}),
        "paper://state" => {
            let snapshot = server.paper.snapshot();
            serde_json::json!({
                "balances": snapshot.balances,
                "open_orders": snapshot.open_orders().len(),
                "trade_count": snapshot.trade_count,
            })
        }
        "risk://limits" => serde_json::json!({
            "limits": server.limits,
            "policy": {
                "kill_switch": server.policy.kill_switch,
                "allowed_modes": server.policy.allowed_modes,
            },
        }),
        "system://health" => serde_json::json!({"status": "healthy", "mode": server.mode}),
        "audit://recent" => {
            let entries = server.audit.entries();
            let start = entries.len().saturating_sub(20);
            serde_json::to_value(&entries[start..]).unwrap_or_default()
        }
        _ => {
            return Err(rmcp::model::ErrorData::invalid_params(
                format!("unknown resource: {uri}"),
                None,
            ));
        }
    };
    let text = serde_json::to_string_pretty(&value).unwrap_or_default();
    Ok(ReadResourceResult::new(vec![ResourceContents::text(text, uri)]))
}
