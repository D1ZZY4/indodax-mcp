use super::*;
use crate::commands::market::{MarketAction, MarketArgs};
use indodax_market::{MarketCache, MarketService};

pub async fn run(rest: &Arc<IndodaxRest>, args: &MarketArgs, output: &str) -> Result<()> {
    let cache = MarketCache::new();
    let service = MarketService::new(rest, &cache);
    match &args.action {
        MarketAction::Ticker { pair } => {
            let ticker = service.ticker(pair).await?;
            if output == "json" {
                println!("{}", serde_json::to_string_pretty(&ticker)?);
            } else {
                let mut table = comfy_table::Table::new();
                table.set_header(["Pair", "Last", "High", "Low", "Buy", "Sell"]);
                table.add_row([
                    ticker.symbol.as_pair(),
                    ticker.last.to_string(),
                    ticker.high.map(|price| price.to_string()).unwrap_or_default(),
                    ticker.low.map(|price| price.to_string()).unwrap_or_default(),
                    ticker.buy.map(|price| price.to_string()).unwrap_or_default(),
                    ticker.sell.map(|price| price.to_string()).unwrap_or_default(),
                ]);
                println!("{table}");
            }
            Ok(())
        }
        MarketAction::Pairs => {
            let pairs: serde_json::Value = rest.public_get("/api/pairs").await?;
            println!("{}", serde_json::to_string_pretty(&pairs)?);
            Ok(())
        }
        MarketAction::ServerTime => {
            let time: serde_json::Value = rest.public_get("/api/server_time").await?;
            println!("{}", serde_json::to_string_pretty(&time)?);
            Ok(())
        }
    }
}
