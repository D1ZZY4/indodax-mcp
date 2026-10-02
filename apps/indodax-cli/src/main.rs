mod cli;
mod commands;

use anyhow::{Context, Result};
use clap::Parser;
use cli::{Cli, Command};
use indodax_api::rest::IndodaxRest;
use indodax_auth::Signer;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let public = Arc::new(IndodaxRest::public_client(5)?);
    match &cli.command {
        Command::Market(args) => market::run(&public, args, &cli.output).await,
        Command::Account(args) => account::run(authed()?, args).await,
        Command::Trading(args) => trading::run(args).await,
        Command::Portfolio(args) => portfolio::run(&public, args).await,
        Command::Paper(args) => paper::run(args).await,
        Command::Risk(args) => risk::run(args).await,
        Command::Alerts(args) => alerts::run(&public, args).await,
        Command::System(args) => system::run(args).await,
        Command::Auth(args) => auth::run(args).await,
    }
}

/// Credentials from process env only. Never prints values.
fn authed() -> Result<Arc<IndodaxRest>> {
    let key = std::env::var("INDODAX_API_KEY").unwrap_or_default();
    let secret = std::env::var("INDODAX_API_SECRET").unwrap_or_default();
    if key.trim().is_empty() || secret.trim().is_empty() {
        anyhow::bail!("private command needs INDODAX_API_KEY and INDODAX_API_SECRET");
    }
    Ok(Arc::new(IndodaxRest::new(Some(Signer::new(&key, &secret)), 5)?))
}

fn data_path(name: &str) -> PathBuf {
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".config")
        .join("indodax-mcp-v2");
    base.join(name)
}

mod market;

mod account;

mod trading;

mod portfolio;

mod paper;

mod risk;

mod alerts;

mod system;

mod auth;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_parses_market() {
        let cli = Cli::try_parse_from(["indodax", "market", "ticker", "btc_idr"]).unwrap();
        assert!(matches!(cli.command, Command::Market(_)));
    }
}
