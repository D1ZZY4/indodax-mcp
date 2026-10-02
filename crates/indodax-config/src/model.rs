use indodax_core::ExecutionMode;
use serde::{Deserialize, Serialize};

/// Explicit runtime mode. Defaults to paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionModeConfig {
    #[default]
    Paper,
    Live,
    Development,
    Shadow,
}

impl ExecutionModeConfig {
    pub fn as_core_mode(self) -> ExecutionMode {
        match self {
            Self::Paper | Self::Development => ExecutionMode::Paper,
            Self::Live => ExecutionMode::Live,
            Self::Shadow => ExecutionMode::Shadow,
        }
    }

    pub fn is_live(self) -> bool {
        matches!(self, Self::Live)
    }
}

/// Runtime configuration file model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default)]
    pub mode: ExecutionModeConfig,
    #[serde(default = "default_rps")]
    pub rate_limit_rps: u64,
    #[serde(default)]
    pub default_pairs: Vec<String>,
    #[serde(default)]
    pub data_dir: Option<String>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            mode: ExecutionModeConfig::Paper,
            rate_limit_rps: 7,
            default_pairs: vec!["btc_idr".to_string()],
            data_dir: None,
        }
    }
}

fn default_rps() -> u64 {
    7
}

/// Resolved credentials (key handle + secret handle, never logged).
#[derive(Debug, Clone)]
pub struct Credentials {
    pub api_key: String,
    pub api_secret: String,
}

impl Credentials {
    pub fn is_complete(&self) -> bool {
        !self.api_key.trim().is_empty() && !self.api_secret.trim().is_empty()
    }
}
