use chrono::Utc;
use indodax_core::{Capability, ExecutionMode, OrderId};
use indodax_execution::{ExecutionBackend, ExecutionService};
use indodax_paper::{PaperBackend, PaperState};
use indodax_testkit::sample_order;
use rust_decimal::Decimal;

#[tokio::test]
async fn paper_backend_accepts_through_service() {
    let backend = PaperBackend::new(PaperState::with_defaults());
    let service = ExecutionService::new(backend);
    let mut order = sample_order();
    order.state = indodax_core::OrderState::Approved;
    let request = indodax_core::ExecutionRequest {
        order,
        mode: ExecutionMode::Paper,
        capability: Capability::PaperTrade,
        correlation_id: "paper-e2e-1".into(),
        requested_at: Utc::now(),
    };
    let risk = indodax_core::RiskDecision::allow();
    let result = service.execute(request, &risk).await.unwrap();
    assert!(result.accepted);
    assert_eq!(service.backend_name(), "paper");
}

#[tokio::test]
async fn paper_open_fill_lifecycle() {
    let backend = PaperBackend::new(PaperState::with_defaults());
    let mut order = sample_order();
    order.state = indodax_core::OrderState::Approved;
    let result = backend
        .submit(indodax_core::ExecutionRequest {
            order,
            mode: ExecutionMode::Paper,
            capability: Capability::PaperTrade,
            correlation_id: "paper-e2e-2".into(),
            requested_at: Utc::now(),
        })
        .await
        .unwrap();
    let paper_id = OrderId::new(result.exchange_order_id.unwrap()).unwrap();
    assert_eq!(backend.snapshot().open_orders().len(), 1);
    let fee = backend.fill(&paper_id, Decimal::new(1000, 0)).unwrap();
    assert!(fee > Decimal::ZERO);
    let snapshot = backend.snapshot();
    assert!(snapshot.open_orders().is_empty());
    assert_eq!(snapshot.balance("btc").to_f64(), 1.5);
}
