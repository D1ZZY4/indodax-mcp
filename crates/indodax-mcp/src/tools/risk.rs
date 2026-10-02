use crate::server::V2Server;
use crate::McpResponse;
use indodax_core::{Capability, ExecutionMode, OrderSide, OrderType, Price, Quantity, Symbol};
use indodax_risk::{RiskContext, RiskLimits, RiskPolicy};
use rmcp::model::{CallToolResult, Tool};

/// Read-only risk inspection. No mutation, no bypass.
pub struct RiskTools {
    limits: RiskLimits,
    policy: RiskPolicy,
}

impl RiskTools {
    pub fn new(limits: RiskLimits, policy: RiskPolicy) -> Self {
        Self { limits, policy }
    }

    pub fn limits(&self) -> McpResponse<serde_json::Value> {
        McpResponse::ok(serde_json::to_value(&self.limits).unwrap_or_default())
    }

    pub fn policy(&self) -> McpResponse<serde_json::Value> {
        McpResponse::ok(serde_json::json!({
            "kill_switch": self.policy.kill_switch,
            "circuit_breaker": self.policy.circuit_breaker,
            "allowed_modes": self.policy.allowed_modes,
            "allowed_capabilities": self.policy.allowed_capabilities,
        }))
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "risk_limits",
            "Read-only. Show the deterministic risk limits: max order and position size, daily loss, drawdown, staleness bounds, cooldown. Takes no arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "risk_policy",
            "Read-only. Show kill switch, circuit breaker, allowed modes, and allowed capabilities. Takes no arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "risk_evaluate",
            "No side effects. Run a hypothetical order through the deterministic risk engine. Args: pair, side, quantity, price, optional mode default paper. Returns ALLOW, DENY, REQUIRE_REVIEW, or HALT with machine-readable reasons. Nothing is placed.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "side": {"type": "string", "description": "buy or sell"},
                "quantity": {"type": "number", "description": "Base units"},
                "price": {"type": "number", "description": "Limit price"},
                "mode": {"type": "string", "description": "paper default"},
            }),
            &["pair", "side", "quantity", "price"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "risk_limits" => {
            Some(V2Server::ok(serde_json::to_value(&server.limits).unwrap_or_default()))
        }
        "risk_policy" => Some(V2Server::ok(serde_json::json!({
            "kill_switch": server.policy.kill_switch,
            "circuit_breaker": server.policy.circuit_breaker,
            "allowed_modes": server.policy.allowed_modes,
            "allowed_capabilities": server.policy.allowed_capabilities,
        }))),
        "risk_evaluate" => Some(evaluate(server, args)),
        _ => None,
    }
}

fn evaluate(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let symbol = match V2Server::get_str(args, "pair").as_deref().map(Symbol::parse_flexible) {
        Some(Some(symbol)) => symbol,
        _ => return V2Server::fail("validation", "pair is invalid, e.g. btc_idr".into()),
    };
    let side = match V2Server::get_str(args, "side").unwrap_or_default().as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => return V2Server::fail("validation", "side must be buy or sell".into()),
    };
    let quantity = match V2Server::get_num(args, "quantity").and_then(Quantity::from_f64) {
        Some(quantity) => quantity,
        None => return V2Server::fail("validation", "quantity must be positive".into()),
    };
    let price = match V2Server::get_num(args, "price").and_then(Price::from_f64) {
        Some(price) => price,
        None => return V2Server::fail("validation", "price must be positive".into()),
    };
    let mode = match V2Server::get_str(args, "mode").unwrap_or_else(|| "paper".into()).as_str() {
        "live" => ExecutionMode::Live,
        _ => ExecutionMode::Paper,
    };
    let order = indodax_core::Order {
        id: indodax_core::OrderId::new(format!("eval-{}", server.next_seq())).unwrap(),
        symbol,
        side,
        order_type: OrderType::Limit,
        price: Some(price),
        stop_price: None,
        quantity,
        remaining: quantity,
        state: indodax_core::OrderState::Proposed,
        client_order_id: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    let capability =
        if mode == ExecutionMode::Paper { Capability::PaperTrade } else { Capability::TradePlace };
    let context = RiskContext {
        mode,
        capability,
        market_age_secs: Some(5),
        account_age_secs: Some(5),
        daily_pnl_idr: Some(rust_decimal::Decimal::ZERO),
        duplicate: false,
        reconciliation_halted: false,
        now: chrono::Utc::now(),
    };
    let decision = server.risk_engine.evaluate(&order, &context);
    V2Server::ok(serde_json::json!({
        "outcome": decision.outcome,
        "reasons": decision.reasons,
        "message": decision.message,
        "order": order,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_limits() {
        let tools = RiskTools::new(RiskLimits::default(), RiskPolicy::paper_only());
        assert_eq!(tools.limits().status, "ok");
        assert_eq!(tools.policy().status, "ok");
    }
}
