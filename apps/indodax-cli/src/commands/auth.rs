use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub action: AuthAction,
}

#[derive(Debug, Subcommand)]
pub enum AuthAction {
    Show,
    Test,
}
