use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct AlertsArgs {
    #[command(subcommand)]
    pub action: AlertsAction,
}

#[derive(Debug, Subcommand)]
pub enum AlertsAction {
    List,
    Check { pair: String },
}
