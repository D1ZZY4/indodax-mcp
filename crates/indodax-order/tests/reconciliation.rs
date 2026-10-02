use indodax_core::OrderId;
use indodax_order::{OrderMachine, Reconciler};
use indodax_testkit::sample_order;
use std::collections::HashMap;

#[test]
fn timeout_goes_unknown_then_reconciles() {
    let mut order = sample_order();
    order.state = indodax_core::OrderState::Submitting;
    OrderMachine::submit_failed(
        &mut order,
        &indodax_core::IndodaxError::Timeout("http timeout".into()),
    );
    assert_eq!(order.state, indodax_core::OrderState::Unknown);

    let mut local = HashMap::new();
    local.insert(OrderId::new("local-1").unwrap(), "open".into());
    let outcome = Reconciler::compare_orders(&local, &[]);
    assert_eq!(outcome.state, indodax_order::ReconciliationState::Mismatch);
}
