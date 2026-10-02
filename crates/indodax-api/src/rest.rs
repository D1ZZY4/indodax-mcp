use crate::endpoints::{PrivateV1, PrivateV2};
use indodax_auth::Signer;
use indodax_core::IndodaxError;
use indodax_rate_limit::RateLimiter;
use indodax_transport::HttpClient;
use serde::de::DeserializeOwned;
use std::collections::{BTreeMap, HashMap};

const PUBLIC_BASE: &str = "https://indodax.com";

/// Typed REST client. Owns transport, rate limiting, and signing only.
#[derive(Debug)]
pub struct IndodaxRest {
    http: HttpClient,
    limiter: RateLimiter,
    signer: Option<Signer>,
}

impl IndodaxRest {
    pub fn new(signer: Option<Signer>, requests_per_sec: u64) -> Result<Self, IndodaxError> {
        Ok(Self { http: HttpClient::new()?, limiter: RateLimiter::new(requests_per_sec), signer })
    }

    pub fn public_client(requests_per_sec: u64) -> Result<Self, IndodaxError> {
        Self::new(None, requests_per_sec)
    }

    fn signer(&self) -> Result<&Signer, IndodaxError> {
        self.signer.as_ref().ok_or_else(|| {
            IndodaxError::Authentication("private endpoint needs credentials".into())
        })
    }

    pub async fn public_get<T: DeserializeOwned>(&self, path: &str) -> Result<T, IndodaxError> {
        self.limiter.acquire().await;
        let url = format!("{PUBLIC_BASE}{path}");
        let response = self.http.execute_with_retry(|| self.http.inner().get(&url)).await?;
        parse_json(response).await
    }

    pub async fn public_get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, IndodaxError> {
        self.limiter.acquire().await;
        let url = format!("{PUBLIC_BASE}{path}");
        let response =
            self.http.execute_with_retry(|| self.http.inner().get(&url).query(params)).await?;
        parse_json(response).await
    }

    pub async fn private_post_v1<T: DeserializeOwned>(
        &self,
        method: &str,
        params: &HashMap<String, String>,
    ) -> Result<T, IndodaxError> {
        let signer = self.signer()?;
        let mut full: BTreeMap<String, String> =
            params.iter().map(|(key, value)| (key.clone(), value.clone())).collect();
        full.insert("method".into(), method.to_string());
        full.insert("nonce".into(), signer.next_nonce_string());
        let body = encode_form(&full);
        let (_, signature) = signer.sign_v1(&body)?;
        let key = signer.api_key().to_string();
        self.limiter.acquire().await;
        let response = self
            .http
            .execute_with_retry(|| {
                self.http
                    .inner()
                    .post(PrivateV1::URL)
                    .header("Key", &key)
                    .header("Sign", &signature)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(body.clone())
            })
            .await?;
        parse_v1_envelope(response).await
    }

    pub async fn generate_private_ws_token(&self) -> Result<(String, String), IndodaxError> {
        let signer = self.signer()?;
        let nonce = signer.next_nonce_string();
        let (_, signature) = signer.sign_v1(&nonce)?;
        let key = signer.api_key().to_string();
        let body = format!("nonce={nonce}");
        self.limiter.acquire().await;
        let response = self
            .http
            .execute_with_retry(|| {
                self.http
                    .inner()
                    .post(PrivateV1::WS_TOKEN_URL)
                    .header("Key", &key)
                    .header("Sign", &signature)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(body.clone())
            })
            .await?;
        let text =
            response.text().await.map_err(|error| IndodaxError::Network(error.to_string()))?;
        let value: serde_json::Value = serde_json::from_str(&text)
            .map_err(|error| IndodaxError::Exchange(error.to_string()))?;
        let token = value
            .get("token")
            .and_then(|token| token.as_str())
            .or_else(|| {
                value
                    .get("data")
                    .and_then(|data| data.get("token"))
                    .and_then(|token| token.as_str())
            })
            .ok_or_else(|| IndodaxError::Exchange("ws token missing in response".into()))?;
        let channel =
            value.get("channel").and_then(|channel| channel.as_str()).unwrap_or("private:orders");
        Ok((token.to_string(), channel.to_string()))
    }

    pub async fn private_get_v2<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &HashMap<String, String>,
    ) -> Result<T, IndodaxError> {
        let signer = self.signer()?;
        let mut parts: Vec<String> =
            params.iter().map(|(key, value)| format!("{key}={value}")).collect();
        parts.push(format!("timestamp={}", indodax_core::now_millis()));
        parts.push("recvWindow=5000".to_string());
        parts.sort();
        let query = parts.join("&");
        let signature = signer.sign_v2(&query)?;
        let url = format!("{}{}?{}", PrivateV2::BASE, path, query);
        let key = signer.api_key().to_string();
        self.limiter.acquire().await;
        let response = self
            .http
            .execute_with_retry(|| {
                self.http.inner().get(&url).header("X-APIKEY", &key).header("Sign", &signature)
            })
            .await?;
        parse_v2_response(response).await
    }

    /// Signed TAPI v2 POST with urlencoded body. Signature covers the body.
    pub async fn private_post_v2<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &HashMap<String, String>,
    ) -> Result<T, IndodaxError> {
        let signer = self.signer()?;
        let mut full: BTreeMap<String, String> =
            params.iter().map(|(key, value)| (key.clone(), value.clone())).collect();
        full.insert("timestamp".into(), indodax_core::now_millis().to_string());
        full.insert("recvWindow".into(), "5000".into());
        let body = encode_form(&full);
        let signature = signer.sign_v2(&body)?;
        let key = signer.api_key().to_string();
        let url = format!("{}{}", PrivateV2::BASE, path);
        self.limiter.acquire().await;
        let response = self
            .http
            .execute_with_retry(|| {
                self.http
                    .inner()
                    .post(&url)
                    .header("X-APIKEY", &key)
                    .header("Sign", &signature)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(body.clone())
            })
            .await?;
        parse_v2_response(response).await
    }

    /// Signed TAPI v2 DELETE with signed query string.
    pub async fn private_delete_v2<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &HashMap<String, String>,
    ) -> Result<T, IndodaxError> {
        let signer = self.signer()?;
        let mut parts: Vec<String> =
            params.iter().map(|(key, value)| format!("{key}={value}")).collect();
        parts.push(format!("timestamp={}", indodax_core::now_millis()));
        parts.push("recvWindow=5000".to_string());
        parts.sort();
        let query = parts.join("&");
        let signature = signer.sign_v2(&query)?;
        let url = format!("{}{}?{}", PrivateV2::BASE, path, query);
        let key = signer.api_key().to_string();
        self.limiter.acquire().await;
        let response = self
            .http
            .execute_with_retry(|| {
                self.http.inner().delete(&url).header("X-APIKEY", &key).header("Sign", &signature)
            })
            .await?;
        parse_v2_response(response).await
    }
}

async fn parse_v2_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, IndodaxError> {
    let text = response.text().await.map_err(|error| IndodaxError::Network(error.to_string()))?;
    parse_v2_value(&text)
}

fn parse_v2_value<T: DeserializeOwned>(text: &str) -> Result<T, IndodaxError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| IndodaxError::Exchange(error.to_string()))?;
    if let Some(code) = value.get("code").and_then(|code| code.as_i64()) {
        let message = value.get("msg").and_then(|msg| msg.as_str()).unwrap_or("v2 error");
        if code == 0 {
            return serde_json::from_value(value)
                .map_err(|error| IndodaxError::Exchange(error.to_string()));
        }
        if message.contains("Invalid credentials") {
            return Err(IndodaxError::Authentication(message.to_string()));
        }
        return Err(IndodaxError::Exchange(format!("v2 code {code}: {message}")));
    }
    if let Some(data) = value.get("data").filter(|data| !data.is_null()) {
        return serde_json::from_value(data.clone())
            .map_err(|error| IndodaxError::Exchange(error.to_string()));
    }
    serde_json::from_value(value).map_err(|error| IndodaxError::Exchange(error.to_string()))
}

async fn parse_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, IndodaxError> {
    let text = response.text().await.map_err(|error| IndodaxError::Network(error.to_string()))?;
    serde_json::from_str(&text).map_err(|error| IndodaxError::Exchange(error.to_string()))
}

async fn parse_v1_envelope<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, IndodaxError> {
    let text = response.text().await.map_err(|error| IndodaxError::Network(error.to_string()))?;
    let envelope: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| IndodaxError::Exchange(error.to_string()))?;
    if envelope.get("success").and_then(|value| value.as_i64()) == Some(1) {
        envelope
            .get("return")
            .cloned()
            .ok_or_else(|| IndodaxError::Exchange("v1 success without return payload".into()))
            .and_then(|value| {
                serde_json::from_value(value)
                    .map_err(|error| IndodaxError::Exchange(error.to_string()))
            })
    } else {
        let message =
            envelope.get("error").and_then(|value| value.as_str()).unwrap_or("unknown v1 error");
        Err(IndodaxError::Exchange(message.to_string()))
    }
}

fn encode_form(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                url::form_urlencoded::byte_serialize(key.as_bytes()).collect::<String>(),
                url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_encoding() {
        let mut params = BTreeMap::new();
        params.insert("method".into(), "getInfo".into());
        assert!(encode_form(&params).contains("method=getInfo"));
    }

    #[test]
    fn public_client_builds() {
        assert!(IndodaxRest::public_client(7).is_ok());
    }

    #[test]
    fn v2_error_envelope_surfaces_code() {
        let result = parse_v2_value::<serde_json::Value>(
            r#"{"code":-1002,"msg":"Invalid credentials. API not found"}"#,
        );
        assert!(matches!(result, Err(IndodaxError::Authentication(_))));
        let result = parse_v2_value::<serde_json::Value>(
            r#"{"code":-2013,"msg":"Order not found or not yet available."}"#,
        );
        assert!(matches!(result, Err(IndodaxError::Exchange(_))));
    }

    #[test]
    fn v2_data_envelope_unwraps() {
        let value = parse_v2_value::<Vec<u64>>(r#"{"data":[1,2]}"#).unwrap();
        assert_eq!(value, vec![1, 2]);
    }
}
