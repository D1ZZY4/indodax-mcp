use super::*;
use crate::commands::trading::{TradingAction, TradingArgs};
use indodax_agent::{AgentIdentity, TradeIntent};
use indodax_audit::AuditTrail;
use indodax_core::{Capability, ExecutionMode, OrderType, Symbol};
use indodax_risk::{RiskContext, RiskEngine, RiskLimits, RiskPolicy};
use indodax_trading::TradingService;
use std::str::FromStr;

pub async fn run(args: &TradingArgs) -> Result<()> {
    let (pair, side_raw, amount, price) = match &args.action {
        TradingAction::ProposeBuy { pair, idr, price } => (pair, "buy", idr, price),
        TradingAction::ProposeSell { pair, amount, price } => (pair, "sell", amount, price),
    };
    let symbol = Symbol::from_str(pair).map_err(|error| anyhow::anyhow!(error))?;
    let side = match side_raw {
        "buy" => indodax_core::OrderSide::Buy,
        _ => indodax_core::OrderSide::Sell,
    };
    let intent = TradeIntent {
        agent: AgentIdentity {
            agent_id: "cli".into(),
            session_id: "cli".into(),
            display_name: None,
        },
        symbol,
        side,
        order_type: OrderType::Limit,
        price: *price,
        quantity_or_idr: *amount,
        quantity_is_idr: side == indodax_core::OrderSide::Buy,
        mode: ExecutionMode::Paper,
        capability: Capability::PaperTrade,
        reason: "cli propose".into(),
        created_at: chrono::Utc::now(),
    };
    let risk = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
    let audit = AuditTrail::new();
    let service = TradingService::new(&risk, &audit);
    let proposal = service.propose(intent).map_err(|error| anyhow::anyhow!("{error}"))?;
    let mut order = service.to_order(&proposal).map_err(|error| anyhow::anyhow!("{error}"))?;
    let decision = service
        .review(&mut order, &RiskContext::fresh_paper(Capability::PaperTrade))
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    println!("proposal {} decision {:?}", proposal.correlation_id, decision.outcome);
    for reason in &decision.reasons {
        println!("reason: {reason:?}");
    }
    println!("NOTE: proposals never execute. Use paper commands for simulation.");
    Ok(())
}
