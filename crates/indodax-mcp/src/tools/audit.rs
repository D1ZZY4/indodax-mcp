use crate::server::V2Server;
use rmcp::model::{CallToolResult, Tool};

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "audit_events",
            "Read-only. List recent audit entries newest last. Args: limit default 20 max 100. Entries never contain secrets.",
            serde_json::json!({"limit": {"type": "number", "description": "Max entries, default 20"}}),
            &[],
        ),
        V2Server::tool(
            "audit_trace",
            "Read-only. Show every audit entry for one correlation id in order. Args: correlation_id required. Use to reconstruct one operation end to end.",
            serde_json::json!({"correlation_id": {"type": "string", "description": "Correlation id"}}),
            &["correlation_id"],
        ),
    ]
}

pub async fn handle(
    server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "audit_events" => {
            let limit = V2Server::get_num(args, "limit").unwrap_or(20.0).clamp(1.0, 100.0) as usize;
            let entries = server.audit.entries();
            let start = entries.len().saturating_sub(limit);
            Some(V2Server::ok(serde_json::to_value(&entries[start..]).unwrap_or_default()))
        }
        "audit_trace" => {
            let id = V2Server::get_str(args, "correlation_id").unwrap_or_default();
            if id.is_empty() {
                return Some(V2Server::fail("validation", "correlation_id is required".into()));
            }
            let entries: Vec<_> = server
                .audit
                .entries()
                .into_iter()
                .filter(|entry| entry.correlation_id == id)
                .collect();
            Some(V2Server::ok(serde_json::to_value(&entries).unwrap_or_default()))
        }
        _ => None,
    }
}
