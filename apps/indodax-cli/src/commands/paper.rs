use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct PaperArgs {
    #[command(subcommand)]
    pub action: PaperAction,
}

#[derive(Debug, Subcommand)]
pub enum PaperAction {
    Balance,
    Status,
    Reset,
    Buy { pair: String, price: f64, amount: f64 },
    Sell { pair: String, price: f64, amount: f64 },
    Fill { order_id: String, price: f64 },
    Cancel { order_id: String },
    Topup { currency: String, amount: f64 },
}
