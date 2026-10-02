use super::*;
use crate::commands::risk::{RiskAction, RiskArgs};
use indodax_risk::{RiskLimits, RiskPolicy};

pub async fn run(args: &RiskArgs) -> Result<()> {
    match &args.action {
        RiskAction::Limits => {
            println!("{}", serde_json::to_string_pretty(&RiskLimits::default())?);
            Ok(())
        }
        RiskAction::Policy => {
            let policy = RiskPolicy::paper_only();
            println!(
                "kill_switch={} live_allowed={}",
                policy.kill_switch,
                policy.allows_mode(indodax_core::ExecutionMode::Live)
            );
            Ok(())
        }
    }
}
