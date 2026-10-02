use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Validation,
    Authentication,
    Authorization,
    RateLimit,
    Exchange,
    Network,
    Timeout,
    StateConflict,
    RiskRejection,
    System,
}

impl std::fmt::Display for ErrorCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Validation => "validation",
            Self::Authentication => "authentication",
            Self::Authorization => "authorization",
            Self::RateLimit => "rate_limit",
            Self::Exchange => "exchange",
            Self::Network => "network",
            Self::Timeout => "timeout",
            Self::StateConflict => "state_conflict",
            Self::RiskRejection => "risk_rejection",
            Self::System => "system",
        };
        write!(f, "{value}")
    }
}

/// Typed platform error. Secrets must never be embedded here.
#[derive(Debug, thiserror::Error)]
pub enum IndodaxError {
    #[error("validation: {0}")]
    Validation(String),
    #[error("authentication: {0}")]
    Authentication(String),
    #[error("authorization: {0}")]
    Authorization(String),
    #[error("rate limited: {0}")]
    RateLimit(String),
    #[error("exchange error: {0}")]
    Exchange(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("state conflict: {0}")]
    StateConflict(String),
    #[error("risk rejection: {0}")]
    RiskRejection(String),
    #[error("system error: {0}")]
    System(String),
}

impl IndodaxError {
    pub fn category(&self) -> ErrorCategory {
        match self {
            Self::Validation(_) => ErrorCategory::Validation,
            Self::Authentication(_) => ErrorCategory::Authentication,
            Self::Authorization(_) => ErrorCategory::Authorization,
            Self::RateLimit(_) => ErrorCategory::RateLimit,
            Self::Exchange(_) => ErrorCategory::Exchange,
            Self::Network(_) => ErrorCategory::Network,
            Self::Timeout(_) => ErrorCategory::Timeout,
            Self::StateConflict(_) => ErrorCategory::StateConflict,
            Self::RiskRejection(_) => ErrorCategory::RiskRejection,
            Self::System(_) => ErrorCategory::System,
        }
    }

    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Network(_) | Self::Timeout(_) | Self::RateLimit(_) | Self::Exchange(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_mapping() {
        assert_eq!(IndodaxError::Validation("x".into()).category(), ErrorCategory::Validation);
        assert!(IndodaxError::Network("x".into()).is_retryable());
        assert!(!IndodaxError::Validation("x".into()).is_retryable());
    }
}
