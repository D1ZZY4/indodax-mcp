use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AlertCondition {
    Above { price: f64 },
    Below { price: f64 },
    ChangeUp { percent: f64, from_price: f64 },
    ChangeDown { percent: f64, from_price: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertStatus {
    Active,
    Triggered,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceAlert {
    pub id: u64,
    pub pair: String,
    pub condition: AlertCondition,
    pub created_at: DateTime<Utc>,
    pub triggered_at: Option<DateTime<Utc>>,
    pub status: AlertStatus,
    pub note: Option<String>,
}

impl PriceAlert {
    pub fn should_trigger(&self, price: f64) -> bool {
        match &self.condition {
            AlertCondition::Above { price: threshold } => price >= *threshold,
            AlertCondition::Below { price: threshold } => price <= *threshold,
            AlertCondition::ChangeUp { percent, from_price } => {
                *from_price > 0.0 && ((price - from_price) / from_price * 100.0) >= *percent
            }
            AlertCondition::ChangeDown { percent, from_price } => {
                *from_price > 0.0 && ((from_price - price) / from_price * 100.0) >= *percent
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn above_triggers() {
        let alert = PriceAlert {
            id: 1,
            pair: "btc_idr".into(),
            condition: AlertCondition::Above { price: 100.0 },
            created_at: Utc::now(),
            triggered_at: None,
            status: AlertStatus::Active,
            note: None,
        };
        assert!(alert.should_trigger(100.0));
        assert!(!alert.should_trigger(99.0));
    }
}
