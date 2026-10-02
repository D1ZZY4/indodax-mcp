use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// Secret wrapper that never prints its value.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SecretValue(String);

impl SecretValue {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretValue(****)")
    }
}

impl fmt::Display for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            write!(f, "")
        } else {
            write!(f, "********")
        }
    }
}

impl Drop for SecretValue {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl From<String> for SecretValue {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for SecretValue {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

/// Redact known secret-looking substrings for logs and errors.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for key in ["api_secret", "api-secret", "authorization", "bearer"] {
        if out.to_lowercase().contains(key) {
            out = format!("[redacted {key} content]");
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_redacted() {
        let secret = SecretValue::new("abc123");
        assert_eq!(format!("{secret}"), "********");
        assert_eq!(format!("{secret:?}"), "SecretValue(****)");
        assert_eq!(secret.expose(), "abc123");
    }
}
