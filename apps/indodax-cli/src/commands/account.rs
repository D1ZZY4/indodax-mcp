use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct AccountArgs {
    #[command(subcommand)]
    pub action: AccountAction,
}

#[derive(Debug, Subcommand)]
pub enum AccountAction {
    Info,
    Balance,
    OpenOrders { pair: Option<String> },
}
