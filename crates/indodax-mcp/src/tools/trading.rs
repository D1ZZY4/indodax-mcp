use crate::server::V2Server;
use crate::McpResponse;
use indodax_agent::TradeIntent;
use indodax_audit::AuditKind;
use indodax_core::{Capability, ErrorCategory, ExecutionMode, OrderType};
use indodax_execution::ExecutionService;
use indodax_risk::{RiskContext, RiskEngine};
use indodax_trading::TradingService;
use rmcp::model::{CallToolResult, Tool};

/// Mutating trading tools. Always pass through risk first.
pub struct TradingTools<'a> {
    service: TradingService<'a>,
    risk: &'a RiskEngine,
}

impl<'a> TradingTools<'a> {
    pub fn new(service: TradingService<'a>, risk: &'a RiskEngine) -> Self {
        Self { service, risk }
    }

    pub async fn propose_buy(&self, intent: TradeIntent) -> McpResponse<serde_json::Value> {
        if intent.mode == ExecutionMode::Live && intent.capability != Capability::TradePlace {
            return McpResponse::fail(
                ErrorCategory::Authorization,
                "live trading needs trade.place capability".into(),
            );
        }
        match self.service.propose(intent) {
            Ok(proposal) => match self.service.to_order(&proposal) {
                Ok(mut order) => {
                    let context = RiskContext::fresh_paper(Capability::TradePlace);
                    match self.service.review(&mut order, &context) {
                        Ok(decision) if decision.is_allow() => McpResponse::ok_with_warnings(
                            serde_json::to_value(&order).unwrap_or_default(),
                            vec!["risk approved; execution still requires backend call".into()],
                        ),
                        Ok(decision) => McpResponse::fail(
                            ErrorCategory::RiskRejection,
                            decision.message.clone(),
                        ),
                        Err(error) => McpResponse::fail(error.category(), error.to_string()),
                    }
                }
                Err(error) => McpResponse::fail(error.category(), error.to_string()),
            },
            Err(error) => McpResponse::fail(error.category(), error.to_string()),
        }
    }

    pub fn risk_engine(&self) -> &RiskEngine {
        self.risk
    }

    pub fn order_type_hint() -> &'static str {
        "Use limit with price, or market explicitly. Stop-limit needs both prices."
    }

    pub fn _order_type_ref() -> OrderType {
        OrderType::Limit
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "trade_validate",
            "No side effects. Check order shape and risk without placing anything. Args: pair, side buy or sell, quantity in base units, optional price for limit, optional mode default paper. Returns the risk decision with machine-readable reasons.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "side": {"type": "string", "description": "buy or sell"},
                "quantity": {"type": "number", "description": "Base units, e.g. 0.5 BTC"},
                "price": {"type": "number", "description": "Limit price, omit for market review"},
                "mode": {"type": "string", "description": "paper default, live only with capability"},
            }),
            &["pair", "side", "quantity"],
        ),
        V2Server::tool(
            "trade_propose",
            "No side effects and no execution. Build a validated trade proposal through the trading service and risk engine. Args: same as trade_validate plus reason text. Returns proposal id, normalized order, and risk verdict. A proposal is not an order.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "side": {"type": "string", "description": "buy or sell"},
                "quantity": {"type": "number", "description": "Base units"},
                "price": {"type": "number", "description": "Limit price"},
                "mode": {"type": "string", "description": "paper or live"},
                "reason": {"type": "string", "description": "Why this trade is proposed"},
            }),
            &["pair", "side", "quantity", "reason"],
        ),
        V2Server::tool(
            "trade_place",
            "MUTATING in paper mode only. Place an order through risk into the paper backend by default. Args: pair, side, quantity, price, optional mode, optional acknowledged boolean. Live mode is denied by server policy unless explicitly enabled. Returns acceptance, never a fill. Requires acknowledged true for live.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "side": {"type": "string", "description": "buy or sell"},
                "quantity": {"type": "number", "description": "Base units"},
                "price": {"type": "number", "description": "Limit price"},
                "mode": {"type": "string", "description": "paper default"},
                "acknowledged": {"type": "boolean", "description": "Confirm intentional execution"},
            }),
            &["pair", "side", "quantity", "price"],
        ),
        V2Server::tool(
            "trade_cancel",
            "MUTATING a paper order by default. Cancel one open paper order and refund reserved funds. Args: order_id required, e.g. paper-1. Live cancel needs credentials, explicit live mode, and acknowledged true.",
            serde_json::json!({
                "order_id": {"type": "string", "description": "Paper order id"},
                "mode": {"type": "string", "description": "paper default"},
                "acknowledged": {"type": "boolean", "description": "Confirm for live cancel"},
            }),
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
        "trade_validate" => Some(validate(server, args)),
        "trade_propose" => Some(propose(server, args)),
        "trade_place" => Some(place(server, args).await),
        "trade_cancel" => Some(cancel(server, args).await),
        _ => None,
    }
}

fn draft_intent(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Result<(TradeIntent, ExecutionMode, Capability), CallToolResult> {
    let pair = V2Server::get_str(args, "pair").unwrap_or_default();
    let symbol = V2Server::parse_symbol(&pair)?;
    let side = V2Server::parse_side(&V2Server::get_str(args, "side").unwrap_or_default())?;
    let quantity = match V2Server::get_num(args, "quantity") {
        Some(value) if value.is_finite() && value > 0.0 => value,
        _ => return Err(V2Server::fail("validation", "quantity must be a positive number".into())),
    };
    let price = V2Server::get_num(args, "price");
    let order_type = V2Server::parse_order_type(price.is_some().then_some("limit"))?;
    let mode = match V2Server::get_str(args, "mode").unwrap_or_else(|| "paper".into()).as_str() {
        "live" => ExecutionMode::Live,
        "shadow" => ExecutionMode::Shadow,
        _ => ExecutionMode::Paper,
    };
    let capability =
        if mode == ExecutionMode::Paper { Capability::PaperTrade } else { Capability::TradePlace };
    let agent = server.agent_identity();
    Ok((
        TradeIntent {
            agent,
            symbol,
            side,
            order_type,
            price,
            quantity_or_idr: quantity,
            quantity_is_idr: false,
            mode,
            capability,
            reason: V2Server::get_str(args, "reason").unwrap_or_else(|| "mcp request".into()),
            created_at: chrono::Utc::now(),
        },
        mode,
        capability,
    ))
}

fn validate(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let (intent, _, capability) = match draft_intent(server, args) {
        Ok(draft) => draft,
        Err(failure) => return failure,
    };
    let service = server.trading_service();
    let proposal = match service.propose(intent) {
        Ok(proposal) => proposal,
        Err(error) => return V2Server::fail(&error.category().to_string(), error.to_string()),
    };
    let mut order = match service.to_order(&proposal) {
        Ok(order) => order,
        Err(error) => return V2Server::fail(&error.category().to_string(), error.to_string()),
    };
    let context = server.risk_context(capability);
    match service.review(&mut order, &context) {
        Ok(decision) => V2Server::ok(serde_json::json!({
            "proposal": proposal.correlation_id,
            "order": order,
            "decision": decision,
        })),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

fn propose(server: &V2Server, args: &serde_json::Map<String, serde_json::Value>) -> CallToolResult {
    let result = validate(server, args);
    server.audit(
        AuditKind::AgentIntentCreated,
        &format!("propose-{}", server.next_seq()),
        V2Server::get_str(args, "pair"),
        V2Server::get_str(args, "reason"),
    );
    result
}

async fn place(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let (intent, mode, capability) = match draft_intent(server, args) {
        Ok(draft) => draft,
        Err(failure) => return failure,
    };
    if mode != ExecutionMode::Paper {
        if !V2Server::get_bool(args, "acknowledged") {
            return V2Server::fail(
                "authorization",
                "live execution needs acknowledged true".into(),
            );
        }
        return V2Server::fail("authorization", "live mode is disabled by server policy".into());
    }
    let service = server.trading_service();
    let proposal = match service.propose(intent) {
        Ok(proposal) => proposal,
        Err(error) => return V2Server::fail(&error.category().to_string(), error.to_string()),
    };
    let mut order = match service.to_order(&proposal) {
        Ok(order) => order,
        Err(error) => return V2Server::fail(&error.category().to_string(), error.to_string()),
    };
    let context = server.risk_context(capability);
    let decision = match service.review(&mut order, &context) {
        Ok(decision) => decision,
        Err(error) => return V2Server::fail(&error.category().to_string(), error.to_string()),
    };
    if !decision.is_allow() {
        return V2Server::fail("risk_rejection", decision.message.clone());
    }
    let request = service.execution_request(
        &order,
        ExecutionMode::Paper,
        Capability::PaperTrade,
        proposal.correlation_id.clone(),
    );
    let execution = ExecutionService::new(server.paper_executor());
    match execution.execute(request, &decision).await {
        Ok(result) => {
            server.persist_paper();
            let paper_id = result.exchange_order_id.clone().unwrap_or_default();
            server.audit(
                AuditKind::OrderSubmitted,
                &proposal.correlation_id,
                Some(order.symbol.as_pair()),
                Some(format!("paper {paper_id}")),
            );
            V2Server::ok(serde_json::to_value(&result).unwrap_or_default())
        }
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

async fn cancel(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    let mode = V2Server::get_str(args, "mode").unwrap_or_else(|| "paper".into());
    if mode == "live" {
        return cancel_live(server, args).await;
    }
    let id = V2Server::get_str(args, "order_id").unwrap_or_default();
    crate::tools::paper::cancel_order(server, &id).await
}

async fn cancel_live(
    server: &V2Server,
    args: &serde_json::Map<String, serde_json::Value>,
) -> CallToolResult {
    if !V2Server::get_bool(args, "acknowledged") {
        return V2Server::fail("authorization", "live cancel needs acknowledged true".into());
    }
    if !server.policy.allows_mode(ExecutionMode::Live) {
        return V2Server::fail("authorization", "live mode is disabled by server policy".into());
    }
    let _rest = match server.authed_rest() {
        Ok(rest) => rest,
        Err(failure) => return failure,
    };
    V2Server::fail("authorization", "live cancel is not enabled on this server".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use indodax_agent::AgentIdentity;
    use indodax_audit::AuditTrail;
    use indodax_core::Symbol;
    use indodax_risk::{RiskLimits, RiskPolicy};
    use std::str::FromStr;

    #[tokio::test]
    async fn validates_limit_price() {
        let risk = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
        let audit = AuditTrail::new();
        let service = TradingService::new(&risk, &audit);
        let tools = TradingTools::new(service, &risk);
        let intent = TradeIntent {
            agent: AgentIdentity {
                agent_id: "a".into(),
                session_id: "s".into(),
                display_name: None,
            },
            symbol: Symbol::from_str("btc_idr").unwrap(),
            side: indodax_core::OrderSide::Buy,
            order_type: OrderType::Limit,
            price: None,
            quantity_or_idr: 1.0,
            quantity_is_idr: false,
            mode: ExecutionMode::Paper,
            capability: Capability::PaperTrade,
            reason: "test".into(),
            created_at: chrono::Utc::now(),
        };
        let response = tools.propose_buy(intent).await;
        assert_eq!(response.status, "error");
    }
}
