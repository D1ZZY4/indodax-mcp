use async_trait::async_trait;
use indodax_core::{ExecutionRequest, ExecutionResult, IndodaxError};

/// Shared execution abstraction for paper and live.
/// Implementations must not contain strategy or AI reasoning.
#[async_trait]
pub trait ExecutionBackend: Send + Sync {
    fn name(&self) -> &'static str;

    async fn submit(&self, request: ExecutionRequest) -> Result<ExecutionResult, IndodaxError>;

    async fn cancel(
        &self,
        order_id: &indodax_core::OrderId,
        symbol: Option<&indodax_core::Symbol>,
    ) -> Result<bool, IndodaxError>;
}
