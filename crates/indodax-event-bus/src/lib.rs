use indodax_core::SystemEvent;
use tokio::sync::broadcast;

/// Local broadcast bus. No external broker.
#[derive(Debug, Clone)]
pub struct EventBus {
    sender: broadcast::Sender<SystemEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.max(16));
        Self { sender }
    }

    pub fn publish(&self, event: SystemEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SystemEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(256)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[tokio::test]
    async fn publishes_to_subscribers() {
        let bus = EventBus::new(16);
        let mut receiver = bus.subscribe();
        bus.publish(SystemEvent::System { detail: "hello".into(), at: Utc::now() });
        let event = receiver.recv().await.unwrap();
        assert!(matches!(event, SystemEvent::System { .. }));
    }
}
