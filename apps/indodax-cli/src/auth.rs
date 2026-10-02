use super::*;
use crate::commands::auth::{AuthAction, AuthArgs};
use std::collections::HashMap;

pub async fn run(args: &AuthArgs) -> Result<()> {
    match &args.action {
        AuthAction::Show => {
            let key = std::env::var("INDODAX_API_KEY").unwrap_or_default();
            println!("api_key_configured={} mode=paper", !key.trim().is_empty());
            Ok(())
        }
        AuthAction::Test => {
            let rest = super::authed()?;
            let info: serde_json::Value = rest.private_post_v1("getInfo", &HashMap::new()).await?;
            println!(
                "auth ok account={}",
                info.get("name").and_then(|name| name.as_str()).unwrap_or("?")
            );
            Ok(())
        }
    }
}
