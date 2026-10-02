mod runtime;
mod shutdown;

use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_writer(std::io::stderr).init();
    let data_dir = std::env::args()
        .skip_while(|arg| arg != "--data-dir")
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./data"));
    let mut runtime = runtime::Runtime::bootstrap(data_dir)?;
    tracing::info!("daemon ready: {:?}", runtime.health());
    runtime.start().await?;
    shutdown::wait_for_shutdown().await;
    tracing::info!("shutdown requested, flushing");
    runtime.shutdown().await;
    Ok(())
}
