use indodax_core::ErrorCategory;
use serde::{Deserialize, Serialize};

/// Stable MCP envelope for AI consumption.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResponse<T: Serialize> {
    pub status: String,
    pub data: Option<T>,
    pub warnings: Vec<String>,
    pub error: Option<McpError>,
    pub fetched_at: chrono::DateTime<chrono::Utc>,
}

impl<T: Serialize> McpResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            status: "ok".into(),
            data: Some(data),
            warnings: Vec::new(),
            error: None,
            fetched_at: chrono::Utc::now(),
        }
    }

    pub fn ok_with_warnings(data: T, warnings: Vec<String>) -> Self {
        Self {
            status: "ok".into(),
            data: Some(data),
            warnings,
            error: None,
            fetched_at: chrono::Utc::now(),
        }
    }
}

impl McpResponse<serde_json::Value> {
    pub fn fail(category: ErrorCategory, message: String) -> Self {
        McpResponse {
            status: "error".into(),
            data: None,
            warnings: Vec::new(),
            error: Some(McpError { error_type: category.to_string(), message }),
            fetched_at: chrono::Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpError {
    pub error_type: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_envelope() {
        let response = McpResponse::ok(serde_json::json!({"a": 1}));
        assert_eq!(response.status, "ok");
        assert!(response.error.is_none());
    }

    #[test]
    fn fail_envelope() {
        let response =
            McpResponse::<serde_json::Value>::fail(ErrorCategory::Validation, "bad".into());
        assert_eq!(response.status, "error");
    }
}
