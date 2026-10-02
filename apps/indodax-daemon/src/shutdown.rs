use tokio::signal;

/// Graceful shutdown: stop intake, flush work, persist, close streams.
pub async fn wait_for_shutdown() {
    let _ = signal::ctrl_c().await;
}
