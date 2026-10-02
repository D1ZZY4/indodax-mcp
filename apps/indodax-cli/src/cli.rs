use crate::commands::{
    AccountArgs, AlertsArgs, AuthArgs, MarketArgs, PaperArgs, PortfolioArgs, RiskArgs, SystemArgs,
    TradingArgs,
};
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "indodax", about = "Indodax MCP v2 CLI (paper by default)")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
    #[arg(short = 'o', long, default_value = "table", global = true)]
    pub output: String,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Market(MarketArgs),
    Account(AccountArgs),
    Trading(TradingArgs),
    Portfolio(PortfolioArgs),
    Paper(PaperArgs),
    Risk(RiskArgs),
    Alerts(AlertsArgs),
    System(SystemArgs),
    Auth(AuthArgs),
}
