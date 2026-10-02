use axum::{
    extract::Path, extract::State, http::HeaderMap, http::StatusCode, routing::get, routing::post,
    Json, Router,
};
use indodax_mcp::V2Server;
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AppState {
    pub server: V2Server,
    pub bridge_secret: Option<String>,
}

impl AppState {
    pub fn from_env(server: V2Server) -> Self {
        Self {
            server,
            bridge_secret: std::env::var("BRIDGE_SECRET").ok().filter(|secret| !secret.is_empty()),
        }
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/call/:tool", post(call_tool))
        .with_state(Arc::new(state))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(serde_json::json!({
        "status": "ok",
        "server": "indodax-mcp-v2",
        "mode": state.server.mode_string(),
    }))
}

async fn call_tool(
    State(state): State<Arc<AppState>>,
    Path(tool): Path<String>,
    headers: HeaderMap,
    Json(arguments): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(secret) = &state.bridge_secret {
        let provided = headers.get("x-bridge-auth").and_then(|value| value.to_str().ok());
        if provided != Some(secret.as_str()) {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"status": "error", "message": "bad bridge auth"})),
            ));
        }
    }
    let args = arguments.as_object().cloned().unwrap_or_default();
    let result = state.server.execute_tool(&tool, args).await;
    let text = result
        .content
        .first()
        .and_then(|content| content.as_text())
        .map(|text| text.text.clone())
        .unwrap_or_default();
    let body: Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({"text": text}));
    Ok(Json(serde_json::json!({
        "tool": tool,
        "is_error": result.is_error.unwrap_or(false),
        "result": body,
    })))
}
