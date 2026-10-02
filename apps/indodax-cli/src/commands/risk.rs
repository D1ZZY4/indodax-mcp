use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct RiskArgs {
    #[command(subcommand)]
    pub action: RiskAction,
}

#[derive(Debug, Subcommand)]
pub enum RiskAction {
    Limits,
    Policy,
}
