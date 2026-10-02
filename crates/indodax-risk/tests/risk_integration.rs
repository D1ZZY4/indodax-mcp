use indodax_core::{Capability, ExecutionMode, OrderSide, OrderType, Symbol};
use indodax_risk::{RiskContext, RiskEngine, RiskLimits, RiskPolicy};
use indodax_testkit::sample_order;

#[test]
fn paper_order_passes_and_live_mode_denied() {
    let engine = RiskEngine::new(RiskLimits::default(), RiskPolicy::paper_only());
    let order = sample_order();
    let paper = RiskContext::fresh_paper(Capability::PaperTrade);
    assert!(engine.evaluate(&order, &paper).is_allow());

    let mut live = RiskContext::fresh_paper(Capability::TradePlace);
    live.mode = ExecutionMode::Live;
    let decision = engine.evaluate(&order, &live);
    assert!(!decision.is_allow());
}

#[test]
fn symbol_parsing_covers_v1_flexibility() {
    let symbol = Symbol::parse_flexible("BTC/IDR").unwrap();
    assert_eq!(symbol.as_pair(), "btc_idr");
    assert_eq!(symbol.as_compact(), "btcidr");
    let _ = OrderSide::Buy;
    let _ = OrderType::Limit;
}
