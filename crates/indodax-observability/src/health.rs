use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Halted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub status: HealthStatus,
    pub checks: Vec<String>,
}

impl Health {
    pub fn healthy() -> Self {
        Self { status: HealthStatus::Healthy, checks: vec!["startup complete".into()] }
    }

    pub fn halted(reason: impl Into<String>) -> Self {
        Self { status: HealthStatus::Halted, checks: vec![reason.into()] }
    }

    pub fn is_serving(&self) -> bool {
        matches!(self.status, HealthStatus::Healthy | HealthStatus::Degraded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn healthy_serves() {
        assert!(Health::healthy().is_serving());
        assert!(!Health::halted("kill").is_serving());
    }
}
