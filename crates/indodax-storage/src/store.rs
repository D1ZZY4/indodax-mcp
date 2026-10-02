use indodax_core::IndodaxError;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Repository trait so services never embed SQL or file I/O directly.
pub trait Repository<T>: Send + Sync {
    fn load(&self) -> Result<T, IndodaxError>;
    fn save(&self, value: &T) -> Result<(), IndodaxError>;
}

/// Simple JSON file store for local operation.
#[derive(Debug, Clone)]
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self { path: path.as_ref().to_path_buf() }
    }

    pub async fn load_json<T: DeserializeOwned>(&self) -> Result<T, IndodaxError> {
        let text = fs::read_to_string(&self.path)
            .await
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        serde_json::from_str(&text).map_err(|error| IndodaxError::System(error.to_string()))
    }

    pub async fn save_json<T: Serialize>(&self, value: &T) -> Result<(), IndodaxError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| IndodaxError::System(error.to_string()))?;
        }
        let text = serde_json::to_string_pretty(value)
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        fs::write(&self.path, text).await.map_err(|error| IndodaxError::System(error.to_string()))
    }
}

impl<T> Repository<T> for FileStore
where
    T: DeserializeOwned + Serialize,
{
    fn load(&self) -> Result<T, IndodaxError> {
        let text = std::fs::read_to_string(&self.path)
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        serde_json::from_str(&text).map_err(|error| IndodaxError::System(error.to_string()))
    }

    fn save(&self, value: &T) -> Result<(), IndodaxError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| IndodaxError::System(error.to_string()))?;
        }
        let text = serde_json::to_string_pretty(value)
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        std::fs::write(&self.path, text).map_err(|error| IndodaxError::System(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("v2-store-{}", indodax_core::now_millis()));
        let store = FileStore::new(dir.join("state.json"));
        let value = serde_json::json!({"hello": "world"});
        store.save(&value).unwrap();
        let loaded: serde_json::Value = store.load().unwrap();
        assert_eq!(loaded["hello"], "world");
        let _ = std::fs::remove_dir_all(dir);
    }
}
