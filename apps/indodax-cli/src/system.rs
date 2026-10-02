use super::*;
use crate::commands::system::{SystemAction, SystemArgs};
use indodax_observability::Health;

pub async fn run(args: &SystemArgs) -> Result<()> {
    match &args.action {
        SystemAction::Health => {
            println!("{}", serde_json::to_string_pretty(&Health::healthy())?);
            Ok(())
        }
        SystemAction::Capabilities => {
            println!("market.read=allowed trade.place=controlled funding.withdraw=disabled");
            Ok(())
        }
    }
}
