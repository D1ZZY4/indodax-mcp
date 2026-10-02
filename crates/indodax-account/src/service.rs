use crate::types::AccountInfo;
use chrono::Utc;
use indodax_api::rest::IndodaxRest;
use indodax_core::{Asset, IndodaxError, Money, Portfolio};
use std::collections::HashMap;
use std::str::FromStr;

/// Account reads over the shared REST client.
pub struct AccountService<'a> {
    rest: &'a IndodaxRest,
}

impl<'a> AccountService<'a> {
    pub fn new(rest: &'a IndodaxRest) -> Self {
        Self { rest }
    }

    pub async fn info(&self) -> Result<AccountInfo, IndodaxError> {
        let raw: serde_json::Value = self.rest.private_post_v1("getInfo", &HashMap::new()).await?;
        parse_info(&raw)
    }

    pub async fn open_orders_raw(
        &self,
        pair: Option<&str>,
    ) -> Result<serde_json::Value, IndodaxError> {
        let mut params = HashMap::new();
        if let Some(pair) = pair {
            params.insert("pair".to_string(), pair.to_string());
        }
        self.rest.private_post_v1("openOrders", &params).await
    }

    /// Deposit/withdrawal history. The exchange enforces a 7-day window.
    pub async fn trans_history(
        &self,
        start: &str,
        end: &str,
    ) -> Result<serde_json::Value, IndodaxError> {
        validate_history_window(start, end)?;
        let mut params = HashMap::new();
        params.insert("start".to_string(), start.to_string());
        params.insert("end".to_string(), end.to_string());
        self.rest.private_post_v1("transHistory", &params).await
    }
}

/// Docs: transHistory accepts at most 7 days, start must not exceed end.
fn validate_history_window(start: &str, end: &str) -> Result<(), IndodaxError> {
    use chrono::NaiveDate;
    let parse = |label: &str, text: &str| {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| {
            IndodaxError::Validation(format!("{label} must use YYYY-MM-DD, got {text}"))
        })
    };
    let start_date = parse("start", start)?;
    let end_date = parse("end", end)?;
    if start_date > end_date {
        return Err(IndodaxError::Validation("start date must not exceed end date".into()));
    }
    if (end_date - start_date).num_days() > 7 {
        return Err(IndodaxError::Validation("history window must not exceed 7 days".into()));
    }
    Ok(())
}

fn parse_info(raw: &serde_json::Value) -> Result<AccountInfo, IndodaxError> {
    let mut portfolio = Portfolio::default();
    if let Some(balances) = raw.get("balance").and_then(|value| value.as_object()) {
        for (code, value) in balances {
            if let Ok(asset) = Asset::from_str(code) {
                let amount = value
                    .as_str()
                    .and_then(|text| text.parse::<f64>().ok())
                    .or_else(|| value.as_f64())
                    .unwrap_or(0.0);
                if let Some(money) = Money::from_f64(amount) {
                    portfolio.set_available(asset, money);
                }
            }
        }
    }
    Ok(AccountInfo {
        name: raw.get("name").and_then(|value| value.as_str()).unwrap_or("").to_string(),
        user_id: raw.get("user_id").and_then(|value| value.as_str()).unwrap_or("").to_string(),
        portfolio,
        fetched_at: Utc::now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_balances() {
        let raw = serde_json::json!({
            "name": "alice",
            "user_id": "7",
            "balance": {"idr": "100", "btc": 0.5}
        });
        let info = parse_info(&raw).unwrap();
        assert_eq!(info.name, "alice");
        assert_eq!(info.portfolio.balances.len(), 2);
    }

    #[test]
    fn history_window_rules() {
        assert!(validate_history_window("2024-07-01", "2024-07-07").is_ok());
        assert!(validate_history_window("2024-07-07", "2024-07-01").is_err());
        assert!(validate_history_window("2024-07-01", "2024-07-09").is_err());
        assert!(validate_history_window("07-01-2024", "2024-07-07").is_err());
    }
}
