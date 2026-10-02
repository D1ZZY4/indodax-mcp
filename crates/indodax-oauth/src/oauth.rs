use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone)]
struct TokenRecord {
    api_key: String,
    scopes: Vec<String>,
    expires_at: DateTime<Utc>,
}

/// In-memory OAuth code/token store. Restart clears all tokens.
#[derive(Debug, Default)]
pub struct OAuthStore {
    codes: RwLock<HashMap<String, TokenRecord>>,
    tokens: RwLock<HashMap<String, TokenRecord>>,
}

impl OAuthStore {
    pub fn new() -> Self {
        Self { codes: RwLock::new(HashMap::new()), tokens: RwLock::new(HashMap::new()) }
    }

    pub fn issue_code(&self, api_key: &str, scopes: Vec<String>) -> String {
        let code = crate::random_token(24);
        let record = TokenRecord {
            api_key: api_key.to_string(),
            scopes,
            expires_at: Utc::now() + chrono::Duration::minutes(10),
        };
        if let Ok(mut guard) = self.codes.write() {
            guard.insert(code.clone(), record);
        }
        code
    }

    pub fn exchange(&self, code: &str) -> Option<String> {
        let record = self.codes.write().ok()?.remove(code)?;
        if record.expires_at < Utc::now() {
            return None;
        }
        let token = crate::random_token(32);
        let stored = TokenRecord { expires_at: Utc::now() + chrono::Duration::hours(12), ..record };
        self.tokens.write().ok()?.insert(token.clone(), stored);
        Some(token)
    }

    pub fn has_scope(&self, token: &str, scope: &str) -> bool {
        self.tokens
            .read()
            .ok()
            .and_then(|guard| guard.get(token).cloned())
            .map(|record| {
                record.expires_at > Utc::now() && record.scopes.contains(&scope.to_string())
            })
            .unwrap_or(false)
    }

    pub fn api_key_for(&self, token: &str) -> Option<String> {
        self.tokens
            .read()
            .ok()?
            .get(token)
            .filter(|record| record.expires_at > Utc::now())
            .map(|record| record.api_key.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_exchange_flow() {
        let store = OAuthStore::new();
        let code = store.issue_code("key-1", vec!["indodax:account".into()]);
        let token = store.exchange(&code).expect("token issued");
        assert!(store.has_scope(&token, "indodax:account"));
        assert!(!store.has_scope(&token, "indodax:trade"));
    }
}
