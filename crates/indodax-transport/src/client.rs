use indodax_core::IndodaxError;
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use std::time::Duration;

const MAX_RETRIES: u32 = 3;

/// Shared HTTP behavior: timeouts, retries for 429/5xx and timeouts.
/// No exchange-specific signing lives here.
#[derive(Debug, Clone)]
pub struct HttpClient {
    inner: Client,
}

impl HttpClient {
    pub fn new() -> Result<Self, IndodaxError> {
        let inner = Client::builder()
            .user_agent(concat!("indodax-mcp-v2/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(2)
            .build()
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        Ok(Self { inner })
    }

    pub fn inner(&self) -> &Client {
        &self.inner
    }

    pub async fn execute_with_retry(
        &self,
        build: impl Fn() -> RequestBuilder,
    ) -> Result<Response, IndodaxError> {
        let mut attempt = 0_u32;
        let mut backoff = 0_u32;
        let mut last_error: Option<IndodaxError> = None;

        while attempt <= MAX_RETRIES {
            if backoff > 0 {
                tokio::time::sleep(Duration::from_millis(500 * 2_u64.pow(backoff - 1))).await;
            }
            let request =
                build().build().map_err(|error| IndodaxError::System(error.to_string()))?;
            match self.inner.execute(request).await {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        return Ok(response);
                    }
                    if status == StatusCode::TOO_MANY_REQUESTS {
                        backoff += 1;
                        attempt += 1;
                        last_error = Some(IndodaxError::RateLimit(format!(
                            "rate limited (HTTP {})",
                            status.as_u16()
                        )));
                        continue;
                    }
                    if status.is_server_error() {
                        backoff += 1;
                        attempt += 1;
                        last_error = Some(IndodaxError::Exchange(format!(
                            "server error (HTTP {})",
                            status.as_u16()
                        )));
                        continue;
                    }
                    return Err(IndodaxError::Exchange(format!(
                        "unexpected HTTP {}",
                        status.as_u16()
                    )));
                }
                Err(error) if error.is_timeout() || error.is_connect() => {
                    backoff += 1;
                    attempt += 1;
                    last_error = Some(IndodaxError::Network(error.to_string()));
                }
                Err(error) => return Err(IndodaxError::Network(error.to_string())),
            }
        }

        Err(last_error.unwrap_or_else(|| IndodaxError::System("retry exhausted".into())))
    }
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new().expect("http client builds")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_with_user_agent() {
        assert!(HttpClient::new().is_ok());
    }
}
