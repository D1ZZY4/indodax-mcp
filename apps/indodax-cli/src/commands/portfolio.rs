use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct PortfolioArgs {
    #[command(subcommand)]
    pub action: PortfolioAction,
}

#[derive(Debug, Subcommand)]
pub enum PortfolioAction {
    Equity,
}
