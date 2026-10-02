use super::*;
use crate::commands::portfolio::{PortfolioAction, PortfolioArgs};
use indodax_core::{Asset, Money, Portfolio};
use indodax_paper::PaperState;
use indodax_portfolio::PortfolioService;
use rust_decimal::prelude::ToPrimitive;
use std::collections::HashMap;
use std::str::FromStr;

pub async fn run(rest: &Arc<IndodaxRest>, args: &PortfolioArgs) -> Result<()> {
    match &args.action {
        PortfolioAction::Equity => {
            let state = PaperState::load_or_default(&super::data_path("paper.json"));
            let mut portfolio = Portfolio::default();
            for (code, amount) in &state.balances {
                if let Ok(asset) = Asset::from_str(code) {
                    if let Some(money) = amount.to_f64().and_then(Money::from_f64) {
                        portfolio.set_available(asset, money);
                    }
                }
            }
            let mut prices = HashMap::new();
            for code in portfolio.balances.keys().filter(|code| code.as_str() != "idr") {
                let path = format!("/api/ticker/{code}_idr");
                if let Ok(data) = rest.public_get::<serde_json::Value>(&path).await {
                    if let Some(last) =
                        data.get("ticker").and_then(|ticker| ticker.get("last")).and_then(|last| {
                            last.as_str()
                                .and_then(|text| text.parse::<f64>().ok())
                                .or_else(|| last.as_f64())
                        })
                    {
                        prices.insert(format!("{code}_idr"), last);
                    }
                }
            }
            let equity = PortfolioService::equity_idr(&portfolio, &prices);
            println!("paper equity IDR: {}", equity.to_f64());
            Ok(())
        }
    }
}
