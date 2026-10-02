use clap::{Args, Subcommand};

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
