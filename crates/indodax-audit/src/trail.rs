use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuditKind {
    AgentIntentCreated,
    RiskEvaluationStarted,
    RiskApproved,
    RiskRejected,
    OrderSubmitted,
    OrderAccepted,
    OrderPartiallyFilled,
    OrderFilled,
    OrderCancelled,
    OrderFailed,
    PositionChanged,
    ReconciliationFailed,
    KillSwitchTriggered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub correlation_id: String,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub symbol: Option<String>,
    pub kind: AuditKind,
    pub decision: Option<String>,
    pub result: Option<String>,
    pub reason: Option<String>,
}

/// In-memory trail with redaction by construction (no secret fields).
#[derive(Debug, Default)]
pub struct AuditTrail {
    entries: RwLock<Vec<AuditEntry>>,
}

impl AuditTrail {
    pub fn new() -> Self {
        Self { entries: RwLock::new(Vec::new()) }
    }

    pub fn record(&self, entry: AuditEntry) {
        if let Ok(mut guard) = self.entries.write() {
            guard.push(entry);
        }
    }

    pub fn len(&self) -> usize {
        self.entries.read().map(|guard| guard.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn entries(&self) -> Vec<AuditEntry> {
        self.entries.read().map(|guard| guard.clone()).unwrap_or_default()
    }

    /// Append all entries as JSON lines. Returns the count flushed.
    pub fn flush_to(&self, path: &std::path::Path) -> Result<usize, String> {
        let guard = self.entries.read().map_err(|_| "audit trail poisoned".to_string())?;
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
        }
        let mut text = String::new();
        for entry in guard.iter() {
            text.push_str(&serde_json::to_string(entry).map_err(|error| error.to_string())?);
            text.push('\n');
        }
        std::fs::write(path, text).map_err(|error| error.to_string())?;
        Ok(guard.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_entries() {
        let trail = AuditTrail::new();
        assert!(trail.is_empty());
        trail.record(AuditEntry {
            event_id: "e1".into(),
            timestamp: Utc::now(),
            correlation_id: "c1".into(),
            session_id: None,
            agent_id: None,
            symbol: Some("btc_idr".into()),
            kind: AuditKind::OrderSubmitted,
            decision: None,
            result: None,
            reason: None,
        });
        assert_eq!(trail.len(), 1);
    }

    #[test]
    fn flush_writes_json_lines() {
        let trail = AuditTrail::new();
        trail.record(AuditEntry {
            event_id: "e1".into(),
            timestamp: Utc::now(),
            correlation_id: "c1".into(),
            session_id: None,
            agent_id: None,
            symbol: None,
            kind: AuditKind::RiskApproved,
            decision: None,
            result: None,
            reason: None,
        });
        let path = std::env::temp_dir().join(format!("audit-{}.jsonl", trail.len()));
        assert_eq!(trail.flush_to(&path).unwrap(), 1);
        let _ = std::fs::remove_file(path);
    }
}
