use indodax_account::AccountSnapshotCache;
use indodax_agent::AgentIdentity;
use indodax_alerts::AlertStore;
use indodax_api::rest::IndodaxRest;
use indodax_audit::{AuditEntry, AuditKind, AuditTrail};
use indodax_core::{Capability, ExecutionMode, IndodaxError, OrderSide, OrderType, Symbol};
use indodax_event_bus::EventBus;
use indodax_market::MarketCache;
use indodax_paper::{PaperBackend, PaperState};
use indodax_risk::{RiskContext, RiskEngine, RiskLimits, RiskPolicy};
use indodax_trading::TradingService;
use rmcp::model::{CallToolResult, Content, Tool};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Paper execution adapter shared by every paper mutation path.
#[derive(Clone)]
pub(crate) struct PaperExec(pub(crate) Arc<PaperBackend>);

#[async_trait::async_trait]
impl indodax_execution::ExecutionBackend for PaperExec {
    fn name(&self) -> &'static str {
        "paper"
    }

    async fn submit(
        &self,
        request: indodax_core::ExecutionRequest,
    ) -> Result<indodax_core::ExecutionResult, indodax_core::IndodaxError> {
        self.0.submit(request).await
    }

    async fn cancel(
        &self,
        order_id: &indodax_core::OrderId,
        _symbol: Option<&indodax_core::Symbol>,
    ) -> Result<bool, indodax_core::IndodaxError> {
        self.0.cancel(order_id, _symbol).await
    }
}

/// Shared MCP application state. All tools read through these services.
pub struct V2Server {
    pub(crate) rest: Arc<IndodaxRest>,
    pub(crate) authed: Option<Arc<IndodaxRest>>,
    pub(crate) cache: Arc<MarketCache>,
    pub(crate) account_cache: Arc<AccountSnapshotCache>,
    pub(crate) paper: Arc<PaperBackend>,
    pub(crate) alerts: Arc<AlertStore>,
    pub(crate) audit: Arc<AuditTrail>,
    pub(crate) bus: EventBus,
    pub(crate) limits: RiskLimits,
    pub(crate) policy: RiskPolicy,
    pub(crate) risk_engine: RiskEngine,
    pub(crate) mode: ExecutionMode,
    pub(crate) allow_funding_withdraw: bool,
    pub(crate) paper_path: Option<PathBuf>,
    pub(crate) alerts_path: Option<PathBuf>,
    pub(crate) seq: AtomicU64,
}

impl Clone for V2Server {
    fn clone(&self) -> Self {
        Self {
            rest: self.rest.clone(),
            authed: self.authed.clone(),
            cache: self.cache.clone(),
            account_cache: self.account_cache.clone(),
            paper: self.paper.clone(),
            alerts: self.alerts.clone(),
            audit: self.audit.clone(),
            bus: self.bus.clone(),
            limits: self.limits.clone(),
            policy: self.policy.clone(),
            risk_engine: self.risk_engine.clone(),
            mode: self.mode,
            allow_funding_withdraw: self.allow_funding_withdraw,
            paper_path: self.paper_path.clone(),
            alerts_path: self.alerts_path.clone(),
            seq: AtomicU64::new(self.seq.load(Ordering::Relaxed)),
        }
    }
}

impl V2Server {
    fn base(
        rest: Arc<IndodaxRest>,
        authed: Option<Arc<IndodaxRest>>,
        paper_state: PaperState,
        paper_path: Option<PathBuf>,
        alerts_path: Option<PathBuf>,
    ) -> Self {
        let limits = RiskLimits::default();
        let policy = RiskPolicy::paper_only();
        Self {
            rest,
            authed,
            cache: Arc::new(MarketCache::new()),
            account_cache: Arc::new(AccountSnapshotCache::new()),
            paper: Arc::new(PaperBackend::new(paper_state)),
            alerts: Arc::new(AlertStore::new()),
            audit: Arc::new(AuditTrail::new()),
            bus: EventBus::new(256),
            risk_engine: RiskEngine::new(limits.clone(), policy.clone()),
            limits,
            policy,
            mode: ExecutionMode::Paper,
            allow_funding_withdraw: false,
            paper_path,
            alerts_path,
            seq: AtomicU64::new(1),
        }
    }

    /// Public-only server. Private tools report clean auth errors.
    pub fn new_public() -> Result<Self, IndodaxError> {
        Ok(Self::base(
            Arc::new(IndodaxRest::public_client(5)?),
            None,
            Self::load_paper(None),
            None,
            None,
        ))
    }

    /// Server with credentials from process env when present.
    /// Reads only `INDODAX_API_KEY` and `INDODAX_API_SECRET`, never files.
    pub fn new_from_env() -> Result<Self, IndodaxError> {
        let key = std::env::var("INDODAX_API_KEY").unwrap_or_default();
        let secret = std::env::var("INDODAX_API_SECRET").unwrap_or_default();
        let authed = if !key.trim().is_empty() && !secret.trim().is_empty() {
            use indodax_auth::Signer;
            Some(Arc::new(IndodaxRest::new(Some(Signer::new(&key, &secret)), 5)?))
        } else {
            None
        };
        Ok(Self::base(
            Arc::new(IndodaxRest::public_client(5)?),
            authed,
            Self::load_paper(None),
            None,
            None,
        ))
    }

    fn load_paper(path: Option<PathBuf>) -> PaperState {
        match path {
            Some(path) => PaperState::load_or_default(&path),
            None => PaperState::with_defaults(),
        }
    }

    pub(crate) fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed)
    }

    pub fn mode_string(&self) -> &'static str {
        match self.mode {
            ExecutionMode::Paper => "paper",
            ExecutionMode::Live => "live",
            ExecutionMode::Shadow => "shadow",
        }
    }

    pub(crate) fn authed_rest(&self) -> Result<Arc<IndodaxRest>, CallToolResult> {
        self.authed.clone().ok_or_else(|| {
            Self::fail(
                "authentication",
                "no API credentials configured for this private tool".into(),
            )
        })
    }

    pub(crate) fn trading_service(&self) -> TradingService<'_> {
        TradingService::with_start(&self.risk_engine, &self.audit, self.next_seq() * 1000)
    }

    pub(crate) fn persist_paper(&self) -> Option<String> {
        match &self.paper_path {
            Some(path) => match self.paper.persist(path) {
                Ok(()) => None,
                Err(error) => Some(format!("paper persist failed: {error}")),
            },
            None => None,
        }
    }

    pub(crate) fn persist_alerts(&self) -> Option<String> {
        match &self.alerts_path {
            Some(path) => match self.alerts.save_to(path) {
                Ok(()) => None,
                Err(error) => Some(format!("alerts persist failed: {error}")),
            },
            None => None,
        }
    }

    pub(crate) fn audit(
        &self,
        kind: AuditKind,
        correlation: &str,
        symbol: Option<String>,
        detail: Option<String>,
    ) {
        self.audit.record(AuditEntry {
            event_id: format!("evt-{}", self.next_seq()),
            timestamp: chrono::Utc::now(),
            correlation_id: correlation.to_string(),
            session_id: None,
            agent_id: None,
            symbol,
            kind,
            decision: None,
            result: None,
            reason: detail,
        });
    }

    pub(crate) fn tool(
        name: &str,
        description: &str,
        properties: serde_json::Value,
        required: &[&str],
    ) -> Tool {
        let mut schema = serde_json::Map::new();
        schema.insert("type".to_string(), serde_json::Value::String("object".to_string()));
        if let Some(props) = properties.as_object() {
            if !props.is_empty() {
                schema.insert("properties".to_string(), serde_json::Value::Object(props.clone()));
            }
        }
        if !required.is_empty() {
            schema.insert(
                "required".to_string(),
                serde_json::Value::Array(
                    required
                        .iter()
                        .map(|item| serde_json::Value::String(item.to_string()))
                        .collect(),
                ),
            );
        }
        Tool::new(name.to_string(), description.to_string(), Arc::new(schema))
    }

    pub(crate) fn ok(value: serde_json::Value) -> CallToolResult {
        Self::ok_warn(value, Vec::new())
    }

    pub(crate) fn ok_warn(mut value: serde_json::Value, warnings: Vec<String>) -> CallToolResult {
        if !warnings.is_empty() {
            if let Some(object) = value.as_object_mut() {
                object.insert("warnings".to_string(), serde_json::json!(warnings));
            }
        }
        CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&value).unwrap_or_default(),
        )])
    }

    pub(crate) fn fail(error_type: &str, message: String) -> CallToolResult {
        CallToolResult::error(vec![Content::text(
            serde_json::to_string_pretty(&serde_json::json!({
                "status": "error",
                "error_type": error_type,
                "message": message,
            }))
            .unwrap_or(message),
        )])
    }

    pub(crate) fn get_str(
        args: &serde_json::Map<String, serde_json::Value>,
        name: &str,
    ) -> Option<String> {
        args.get(name).and_then(|value| value.as_str()).map(str::to_string)
    }

    pub(crate) fn get_num(
        args: &serde_json::Map<String, serde_json::Value>,
        name: &str,
    ) -> Option<f64> {
        args.get(name).and_then(|value| {
            value.as_f64().or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
    }

    pub(crate) fn get_bool(args: &serde_json::Map<String, serde_json::Value>, name: &str) -> bool {
        args.get(name).and_then(|value| value.as_bool()).unwrap_or(false)
    }

    /// Shared paper execution adapter so every paper path crosses ExecutionService.
    pub(crate) fn paper_executor(&self) -> PaperExec {
        PaperExec(self.paper.clone())
    }

    pub(crate) fn parse_symbol(raw: &str) -> Result<Symbol, CallToolResult> {
        Symbol::parse_flexible(raw)
            .ok_or_else(|| Self::fail("validation", format!("invalid symbol: {raw}")))
    }

    pub(crate) fn parse_side(raw: &str) -> Result<OrderSide, CallToolResult> {
        match raw.to_lowercase().as_str() {
            "buy" => Ok(OrderSide::Buy),
            "sell" => Ok(OrderSide::Sell),
            other => {
                Err(Self::fail("validation", format!("side must be buy or sell, got {other}")))
            }
        }
    }

    pub(crate) fn parse_order_type(raw: Option<&str>) -> Result<OrderType, CallToolResult> {
        match raw.unwrap_or("limit").to_lowercase().as_str() {
            "limit" => Ok(OrderType::Limit),
            "market" => Ok(OrderType::Market),
            "stoplimit" => Ok(OrderType::StopLimit),
            other => Err(Self::fail(
                "validation",
                format!("order_type must be limit, market, or stoplimit, got {other}"),
            )),
        }
    }

    pub(crate) fn risk_context(&self, capability: Capability) -> RiskContext {
        RiskContext {
            mode: self.mode,
            capability,
            market_age_secs: Some(5),
            account_age_secs: Some(5),
            daily_pnl_idr: Some(rust_decimal::Decimal::ZERO),
            duplicate: false,
            reconciliation_halted: false,
            now: chrono::Utc::now(),
        }
    }

    pub(crate) fn agent_identity(&self) -> AgentIdentity {
        AgentIdentity {
            agent_id: "mcp".into(),
            session_id: format!("mcp-{}", self.next_seq()),
            display_name: None,
        }
    }
}

impl std::fmt::Debug for V2Server {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("V2Server")
            .field("mode", &self.mode)
            .field("credentials_configured", &self.authed.is_some())
            .field("funding_withdraw", &self.allow_funding_withdraw)
            .finish_non_exhaustive()
    }
}
