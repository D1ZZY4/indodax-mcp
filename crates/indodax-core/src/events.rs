use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// First-class internal events. Transport stays out of business logic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemEvent {
    Market { symbol: String, price: f64, at: DateTime<Utc> },
    Account { detail: String, at: DateTime<Utc> },
    Order { order_id: String, state: String, at: DateTime<Utc> },
    Fill { order_id: String, price: f64, quantity: f64, at: DateTime<Utc> },
    Risk { decision: String, reason: String, at: DateTime<Utc> },
    Execution { order_id: String, accepted: bool, at: DateTime<Utc> },
    Portfolio { detail: String, at: DateTime<Utc> },
    System { detail: String, at: DateTime<Utc> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serializes_with_kind() {
        let event = SystemEvent::System { detail: "ready".into(), at: Utc::now() };
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["kind"], "system");
    }
}
