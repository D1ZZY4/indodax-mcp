use super::*;
use crate::commands::paper::{PaperAction, PaperArgs};
use indodax_core::OrderId;
use indodax_execution::ExecutionBackend;
use indodax_paper::{PaperBackend, PaperState};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;

fn backend() -> PaperBackend {
    PaperBackend::new(PaperState::load_or_default(&super::data_path("paper.json")))
}

fn persist(backend: &PaperBackend) -> Result<()> {
    backend.persist(&super::data_path("paper.json"))?;
    Ok(())
}

pub async fn run(args: &PaperArgs) -> Result<()> {
    let backend = backend();
    match &args.action {
        PaperAction::Balance => {
            let snapshot = backend.snapshot();
            for (asset, amount) in &snapshot.balances {
                println!("{asset}: {amount}");
            }
            Ok(())
        }
        PaperAction::Status => {
            let snapshot = backend.snapshot();
            println!(
                "trades {} open {} fees {}",
                snapshot.trade_count,
                snapshot.open_orders().len(),
                snapshot.total_fees
            );
            Ok(())
        }
        PaperAction::Reset => {
            backend.reset()?;
            persist(&backend)?;
            println!("paper state reset");
            Ok(())
        }
        PaperAction::Buy { pair, price, amount } => {
            place(&backend, pair, "buy", *price, *amount).await
        }
        PaperAction::Sell { pair, price, amount } => {
            place(&backend, pair, "sell", *price, *amount).await
        }
        PaperAction::Fill { order_id, price } => {
            let id = OrderId::new(order_id).context("invalid order id")?;
            let fill_price = Decimal::from_f64(*price).context("invalid fill price")?;
            let fee = backend.fill(&id, fill_price)?;
            persist(&backend)?;
            println!("filled {order_id} fee {fee}");
            Ok(())
        }
        PaperAction::Cancel { order_id } => {
            let id = OrderId::new(order_id).context("invalid order id")?;
            if backend.cancel(&id, None).await? {
                persist(&backend)?;
                println!("cancelled {order_id}");
            } else {
                println!("order {order_id} is not open");
            }
            Ok(())
        }
        PaperAction::Topup { currency, amount } => {
            let amount = Decimal::from_f64(*amount).context("invalid amount")?;
            let balance = backend.topup(currency, amount)?;
            persist(&backend)?;
            println!("{currency} balance {balance}");
            Ok(())
        }
    }
}

async fn place(
    backend: &PaperBackend,
    pair: &str,
    side: &str,
    price: f64,
    amount: f64,
) -> Result<()> {
    use indodax_agent::{AgentIdentity, TradeIntent};
    use indodax_audit::AuditTrail;
    use indodax_core::{Capability, ExecutionMode, OrderType, Symbol};
    use indodax_execution::ExecutionService;
    use indodax_risk::{RiskContext, RiskEngine, RiskLimits, RiskPolicy};
    use indodax_trading::TradingService;
    use std::str::FromStr;

    let symbol = Symbol::from_str(pair).map_err(|error| anyhow::anyhow!(error))?;
    let side = match side {
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
        price: Some(price),
        quantity_or_idr: amount,
        quantity_is_idr: false,
        mode: ExecutionMode::Paper,
        capability: Capability::PaperTrade,
        reason: "cli paper".into(),
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
    if !decision.is_allow() {
        anyhow::bail!("risk denied: {}", decision.message);
    }
    let request = service.execution_request(
        &order,
        ExecutionMode::Paper,
        Capability::PaperTrade,
        proposal.correlation_id,
    );
    let execution = ExecutionService::new(PaperExec(backend));
    let result =
        execution.execute(request, &decision).await.map_err(|error| anyhow::anyhow!("{error}"))?;
    persist(backend)?;
    println!("paper order {}", result.exchange_order_id.unwrap_or_default());
    Ok(())
}

struct PaperExec<'a>(&'a PaperBackend);

#[async_trait::async_trait]
impl indodax_execution::ExecutionBackend for PaperExec<'_> {
    fn name(&self) -> &'static str {
        "paper"
    }

    async fn submit(
        &self,
        request: indodax_core::ExecutionRequest,
    ) -> Result<indodax_core::ExecutionResult, indodax_core::IndodaxError> {
        self.0.submit(request).await
    }

    async fn cancel(
        &self,
        order_id: &indodax_core::OrderId,
        symbol: Option<&indodax_core::Symbol>,
    ) -> Result<bool, indodax_core::IndodaxError> {
        self.0.cancel(order_id, symbol).await
    }
}
