use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct TradingArgs {
    #[command(subcommand)]
    pub action: TradingAction,
}

#[derive(Debug, Subcommand)]
pub enum TradingAction {
    ProposeBuy { pair: String, idr: f64, price: Option<f64> },
    ProposeSell { pair: String, amount: f64, price: Option<f64> },
}
