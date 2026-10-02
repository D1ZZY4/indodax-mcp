use std::future::Future;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::info;

/// Owned background job with explicit name and interval.
pub struct Job {
    pub name: &'static str,
    pub interval: Duration,
}

impl Job {
    pub fn new(name: &'static str, interval: Duration) -> Self {
        Self { name, interval }
    }
}

/// Minimal scheduler. Each job owns its task; shutdown cancels handles.
pub struct Scheduler {
    handles: Vec<JoinHandle<()>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self { handles: Vec::new() }
    }

    pub fn spawn<F, Fut>(&mut self, job: Job, work: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let name = job.name;
        let interval = job.interval;
        self.handles.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                info!(job = name, "scheduled job tick");
                work().await;
            }
        }));
    }

    pub fn abort_all(&mut self) {
        for handle in self.handles.drain(..) {
            handle.abort();
        }
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawns_and_aborts() {
        let mut scheduler = Scheduler::new();
        scheduler.spawn(Job::new("test", Duration::from_secs(60)), || async {});
        assert_eq!(scheduler.handles.len(), 1);
        scheduler.abort_all();
        assert!(scheduler.handles.is_empty());
    }
}
