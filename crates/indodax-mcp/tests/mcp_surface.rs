use indodax_mcp::V2Server;
use std::collections::HashSet;

fn all_tools() -> Vec<rmcp::model::Tool> {
    let mut tools = indodax_mcp::tools::market::tools();
    tools.extend(indodax_mcp::tools::account::tools());
    tools.extend(indodax_mcp::tools::orders::tools());
    tools.extend(indodax_mcp::tools::trading::tools());
    tools.extend(indodax_mcp::tools::portfolio::tools());
    tools.extend(indodax_mcp::tools::risk::tools());
    tools.extend(indodax_mcp::tools::paper::tools());
    tools.extend(indodax_mcp::tools::strategy::tools());
    tools.extend(indodax_mcp::tools::alerts::tools());
    tools.extend(indodax_mcp::tools::reconcile::tools());
    tools.extend(indodax_mcp::tools::audit::tools());
    tools.extend(indodax_mcp::tools::system::tools());
    tools
}

fn server() -> V2Server {
    V2Server::new_public().unwrap()
}

fn args(pairs: &[(&str, &str)]) -> serde_json::Map<String, serde_json::Value> {
    pairs
        .iter()
        .map(|(key, value)| (key.to_string(), serde_json::Value::String(value.to_string())))
        .collect()
}

#[test]
fn tool_names_are_unique_and_described() {
    let tools = all_tools();
    assert!(tools.len() >= 40, "expected broad surface, got {}", tools.len());
    let mut names = HashSet::new();
    for tool in &tools {
        assert!(names.insert(tool.name.to_string()), "duplicate {}", tool.name);
        let description = tool
            .description
            .as_ref()
            .map(|description| description.to_string())
            .unwrap_or_default();
        assert!(description.len() > 40, "{} description too thin", tool.name);
        assert!(
            description.contains("Read-only")
                || description.contains("MUTATING")
                || description.contains("Disabled")
                || description.contains("No side effects")
                || description.contains("Simulated")
                || description.contains("Persist"),
            "{} missing safety semantics",
            tool.name
        );
    }
}

#[tokio::test]
async fn validation_failures_are_structured() {
    let server = server();
    let empty: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let result =
        indodax_mcp::tools::trading::handle(&server, "trade_validate", &empty).await.unwrap();
    assert!(result.is_error.unwrap_or(false));
    let result = indodax_mcp::tools::paper::handle(&server, "paper_place", &empty).await.unwrap();
    assert!(result.is_error.unwrap_or(false));
    let result = indodax_mcp::tools::risk::handle(&server, "risk_evaluate", &empty).await.unwrap();
    assert!(result.is_error.unwrap_or(false));
    let result = indodax_mcp::tools::alerts::handle(&server, "alert_create", &empty).await.unwrap();
    assert!(result.is_error.unwrap_or(false));
}

#[tokio::test]
async fn offline_reads_succeed() {
    let server = server();
    let empty: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    for (module, name) in [
        ("paper", "paper_balances"),
        ("paper", "paper_status"),
        ("risk", "risk_limits"),
        ("risk", "risk_policy"),
        ("sys", "system_capabilities"),
        ("sys", "system_health"),
        ("sys", "auth_status"),
        ("audit", "audit_events"),
        ("reconcile", "reconcile_status"),
        ("signal", "strategy_list"),
    ] {
        let result = match module {
            "paper" => indodax_mcp::tools::paper::handle(&server, name, &empty).await.unwrap(),
            "risk" => indodax_mcp::tools::risk::handle(&server, name, &empty).await.unwrap(),
            "sys" => indodax_mcp::tools::system::handle(&server, name, &empty).await.unwrap(),
            "audit" => indodax_mcp::tools::audit::handle(&server, name, &empty).await.unwrap(),
            "reconcile" => {
                indodax_mcp::tools::reconcile::handle(&server, name, &empty).await.unwrap()
            }
            _ => indodax_mcp::tools::strategy::handle(&server, name, &empty).await.unwrap(),
        };
        assert_eq!(result.is_error, Some(false), "{name} should succeed offline");
    }
}

#[tokio::test]
async fn paper_lifecycle_through_tools() {
    let server = server();
    let placed = indodax_mcp::tools::paper::handle(
        &server,
        "paper_place",
        &args(&[("pair", "btc_idr"), ("side", "buy"), ("price", "1000"), ("quantity", "0.5")]),
    )
    .await
    .unwrap();
    assert_eq!(placed.is_error, Some(false));
    let text = placed.content.first().and_then(|content| content.as_text()).unwrap().text.clone();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    let id = value["exchange_order_id"].as_str().unwrap_or("paper-1").to_string();
    assert!(id.starts_with("paper-"));

    let filled = indodax_mcp::tools::paper::handle(
        &server,
        "paper_fill",
        &args(&[("order_id", &id), ("price", "1000")]),
    )
    .await
    .unwrap();
    assert_eq!(filled.is_error, Some(false));

    let status =
        indodax_mcp::tools::paper::handle(&server, "paper_status", &serde_json::Map::new())
            .await
            .unwrap();
    let text = status.content.first().and_then(|content| content.as_text()).unwrap().text.clone();
    assert!(text.contains("trade_count"));
}

#[tokio::test]
async fn trading_propose_never_executes() {
    let server = server();
    let result = indodax_mcp::tools::trading::handle(
        &server,
        "trade_propose",
        &args(&[
            ("pair", "btc_idr"),
            ("side", "buy"),
            ("quantity", "0.1"),
            ("price", "1000"),
            ("reason", "test"),
        ]),
    )
    .await
    .unwrap();
    assert_eq!(result.is_error, Some(false));
    let status =
        indodax_mcp::tools::paper::handle(&server, "paper_status", &serde_json::Map::new())
            .await
            .unwrap();
    let text = status.content.first().and_then(|content| content.as_text()).unwrap().text.clone();
    assert!(text.contains("\"open_orders\": 0"));
}

#[tokio::test]
async fn funding_withdraw_stays_disabled() {
    let server = server();
    let result = indodax_mcp::tools::system::handle(
        &server,
        "funding_withdraw",
        &args(&[("currency", "btc"), ("amount", "0.1"), ("address", "x")]),
    )
    .await
    .unwrap();
    assert!(result.is_error.unwrap_or(false));
}

#[tokio::test]
async fn unknown_names_return_none() {
    let server = server();
    let empty: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    assert!(indodax_mcp::tools::market::handle(&server, "nope", &empty).await.is_none());
    assert!(indodax_mcp::tools::system::handle(&server, "nope", &empty).await.is_none());
}
