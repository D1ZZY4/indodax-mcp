use chrono::{DateTime, Utc};
use indodax_core::{Money, Portfolio};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub name: String,
    pub user_id: String,
    pub portfolio: Portfolio,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeQuote {
    pub asset: String,
    pub fee: Money,
    pub network: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionEntry {
    pub id: String,
    pub kind: String,
    pub asset: String,
    pub amount: Money,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSnapshot {
    pub info: AccountInfo,
    pub stale_after_secs: u64,
}

impl AccountSnapshot {
    pub fn is_stale(&self, now: DateTime<Utc>) -> bool {
        (now - self.info.fetched_at).num_seconds() > self.stale_after_secs as i64
    }
}
