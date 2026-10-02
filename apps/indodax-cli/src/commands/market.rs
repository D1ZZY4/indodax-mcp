use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct MarketArgs {
    #[command(subcommand)]
    pub action: MarketAction,
}

#[derive(Debug, Subcommand)]
pub enum MarketAction {
    Ticker { pair: String },
    Pairs,
    ServerTime,
}

#[derive(Debug, Args)]
pub struct AccountArgs {
    #[command(subcommand)]
    pub action: AccountAction,
}

#[derive(Debug, Subcommand)]
pub enum AccountAction {
    Info,
    Balance,
}

#[derive(Debug, Args)]
pub struct PaperArgs {
    #[command(subcommand)]
    pub action: PaperAction,
}

#[derive(Debug, Subcommand)]
pub enum PaperAction {
    Balance,
    Status,
}

#[derive(Debug, Args)]
pub struct SystemArgs {
    #[command(subcommand)]
    pub action: SystemAction,
}

#[derive(Debug, Subcommand)]
pub enum SystemAction {
    Health,
    Capabilities,
}
