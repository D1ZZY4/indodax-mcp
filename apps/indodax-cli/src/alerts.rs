use super::*;
use crate::commands::alerts::{AlertsAction, AlertsArgs};
use indodax_alerts::AlertStore;
use indodax_market::{MarketCache, MarketService};

pub async fn run(rest: &Arc<IndodaxRest>, args: &AlertsArgs) -> Result<()> {
    let path = super::data_path("alerts.json");
    let store = AlertStore::load_or_default(&path);
    match &args.action {
        AlertsAction::List => {
            for alert in store.list(true) {
                println!("{} {} {:?}", alert.id, alert.pair, alert.status);
            }
            Ok(())
        }
        AlertsAction::Check { pair } => {
            let cache = MarketCache::new();
            let service = MarketService::new(rest, &cache);
            let ticker = service.ticker(pair).await?;
            let triggered = store.check(&ticker.symbol.as_pair(), ticker.last.to_f64());
            store.save_to(&path)?;
            println!("{} triggered at {}", triggered.len(), ticker.last.to_f64());
            Ok(())
        }
    }
}
