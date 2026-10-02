use crate::server::{PaperExec, V2Server};
use crate::McpResponse;
use indodax_agent::TradeIntent;
use indodax_audit::AuditKind;
use indodax_core::{Capability, ExecutionMode, OrderId};
use indodax_execution::{ExecutionBackend, ExecutionService};
use indodax_paper::{PaperBackend, PaperState};
use rmcp::model::{CallToolResult, Tool};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;

/// Paper tools operate on an isolated paper backend only.
pub struct PaperTools {
    backend: PaperBackend,
}

impl PaperTools {
    pub fn new(state: PaperState) -> Self {
        Self { backend: PaperBackend::new(state) }
    }

    pub fn balances(&self) -> McpResponse<serde_json::Value> {
        let snapshot = self.backend.snapshot();
        McpResponse::ok(serde_json::to_value(&snapshot.balances).unwrap_or_default())
    }

    pub fn status(&self) -> McpResponse<serde_json::Value> {
        let snapshot = self.backend.snapshot();
        McpResponse::ok(serde_json::json!({
            "trade_count": snapshot.trade_count,
            "open_orders": snapshot.open_orders().len(),
            "total_fees": snapshot.total_fees.to_string(),
        }))
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.name()
    }
}

pub fn validate_paper_amount(amount: Option<f64>) -> Result<f64, String> {
    match amount {
        Some(value) if value.is_finite() && value > 0.0 => Ok(value),
        _ => Err("amount must be a positive number".to_string()),
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "paper_balances",
            "Read-only. Show virtual paper-trading balances. No arguments. Never touches real money or the exchange.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "paper_status",
            "Read-only. Show paper session stats: trade count, open orders, total fees. No arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "paper_place",
            "Simulated execution, no real money. Place a paper limit order through validation and risk. Args: pair, side buy or sell, price, quantity in base units. Returns the open paper order id. Fill it later with paper_fill.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "side": {"type": "string", "description": "buy or sell"},
                "price": {"type": "number", "description": "Limit price"},
                "quantity": {"type": "number", "description": "Base units"},
            }),
            &["pair", "side", "price", "quantity"],
        ),
        V2Server::tool(
            "paper_fill",
            "Simulated execution. Fill one open paper order at a price, settling balances and fees. Args: order_id required, price required. Fails when the order is not open.",
            serde_json::json!({
                "order_id": {"type": "string", "description": "Paper order id, e.g. paper-1"},
                "price": {"type": "number", "description": "Fill price"},
            }),
            &["order_id", "price"],
        ),
        V2Server::tool(
            "paper_cancel",
            "Simulated execution. Cancel one open paper order and refund reserved funds. Args: order_id required. Fails when the order is not open.",
            serde_json::json!({"order_id": {"type": "string", "description": "Paper order id"}}),
            &["order_id"],
        ),
        V2Server::tool(
            "paper_orders",
            "Read-only. List open paper orders. No arguments.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "paper_reset",
            "Simulated execution, destructive to simulation only. Reset paper balances and clear all orders. No arguments. Never touches real money.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "paper_topup",
            "Simulated execution. Add virtual funds to one asset. Args: currency required, amount required positive. Use to fund new test scenarios.",
            serde_json::json!({
                "currency": {"type": "string", "description": "Asset code, e.g. idr"},
                "amount": {"type": "number", "description": "Positive amount"},
            }),
            &["currency", "amount"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "paper_balances" => {
            let snapshot = server.paper.snapshot();
            Some(V2Server::ok(serde_json::to_value(&snapshot.balances).unwrap_or_default()))
        }
        "paper_status" => {
            let snapshot = server.paper.snapshot();
            Some(V2Server::ok(serde_json::json!({
                "trade_count": snapshot.trade_count,
                "open_orders": snapshot.open_orders().len(),
                "total_fees": snapshot.total_fees.to_string(),
            })))
        }
        "paper_orders" => {
            let snapshot = server.paper.snapshot();
            let orders: Vec<_> =
                snapshot.orders.iter().filter(|order| order.state == "open").collect();
            Some(V2Server::ok(serde_json::to_value(&orders).unwrap_or_default()))
        }
        "paper_place" => {
            let pair = V2Server::get_str(args, "pair").unwrap_or_default();
            let side = V2Server::get_str(args, "side").unwrap_or_default();
            let price = V2Server::get_num(args, "price").unwrap_or(0.0);
            let quantity = V2Server::get_num(args, "quantity").unwrap_or(0.0);
            Some(place_order(server, &pair, &side, price, quantity).await)
        }
        "paper_fill" => {
            let id = V2Server::get_str(args, "order_id").unwrap_or_default();
            let price = V2Server::get_num(args, "price").unwrap_or(0.0);
            Some(fill_order(server, &id, price))
        }
        "paper_cancel" => {
            let id = V2Server::get_str(args, "order_id").unwrap_or_default();
            Some(cancel_order(server, &id).await)
        }
        "paper_reset" => match server.paper.reset() {
            Ok(()) => {
                server.persist_paper();
                server.audit(
                    AuditKind::PositionChanged,
                    "paper-reset",
                    None,
                    Some("paper state reset".into()),
                );
                Some(V2Server::ok(serde_json::json!({"status": "reset"})))
            }
            Err(error) => Some(V2Server::fail(&error.category().to_string(), error.to_string())),
        },
        "paper_topup" => {
            let currency = V2Server::get_str(args, "currency").unwrap_or_default();
            let amount = V2Server::get_num(args, "amount").unwrap_or(0.0);
            let amount = match Decimal::from_f64(amount) {
                Some(amount) => amount,
                None => {
                    return Some(V2Server::fail("validation", "amount must be a number".into()));
                }
            };
            match server.paper.topup(&currency, amount) {
                Ok(balance) => {
                    server.persist_paper();
                    Some(V2Server::ok(serde_json::json!({
                        "currency": currency.to_lowercase(),
                        "new_balance": balance.to_string(),
                    })))
                }
                Err(error) => {
                    Some(V2Server::fail(&error.category().to_string(), error.to_string()))
                }
            }
        }
        _ => None,
    }
}

pub(crate) async fn place_order(
    server: &V2Server,
    pair: &str,
    side: &str,
    price: f64,
    quantity: f64,
) -> CallToolResult {
    let symbol = match V2Server::parse_symbol(pair) {
        Ok(symbol) => symbol,
        Err(failure) => return failure,
    };
    let side = match V2Server::parse_side(side) {
        Ok(side) => side,
        Err(failure) => return failure,
    };
    if !price.is_finite() || price <= 0.0 {
        return V2Server::fail("validation", "price must be a positive number".into());
    }
    if !quantity.is_finite() || quantity <= 0.0 {
        return V2Server::fail("validation", "quantity must be a positive number".into());
    }
    let agent = server.agent_identity();
    let intent = TradeIntent {
        agent,
        symbol,
        side,
        order_type: indodax_core::OrderType::Limit,
        price: Some(price),
        quantity_or_idr: quantity,
        quantity_is_idr: false,
        mode: ExecutionMode::Paper,
        capability: Capability::PaperTrade,
        reason: "paper_place".into(),
        created_at: chrono::Utc::now(),
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
    let decision = match service.review(&mut order, &server.risk_context(Capability::PaperTrade)) {
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
    let execution = ExecutionService::new(PaperExec(server.paper.clone()));
    match execution.execute(request, &decision).await {
        Ok(result) => {
            server.persist_paper();
            server.audit(
                AuditKind::OrderSubmitted,
                &proposal.correlation_id,
                Some(order.symbol.as_pair()),
                Some("paper open".into()),
            );
            V2Server::ok(serde_json::to_value(&result).unwrap_or_default())
        }
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

pub(crate) async fn cancel_order(server: &V2Server, id: &str) -> CallToolResult {
    let order_id = match OrderId::new(id) {
        Some(order_id) => order_id,
        None => return V2Server::fail("validation", "order_id is required".into()),
    };
    match server.paper.cancel(&order_id, None).await {
        Ok(true) => {
            server.persist_paper();
            server.audit(AuditKind::OrderCancelled, id, None, Some("paper cancel".into()));
            V2Server::ok(serde_json::json!({"order_id": id, "status": "cancelled"}))
        }
        Ok(false) => V2Server::fail("state_conflict", format!("paper order {id} is not open")),
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

fn fill_order(server: &V2Server, id: &str, price: f64) -> CallToolResult {
    use indodax_core::SystemEvent;
    let order_id = match OrderId::new(id) {
        Some(order_id) => order_id,
        None => return V2Server::fail("validation", "order_id is required".into()),
    };
    let fill_price = match Decimal::from_f64(price) {
        Some(fill_price) => fill_price,
        None => return V2Server::fail("validation", "price must be a number".into()),
    };
    let quantity = server
        .paper
        .snapshot()
        .orders
        .iter()
        .find(|order| order.id == order_id)
        .map(|order| order.remaining.to_f64().unwrap_or(0.0));
    match server.paper.fill(&order_id, fill_price) {
        Ok(fee) => {
            server.persist_paper();
            server.audit(AuditKind::OrderFilled, id, None, Some(format!("fee {fee}")));
            server.bus.publish(SystemEvent::Fill {
                order_id: id.to_string(),
                price,
                quantity: quantity.unwrap_or(0.0),
                at: chrono::Utc::now(),
            });
            V2Server::ok(serde_json::json!({
                "order_id": id,
                "status": "filled",
                "fill_price": fill_price.to_string(),
                "fee": fee.to_string(),
            }))
        }
        Err(error) => V2Server::fail(&error.category().to_string(), error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_balances_ok() {
        let tools = PaperTools::new(PaperState::with_defaults());
        assert_eq!(tools.balances().status, "ok");
        assert_eq!(tools.backend_name(), "paper");
    }

    #[test]
    fn rejects_bad_amount() {
        assert!(validate_paper_amount(Some(0.0)).is_err());
        assert!(validate_paper_amount(Some(1.0)).is_ok());
    }
}
