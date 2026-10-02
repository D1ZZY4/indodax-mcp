use indodax_gateway::{build_router, AppState};
use indodax_mcp::V2Server;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_writer(std::io::stderr).init();
    let port: u16 =
        std::env::var("MCP_PORT").ok().and_then(|port| port.parse().ok()).unwrap_or(8000);
    let server = V2Server::new_from_env()?;
    let state = AppState::from_env(server);
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("mcp http listening on {port}");
    axum::serve(listener, app).await?;
    Ok(())
}
