use crate::PaperState;
use indodax_core::IndodaxError;
use indodax_storage::{FileStore, Repository};
use std::path::Path;

/// JSON file persistence for paper state. Restart reloads the same ledger.
impl PaperState {
    pub fn save_to(&self, path: &Path) -> Result<(), IndodaxError> {
        FileStore::new(path).save(self)
    }

    pub fn load_from(path: &Path) -> Result<Self, IndodaxError> {
        FileStore::new(path).load()
    }

    pub fn load_or_default(path: &Path) -> Self {
        if path.exists() {
            Self::load_from(path).unwrap_or_default()
        } else {
            Self::with_defaults()
        }
    }
}

impl crate::PaperBackend {
    pub fn persist(&self, path: &Path) -> Result<(), IndodaxError> {
        self.snapshot().save_to(path)
    }

    pub fn restore(&self, path: &Path) -> Result<bool, IndodaxError> {
        if !path.exists() {
            return Ok(false);
        }
        let state = PaperState::load_from(path)?;
        let mut guard =
            self.state.write().map_err(|_| IndodaxError::System("paper state poisoned".into()))?;
        *guard = state;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("paper-{}", indodax_core::now_millis()));
        let path = dir.join("paper.json");
        let state = PaperState::with_defaults();
        state.save_to(&path).unwrap();
        let loaded = PaperState::load_from(&path).unwrap();
        assert_eq!(loaded.balances, state.balances);
        assert_eq!(loaded.next_order_id, state.next_order_id);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_file_loads_defaults() {
        let path = std::env::temp_dir().join("paper-definitely-missing-12345.json");
        assert_eq!(PaperState::load_or_default(&path).next_order_id, 1);
    }
}
