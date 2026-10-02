use crate::server::V2Server;
use indodax_alerts::{AlertCondition, AlertStatus, PriceAlert};
use indodax_core::SystemEvent;
use rmcp::model::{CallToolResult, Tool};

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "alert_create",
            "Persist a price alert for one pair. Args: pair required, exactly one of above, below, percent_up, percent_down, optional note. Percent alerts snapshot the live price as reference. Returns the alert id.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "above": {"type": "number", "description": "Trigger at or above"},
                "below": {"type": "number", "description": "Trigger at or below"},
                "percent_up": {"type": "number", "description": "Rise percent from live price"},
                "percent_down": {"type": "number", "description": "Fall percent from live price"},
                "note": {"type": "string", "description": "Optional label"},
            }),
            &["pair"],
        ),
        V2Server::tool(
            "alert_list",
            "Read-only. List active alerts, or include triggered and cancelled with history true. Args: history optional boolean.",
            serde_json::json!({"history": {"type": "boolean", "description": "Include inactive"}}),
            &[],
        ),
        V2Server::tool(
            "alert_cancel",
            "MUTATING local state. Cancel one active alert by id. Args: id required whole number. Idempotent: cancelling twice reports not open.",
            serde_json::json!({"id": {"type": "number", "description": "Alert id"}}),
            &["id"],
        ),
        V2Server::tool(
            "alert_check",
            "MUTATING local state. Evaluate active alerts for one pair against the live price and mark triggered ones. Args: pair required. Returns triggered alerts.",
            serde_json::json!({"pair": {"type": "string", "description": "Pair, e.g. btc_idr"}}),
            &["pair"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "alert_create" => Some(create(server, args).await),
        "alert_list" => {
            let history = V2Server::get_bool(args, "history");
            let alerts = server.alerts.list(history);
            Some(V2Server::ok(serde_json::to_value(&alerts).unwrap_or_default()))
        }
        "alert_cancel" => {
            let id = match V2Server::get_num(args, "id") {
                Some(id) if id.fract() == 0.0 && id > 0.0 => id as u64,
                _ => {
                    return Some(V2Server::fail(
                        "validation",
                        "id must be a positive whole number".into(),
                    ))
                }
            };
            Some(match server.alerts.cancel(id) {
                Ok(true) => {
                    server.persist_alerts();
                    V2Server::ok(serde_json::json!({"id": id, "status": "cancelled"}))
                }
                Ok(false) => V2Server::fail("state_conflict", format!("alert {id} is not active")),
                Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
            })
        }
        "alert_check" => Some(check(server, args).await),
        _ => None,
    }
}

async fn live_price(server: &V2Server, pair: &str) -> Result<f64, CallToolResult> {
    use indodax_market::MarketService;
    let service = MarketService::new(&server.rest, &server.cache);
    match service.ticker(pair).await {
        Ok(ticker) => Ok(ticker.last.to_f64()),
        Err(error) => Err(V2Server::fail(&error.category().to_string(), error.to_string())),
    }
}

async fn create(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let pair = V2Server::get_str(args, "pair").unwrap_or_default();
    let symbol = match V2Server::parse_symbol(&pair) {
        Ok(symbol) => symbol,
        Err(failure) => return failure,
    };
    let above = V2Server::get_num(args, "above");
    let below = V2Server::get_num(args, "below");
    let percent_up = V2Server::get_num(args, "percent_up");
    let percent_down = V2Server::get_num(args, "percent_down");
    let triggers = [above.is_some(), below.is_some(), percent_up.is_some(), percent_down.is_some()]
        .iter()
        .filter(|trigger| **trigger)
        .count();
    if triggers != 1 {
        return V2Server::fail(
            "validation",
            "provide exactly one of above, below, percent_up, percent_down".into(),
        );
    }
    let condition = if let Some(price) = above {
        if price <= 0.0 {
            return V2Server::fail("validation", "above must be positive".into());
        }
        AlertCondition::Above { price }
    } else if let Some(price) = below {
        if price <= 0.0 {
            return V2Server::fail("validation", "below must be positive".into());
        }
        AlertCondition::Below { price }
    } else if let Some(percent) = percent_up {
        if percent <= 0.0 {
            return V2Server::fail("validation", "percent_up must be positive".into());
        }
        let reference = match live_price(server, &symbol.as_pair()).await {
            Ok(reference) => reference,
            Err(failure) => return failure,
        };
        AlertCondition::ChangeUp { percent, from_price: reference }
    } else if let Some(percent) = percent_down {
        if percent <= 0.0 {
            return V2Server::fail("validation", "percent_down must be positive".into());
        }
        let reference = match live_price(server, &symbol.as_pair()).await {
            Ok(reference) => reference,
            Err(failure) => return failure,
        };
        AlertCondition::ChangeDown { percent, from_price: reference }
    } else {
        return V2Server::fail("validation", "no trigger provided".into());
    };
    let alert = PriceAlert {
        id: 0,
        pair: symbol.as_pair(),
        condition,
        created_at: chrono::Utc::now(),
        triggered_at: None,
        status: AlertStatus::Active,
        note: V2Server::get_str(args, "note"),
    };
    match server.alerts.add(alert) {
        Ok(id) => {
            server.persist_alerts();
            V2Server::ok(serde_json::json!({"id": id, "status": "active"}))
        }
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

async fn check(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let pair = V2Server::get_str(args, "pair").unwrap_or_default();
    let symbol = match V2Server::parse_symbol(&pair) {
        Ok(symbol) => symbol,
        Err(failure) => return failure,
    };
    let price = match live_price(server, &symbol.as_pair()).await {
        Ok(price) => price,
        Err(failure) => return failure,
    };
    let triggered = server.alerts.check(&symbol.as_pair(), price);
    if !triggered.is_empty() {
        server.persist_alerts();
        server.bus.publish(SystemEvent::System {
            detail: format!("{} alerts triggered for {}", triggered.len(), symbol.as_pair()),
            at: chrono::Utc::now(),
        });
    }
    V2Server::ok(serde_json::json!({
        "pair": symbol.as_pair(),
        "price": price,
        "triggered": triggered,
    }))
}
