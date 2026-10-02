use indodax_account::AccountService;
use indodax_api::rest::IndodaxRest;
use indodax_audit::AuditTrail;
use indodax_auth::Signer;
use indodax_core::{IndodaxError, SystemEvent};
use indodax_event_bus::EventBus;
use indodax_market::{MarketCache, MarketService};
use indodax_observability::{Health, HealthStatus};
use indodax_paper::{PaperBackend, PaperState};
use indodax_scheduler::{Job, Scheduler};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

/// Owned daemon runtime with explicit lifecycle and graceful shutdown.
pub struct Runtime {
    data_dir: PathBuf,
    rest: Arc<IndodaxRest>,
    authed: Option<Arc<IndodaxRest>>,
    market_cache: Arc<MarketCache>,
    paper: Arc<PaperBackend>,
    audit: Arc<AuditTrail>,
    bus: EventBus,
    scheduler: Scheduler,
    shutdown_tx: watch::Sender<bool>,
    shutdown_rx: watch::Receiver<bool>,
}

impl Runtime {
    pub fn bootstrap(data_dir: PathBuf) -> Result<Self, IndodaxError> {
        let key = std::env::var("INDODAX_API_KEY").unwrap_or_default();
        let secret = std::env::var("INDODAX_API_SECRET").unwrap_or_default();
        let authed = if !key.trim().is_empty() && !secret.trim().is_empty() {
            Some(Arc::new(IndodaxRest::new(Some(Signer::new(&key, &secret)), 5)?))
        } else {
            None
        };
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        let paper =
            Arc::new(PaperBackend::new(PaperState::load_or_default(&data_dir.join("paper.json"))));
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        Ok(Self {
            data_dir,
            rest: Arc::new(IndodaxRest::public_client(5)?),
            authed,
            market_cache: Arc::new(MarketCache::new()),
            paper,
            audit: Arc::new(AuditTrail::new()),
            bus: EventBus::new(256),
            scheduler: Scheduler::new(),
            shutdown_tx,
            shutdown_rx,
        })
    }

    pub fn health(&self) -> Health {
        Health {
            status: HealthStatus::Healthy,
            checks: vec![format!("data dir {}", self.data_dir.display())],
        }
    }

    /// Start background jobs. Each job owns its task and observes shutdown.
    pub async fn start(&mut self) -> Result<(), IndodaxError> {
        self.reconcile_once().await;
        self.warm_account().await;
        let paper = self.paper.clone();
        let data_dir = self.data_dir.clone();
        let shutdown = self.shutdown_rx.clone();
        self.scheduler.spawn(Job::new("snapshot", Duration::from_secs(60)), move || {
            let paper = paper.clone();
            let data_dir = data_dir.clone();
            let mut shutdown = shutdown.clone();
            async move {
                tokio::select! {
                    _ = shutdown.changed() => {}
                    _ = async {
                        if let Err(error) = paper.persist(&data_dir.join("paper.json")) {
                            tracing::warn!("snapshot failed: {error}");
                        }
                    } => {}
                }
            }
        });
        let rest = self.rest.clone();
        let cache = self.market_cache.clone();
        let bus = self.bus.clone();
        let shutdown = self.shutdown_rx.clone();
        self.scheduler.spawn(Job::new("market-refresh", Duration::from_secs(30)), move || {
            let rest = rest.clone();
            let cache = cache.clone();
            let bus = bus.clone();
            let mut shutdown = shutdown.clone();
            async move {
                tokio::select! {
                    _ = shutdown.changed() => {}
                    _ = async {
                        let service = MarketService::new(&rest, &cache);
                        match service.ticker("btc_idr").await {
                            Ok(ticker) => bus.publish(SystemEvent::Market {
                                symbol: ticker.symbol.as_pair(),
                                price: ticker.last.to_f64(),
                                at: chrono::Utc::now(),
                            }),
                            Err(error) => tracing::warn!("market refresh failed: {error}"),
                        }
                    } => {}
                }
            }
        });
        Ok(())
    }

    async fn reconcile_once(&self) {
        let open = self.paper.snapshot().open_orders().len();
        tracing::info!("reconcile: {open} paper orders open at startup");
    }

    async fn warm_account(&self) {
        let Some(service) = self.account_service() else {
            tracing::info!("no credentials, skipping account warmup");
            return;
        };
        match service.info().await {
            Ok(info) => tracing::info!(
                "account warm: {} with {} balances",
                info.name,
                info.portfolio.balances.len()
            ),
            Err(error) => tracing::warn!("account warmup failed: {error}"),
        }
    }

    /// Graceful shutdown: stop intake, flush state and audit, close up.
    pub async fn shutdown(mut self) {
        let _ = self.shutdown_tx.send(true);
        self.scheduler.abort_all();
        if let Err(error) = self.paper.persist(&self.data_dir.join("paper.json")) {
            tracing::warn!("final paper persist failed: {error}");
        }
        let audit_path = self.data_dir.join("audit.jsonl");
        match self.audit.flush_to(&audit_path) {
            Ok(count) => tracing::info!("flushed {count} audit entries"),
            Err(error) => tracing::warn!("audit flush failed: {error}"),
        }
    }

    pub fn account_service(&self) -> Option<AccountService<'_>> {
        self.authed.as_ref().map(|rest| AccountService::new(rest))
    }
}
