use crate::types::AccountSnapshot;
use chrono::Utc;
use std::sync::RwLock;

#[derive(Debug, Default)]
pub struct AccountSnapshotCache {
    inner: RwLock<Option<AccountSnapshot>>,
}

impl AccountSnapshotCache {
    pub fn new() -> Self {
        Self { inner: RwLock::new(None) }
    }

    pub fn store(&self, snapshot: AccountSnapshot) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = Some(snapshot);
        }
    }

    pub fn load(&self) -> Option<AccountSnapshot> {
        self.inner.read().ok()?.clone()
    }

    pub fn is_stale(&self, _stale_after_secs: u64) -> bool {
        match self.load() {
            Some(snapshot) => snapshot.is_stale(Utc::now()),
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AccountInfo;
    use indodax_core::Portfolio;

    #[test]
    fn empty_cache_is_stale() {
        let cache = AccountSnapshotCache::new();
        assert!(cache.is_stale(30));
        cache.store(AccountSnapshot {
            info: AccountInfo {
                name: "test".into(),
                user_id: "1".into(),
                portfolio: Portfolio::default(),
                fetched_at: Utc::now(),
            },
            stale_after_secs: 60,
        });
        assert!(!cache.is_stale(60));
    }
}
