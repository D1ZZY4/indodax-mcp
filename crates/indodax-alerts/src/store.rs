use crate::PriceAlert;
use chrono::Utc;
use indodax_core::IndodaxError;
use indodax_storage::{FileStore, Repository};
use std::path::Path;
use std::sync::RwLock;

/// Thread-safe alert collection with explicit evaluation.
#[derive(Debug, Default)]
pub struct AlertStore {
    inner: RwLock<Vec<PriceAlert>>,
}

impl AlertStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(Vec::new()) }
    }

    pub fn add(&self, mut alert: PriceAlert) -> Result<u64, IndodaxError> {
        let mut guard =
            self.inner.write().map_err(|_| IndodaxError::System("alert store poisoned".into()))?;
        let id = guard.iter().map(|item| item.id).max().unwrap_or(0) + 1;
        alert.id = id;
        guard.push(alert);
        Ok(id)
    }

    pub fn active(&self) -> Vec<PriceAlert> {
        self.list(false)
    }

    pub fn list(&self, history: bool) -> Vec<PriceAlert> {
        self.inner
            .read()
            .map(|guard| {
                guard
                    .iter()
                    .filter(|alert| history || alert.status == crate::AlertStatus::Active)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn check(&self, pair: &str, price: f64) -> Vec<PriceAlert> {
        let mut triggered = Vec::new();
        if let Ok(mut guard) = self.inner.write() {
            for alert in guard
                .iter_mut()
                .filter(|alert| alert.status == crate::AlertStatus::Active && alert.pair == pair)
            {
                if alert.should_trigger(price) {
                    alert.status = crate::AlertStatus::Triggered;
                    alert.triggered_at = Some(Utc::now());
                    triggered.push(alert.clone());
                }
            }
        }
        triggered
    }

    pub fn cancel(&self, id: u64) -> Result<bool, IndodaxError> {
        let mut guard =
            self.inner.write().map_err(|_| IndodaxError::System("alert store poisoned".into()))?;
        if let Some(alert) = guard.iter_mut().find(|alert| alert.id == id) {
            if alert.status == crate::AlertStatus::Active {
                alert.status = crate::AlertStatus::Cancelled;
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn save_to(&self, path: &Path) -> Result<(), IndodaxError> {
        let guard =
            self.inner.read().map_err(|_| IndodaxError::System("alert store poisoned".into()))?;
        persist_slice(&guard, path)
    }

    pub fn load_from(path: &Path) -> Result<Self, IndodaxError> {
        let text = std::fs::read_to_string(path)
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        let alerts: Vec<PriceAlert> =
            serde_json::from_str(&text).map_err(|error| IndodaxError::System(error.to_string()))?;
        Ok(Self { inner: RwLock::new(alerts) })
    }

    pub fn load_or_default(path: &Path) -> Self {
        if path.exists() {
            Self::load_from(path).unwrap_or_default()
        } else {
            Self::new()
        }
    }
}

fn persist_slice(alerts: &[PriceAlert], path: &Path) -> Result<(), IndodaxError> {
    FileStore::new(path).save(&alerts.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AlertCondition, AlertStatus};

    #[test]
    fn add_and_trigger() {
        let store = AlertStore::new();
        let id = store
            .add(PriceAlert {
                id: 0,
                pair: "btc_idr".into(),
                condition: AlertCondition::Above { price: 10.0 },
                created_at: Utc::now(),
                triggered_at: None,
                status: AlertStatus::Active,
                note: None,
            })
            .unwrap();
        assert_eq!(id, 1);
        assert_eq!(store.active().len(), 1);
        assert_eq!(store.check("btc_idr", 11.0).len(), 1);
        assert!(store.active().is_empty());
    }

    #[test]
    fn cancel_and_persist_roundtrip() {
        let store = AlertStore::new();
        let id = store
            .add(PriceAlert {
                id: 0,
                pair: "eth_idr".into(),
                condition: AlertCondition::Below { price: 5.0 },
                created_at: Utc::now(),
                triggered_at: None,
                status: AlertStatus::Active,
                note: None,
            })
            .unwrap();
        assert!(store.cancel(id).unwrap());
        assert!(!store.cancel(id).unwrap());
        let dir = std::env::temp_dir().join(format!("alerts-{}", indodax_core::now_millis()));
        let path = dir.join("alerts.json");
        store.save_to(&path).unwrap();
        let loaded = AlertStore::load_from(&path).unwrap();
        assert_eq!(loaded.active().len(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
