use futures_util::{SinkExt, StreamExt};
use indodax_core::{IndodaxError, SystemEvent};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub const PUBLIC_WS_URL: &str = "wss://ws3.indodax.com/ws/";
pub const PRIVATE_WS_URL: &str = "wss://pws.indodax.com/ws/?cf_ws_frame_ping_pong=true";

/// Fallback token from official Indodax market-data docs.
pub const DEFAULT_PUBLIC_TOKEN: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo";

/// Single snapshot request over a short-lived WebSocket connection.
pub struct WebSocketClient;

impl WebSocketClient {
    async fn snapshot(channel: &str, token: &str) -> Result<serde_json::Value, IndodaxError> {
        let (mut stream, _) = connect_async(PUBLIC_WS_URL)
            .await
            .map_err(|error| IndodaxError::Network(error.to_string()))?;
        let auth = serde_json::json!({"params": {"token": token}, "id": 1});
        stream
            .send(Message::Text(auth.to_string()))
            .await
            .map_err(|error| IndodaxError::Network(error.to_string()))?;

        let mut authed = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if tokio::time::Instant::now() > deadline {
                return Err(IndodaxError::Timeout("ws snapshot timed out".into()));
            }
            let message = tokio::time::timeout(std::time::Duration::from_secs(10), stream.next())
                .await
                .map_err(|_| IndodaxError::Timeout("ws snapshot timed out".into()))?
                .ok_or_else(|| IndodaxError::Network("ws stream ended".into()))?
                .map_err(|error| IndodaxError::Network(error.to_string()))?;
            match message {
                Message::Text(text) => {
                    let value: serde_json::Value = serde_json::from_str(&text)
                        .map_err(|error| IndodaxError::Exchange(error.to_string()))?;
                    if !authed {
                        if value.get("id").and_then(|id| id.as_i64()) == Some(1) {
                            authed = true;
                            let subscribe = serde_json::json!({
                                "method": 1,
                                "params": {"channel": channel},
                                "id": 2
                            });
                            stream
                                .send(Message::Text(subscribe.to_string()))
                                .await
                                .map_err(|error| IndodaxError::Network(error.to_string()))?;
                        }
                        continue;
                    }
                    if value.get("result").is_some() {
                        return Ok(value);
                    }
                }
                Message::Ping(data) => {
                    let _ = stream.send(Message::Pong(data)).await;
                }
                Message::Close(_) => {
                    return Err(IndodaxError::Network("ws closed".into()));
                }
                _ => {}
            }
        }
    }

    pub async fn ticker_snapshot(
        pair: &str,
        token: Option<&str>,
    ) -> Result<SystemEvent, IndodaxError> {
        let compact = pair.replace('_', "");
        let channel = format!("chart:tick-{compact}");
        let value = Self::snapshot(&channel, token.unwrap_or(DEFAULT_PUBLIC_TOKEN)).await?;
        Ok(SystemEvent::Market {
            symbol: pair.to_string(),
            price: extract_price(&value),
            at: chrono::Utc::now(),
        })
    }

    pub async fn book_snapshot(
        pair: &str,
        token: Option<&str>,
    ) -> Result<SystemEvent, IndodaxError> {
        let compact = pair.replace('_', "");
        let channel = format!("market:order-book-{compact}");
        let value = Self::snapshot(&channel, token.unwrap_or(DEFAULT_PUBLIC_TOKEN)).await?;
        let (bid, ask) = extract_best(&value);
        Ok(SystemEvent::System {
            detail: format!("book {pair} bid {bid} ask {ask}"),
            at: chrono::Utc::now(),
        })
    }
}

fn first_level(value: &serde_json::Value, key: &str) -> String {
    value
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(|data| data.get("data"))
        .and_then(|data| data.get(key))
        .and_then(|rows| rows.as_array())
        .and_then(|rows| rows.first())
        .map(|row| row.to_string())
        .unwrap_or_default()
}

fn extract_best(value: &serde_json::Value) -> (String, String) {
    (first_level(value, "bid"), first_level(value, "ask"))
}

fn extract_price(value: &serde_json::Value) -> f64 {
    value
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(|data| data.get("data"))
        .and_then(|rows| rows.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.as_array())
        .and_then(|fields| fields.get(2))
        .and_then(|price| price.as_f64().or_else(|| price.as_str()?.parse().ok()))
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_token_is_jwt() {
        assert!(DEFAULT_PUBLIC_TOKEN.starts_with("eyJ"));
    }

    #[test]
    fn extracts_missing_price_as_zero() {
        assert_eq!(extract_price(&serde_json::json!({})), 0.0);
        assert_eq!(extract_best(&serde_json::json!({})), ("".into(), "".into()));
    }
}
